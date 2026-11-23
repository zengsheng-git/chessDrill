//! 杀法练习 — Tauri 装配与命令
//!
//! 命令一览:
//! - `list_tiku`   内置题库列表
//! - `read_tiku`   读取单个题库全部题目
//! - `engine_move` 引擎在指定局面走一步(对手应手)
//! - `solve_line`  引擎求解完整参考杀法线(看答案)

mod engine;
mod tiku;

use std::path::Path;
use std::sync::Mutex;

use serde::Serialize;
use tauri::Manager;

/// 引擎单例: 做题时对手应手与"看答案"求解共用, 互斥串行
static ENGINE: Mutex<Option<engine::Engine>> = Mutex::new(None);

/// 引擎搜索配置: 深度为主, 时限仅作兜底上限。
/// 杀法题棋子少分支少, 深搜通常 1~2 秒内自然完成, 复杂局面最多等到上限。
/// threads=0 时 engine::spawn 自动取 CPU 全核。
fn engine_cfg(depth: usize, movetime_ms: u64) -> engine::EngineConfig {
    engine::EngineConfig {
        depth,
        movetime_ms,
        threads: 0,
        hash_mb: 512,
    }
}

/// 对手应手: 26 层满强度防守(上限 2.5s)
fn move_cfg() -> engine::EngineConfig {
    engine_cfg(26, 2500)
}

/// 参考杀法线求解: 28 层深搜(上限 4s)
fn solve_cfg() -> engine::EngineConfig {
    engine_cfg(28, 4000)
}

#[derive(Debug, Serialize)]
pub struct SearchResult {
    /// 引擎首选着法(ICCS); null = 行棋方无合法着法(已被绝杀/困毙)
    pub bestmove: Option<String>,
    /// 最优线完整着法序列(ICCS)
    pub pv: Vec<String>,
    /// 行棋方视角评分(厘兵; 将杀约 ±30000)
    pub score_cp: isize,
    /// 行棋方 N 步内将杀(正)或被将杀(负); null = 非杀局面
    pub mate_in: Option<isize>,
}

fn mate_in_of(score: isize) -> Option<isize> {
    if score > 29900 {
        Some(30000 - score)
    } else if score < -29900 {
        Some(30000 + score)
    } else {
        None
    }
}

/// 获取(或惰性启动)引擎实例
fn with_engine<T>(
    f: impl FnOnce(&mut engine::Engine) -> Result<T, String>,
) -> Result<T, String> {
    let mut guard = ENGINE.lock().map_err(|_| "引擎锁异常".to_string())?;
    if guard.is_none() {
        *guard = Some(engine::Engine::spawn(&move_cfg())?);
    }
    f(guard.as_mut().expect("引擎实例缺失"))
}

#[tauri::command]
async fn list_tiku(app: tauri::AppHandle) -> Result<Vec<tiku::TikuMeta>, String> {
    tauri::async_runtime::spawn_blocking(move || tiku::list_tiku_impl(&app))
        .await
        .map_err(|e| format!("任务执行失败：{e}"))?
}

#[tauri::command]
async fn read_tiku(app: tauri::AppHandle, name: String) -> Result<Vec<tiku::Question>, String> {
    tauri::async_runtime::spawn_blocking(move || tiku::read_tiku_impl(&app, &name))
        .await
        .map_err(|e| format!("任务执行失败：{e}"))?
}

#[tauri::command]
async fn engine_move(fen: String) -> Result<SearchResult, String> {
    tauri::async_runtime::spawn_blocking(move || {
        with_engine(|eng| {
            let r = eng.search(&fen, &move_cfg())?;
            Ok(SearchResult {
                bestmove: match r.state {
                    engine::QueryState::Success => r.pvs.first().cloned(),
                    engine::QueryState::NoMoves => None,
                },
                pv: r.pvs,
                score_cp: r.score,
                mate_in: mate_in_of(r.score),
            })
        })
    })
    .await
    .map_err(|e| format!("任务执行失败：{e}"))?
}

#[tauri::command]
async fn solve_line(fen: String) -> Result<Vec<String>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        with_engine(|eng| eng.solve_line(&fen, &solve_cfg(), 40))
    })
    .await
    .map_err(|e| format!("任务执行失败：{e}"))?
}

/// 解析引擎资源路径: 开发版优先取源码树; 打包版取安装资源目录
#[cfg(target_os = "windows")]
fn engine_resource_path(app: &tauri::AppHandle, rel: &str) -> Result<std::path::PathBuf, String> {
    if cfg!(debug_assertions) {
        let src = Path::new(env!("CARGO_MANIFEST_DIR")).join(rel);
        if src.is_file() {
            return Ok(src);
        }
    }
    app.path()
        .resolve(rel, tauri::path::BaseDirectory::Resource)
        .map_err(|e| format!("解析 {rel} 失败：{e}"))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            #[cfg(target_os = "windows")]
            {
                let exe = engine_resource_path(app.handle(), "resources/libs/pikafish/pikafish-windows.exe");
                let nnue = engine_resource_path(app.handle(), "resources/libs/pikafish/pikafish.nnue");
                match (exe, nnue) {
                    (Ok(exe), Ok(nnue)) => {
                        if let Err(e) = engine::init(&exe, &nnue) {
                            eprintln!("[chessdrill] 引擎初始化失败：{e}");
                        }
                    }
                    (Err(e), _) | (_, Err(e)) => eprintln!("[chessdrill] 引擎资源路径解析失败：{e}"),
                }
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            list_tiku,
            read_tiku,
            engine_move,
            solve_line
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_mate_in_of() {
        assert_eq!(mate_in_of(29995), Some(5)); // 5 步杀
        assert_eq!(mate_in_of(-29990), Some(10)); // 被杀 10 步
        assert_eq!(mate_in_of(350), None);
        assert_eq!(mate_in_of(0), None);
    }
}
