// 视频导出模块: 棋谱/残局杀法线 → 竖版 MP4(棋盘渲染 + TTS 配音 + 字幕)
//!
//! 命令:
//! - `generate_video`         启动后台生成(单任务槽), 进度/结果走事件
//! - `stop_video_generation`  取消当前生成
//! - `reveal_video`           在资源管理器中打开视频产物(仅限产物目录)
//! - `save_video_as`          视频另存为
//! - `list_videos` / `delete_video`  视频库(首页"视频工坊"模块)
//!
//! 事件:
//! - `video://progress` {stage, current, total, message}
//! - `video://done`     {dir, video_path, cover_path, duration_secs, size_bytes, move_count}
//! - `video://error`    string
pub mod ffmpeg;
pub mod generator;
pub mod library;
pub mod render;
pub mod tts;

use std::path::Path;
use std::path::PathBuf;
use std::sync::atomic::AtomicBool;
use std::sync::atomic::Ordering;

use serde::Deserialize;
use serde::Serialize;
use tauri::AppHandle;
use tauri::Emitter;
use tauri::Manager;
use tauri_plugin_dialog::DialogExt;

/// 棋盘标注(用户在导出对话框里逐手添加)
#[derive(Debug, Deserialize)]
pub struct AnnotationDto {
    /// "circle" 圈注 | "arrow" 箭头
    pub kind: String,
    /// ICCS 单点(圈注)或起点(箭头)
    pub from: String,
    /// 箭头终点(圈注为空)
    #[serde(default)]
    pub to: Option<String>,
    /// "red" 威胁/关键 | "green" 路线/说明
    #[serde(default)]
    pub color: String,
}

/// 变招演示的逐手着法(变招线主线, 含备选本身与后续/对方应手)
#[derive(Debug, Deserialize)]
pub struct BranchMoveDto {
    pub iccs: String,
    pub notation: String,
}

/// 变招演示(用户在导出对话框勾选的分支备选): 按变招线逐手真实走子后回退
#[derive(Debug, Deserialize)]
pub struct BranchDemoDto {
    /// 变招线逐手着法(首手为备选本身)
    pub moves: Vec<BranchMoveDto>,
    /// 逐手自定义解说词(与 moves 等长, 空串 = 该手用自动模板)
    #[serde(default)]
    pub comments: Vec<String>,
}

/// 一手走子(前端推演产出, 棋规留在前端, Rust 端只做渲染)
#[derive(Debug, Deserialize)]
pub struct VideoMoveStep {
    /// 走子前局面 FEN(标准中国象棋 FEN)
    pub fen_before: String,
    /// 走子后局面 FEN
    pub fen_after: String,
    /// 着法(ICCS, 数字端 0 为红方底线)
    pub iccs: String,
    /// 中文记谱("炮二平五")
    pub notation: String,
    /// 行棋方: "red" | "black"
    pub side: String,
    /// 走后是否将军对方
    #[serde(default)]
    pub check: bool,
    /// 该手棋盘标注
    #[serde(default)]
    pub annotations: Vec<AnnotationDto>,
    /// 该手之前的变招演示(用户勾选的分支备选)
    #[serde(default)]
    pub branches: Vec<BranchDemoDto>,
    /// 变招预览卡自定义解说词(空 = 用自动模板)
    #[serde(default)]
    pub branch_preview_comment: String,
}

#[derive(Debug, Deserialize)]
pub struct GenerateParams {
    pub title: String,
    #[serde(default)]
    pub subtitle: String,
    pub moves: Vec<VideoMoveStep>,
    /// 每手解说词(与 moves 等长, 空串 = 该手不配音)
    #[serde(default)]
    pub narration: Vec<String>,
    #[serde(default)]
    pub intro_narration: String,
    #[serde(default)]
    pub outro_narration: String,
    /// Edge TTS 音色名(如 zh-CN-YunxiNeural)
    pub voice: String,
    /// 语速 -50 ~ +100
    #[serde(default)]
    pub rate: i32,
    #[serde(default = "default_true")]
    pub voice_enabled: bool,
    /// 最后一手是否绝杀(结尾卡文案)
    #[serde(default)]
    pub ends_mate: bool,
}

fn default_true() -> bool {
    true
}

#[derive(Debug, Clone, Serialize)]
pub struct VideoProgress {
    pub stage: String, // prepare / tts / render / compose / done
    pub current: u32,
    pub total: u32,
    pub message: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct VideoOutcome {
    pub dir: String,
    pub video_path: String,
    pub cover_path: String,
    pub duration_secs: f64,
    pub size_bytes: u64,
    pub move_count: usize,
    /// 生成耗时(秒)
    pub elapsed_secs: f64,
}

/// 单任务槽 + 取消标志
static BUSY: AtomicBool = AtomicBool::new(false);
static STOP: AtomicBool = AtomicBool::new(false);

/// 解析 ffmpeg 路径: 开发版优先源码树, 打包版走资源目录(与引擎资源同策略)
fn ffmpeg_path(app: &AppHandle) -> Result<PathBuf, String> {
    let rel = "resources/libs/ffmpeg/ffmpeg.exe";
    if cfg!(debug_assertions) {
        let src = Path::new(env!("CARGO_MANIFEST_DIR")).join(rel);
        if src.is_file() {
            return Ok(src);
        }
    }
    let p = app
        .path()
        .resolve(rel, tauri::path::BaseDirectory::Resource)
        .map_err(|e| format!("解析 ffmpeg 资源失败: {e}"))?;
    if !p.is_file() {
        return Err(format!(
            "未找到 ffmpeg({})。请把 ffmpeg.exe 放入 resources/libs/ffmpeg/ 后重试",
            p.display()
        ));
    }
    Ok(p)
}

/// 视频产物根目录(用户数据目录下 videos/)
fn videos_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("解析用户数据目录失败: {e}"))?
        .join("videos");
    std::fs::create_dir_all(&dir).map_err(|e| format!("创建视频目录失败: {e}"))?;
    Ok(dir)
}

/// 启动后台生成, 立即返回; 进度/结果通过 video://* 事件通知前端
#[tauri::command]
pub fn generate_video(app: AppHandle, params: GenerateParams) -> Result<(), String> {
    if BUSY.swap(true, Ordering::SeqCst) {
        return Err("已有视频正在生成, 请等待完成或先取消".to_string());
    }
    STOP.store(false, Ordering::SeqCst);
    std::thread::spawn(move || {
        // catch_unwind 保证 panic 时 BUSY 复位且 error 事件必发
        let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            run_generation(&app, &params)
        }));
        BUSY.store(false, Ordering::SeqCst);
        match result {
            Ok(Ok(outcome)) => {
                let _ = app.emit("video://done", &outcome);
            }
            Ok(Err(e)) => {
                let _ = app.emit("video://error", e);
            }
            Err(_) => {
                let _ = app.emit("video://error", "生成过程发生内部异常".to_string());
            }
        }
    });
    Ok(())
}

fn run_generation(app: &AppHandle, params: &GenerateParams) -> Result<VideoOutcome, String> {
    let ffmpeg = ffmpeg_path(app)?;
    let out_root = videos_dir(app)?;
    let progress = |p: VideoProgress| {
        let _ = app.emit("video://progress", &p);
    };
    generator::generate(&ffmpeg, &out_root, params, &STOP, &progress)
}

#[tauri::command]
pub fn stop_video_generation() -> Result<(), String> {
    STOP.store(true, Ordering::SeqCst);
    Ok(())
}

/// 在资源管理器中打开视频产物(文件定位/目录打开), 仅限产物目录内
#[tauri::command]
pub fn reveal_video(app: AppHandle, path: String) -> Result<(), String> {
    use std::process::Command;
    let p = PathBuf::from(&path);
    if !p.exists() {
        return Err(format!("路径不存在: {path}"));
    }
    let root = videos_dir(&app)?;
    let root = root.canonicalize().unwrap_or(root);
    let target = p.canonicalize().map_err(|e| format!("路径无效: {e}"))?;
    if !target.starts_with(&root) {
        return Err("只允许打开视频产物目录".to_string());
    }
    if p.is_file() {
        Command::new("explorer")
            .arg(format!("/select,{}", p.display()))
            .spawn()
            .map_err(|e| format!("打开文件夹失败: {e}"))?;
    } else {
        Command::new("explorer")
            .arg(p.as_os_str())
            .spawn()
            .map_err(|e| format!("打开文件夹失败: {e}"))?;
    }
    Ok(())
}

/// 视频另存为: 弹出系统保存对话框, 复制产物到用户选择的位置
#[tauri::command]
pub async fn save_video_as(app: AppHandle, src_path: String, file_name: String) -> Result<String, String> {
    // 原生文件对话框会阻塞当前线程, 挪到阻塞线程池避免卡住异步运行时
    tauri::async_runtime::spawn_blocking(move || {
        let src = PathBuf::from(&src_path);
        if !src.is_file() {
            return Err("视频文件不存在".to_string());
        }
        let mut dialog = app
            .dialog()
            .file()
            .add_filter("MP4 视频", &["mp4"])
            .set_file_name(&file_name);
        if let Some(parent) = src.parent() {
            if parent.is_dir() {
                dialog = dialog.set_directory(parent);
            }
        }
        let path = dialog
            .blocking_save_file()
            .ok_or_else(|| "已取消保存".to_string())?;
        let path = path
            .simplified()
            .into_path()
            .map_err(|e| format!("保存路径无效: {e}"))?;
        std::fs::copy(&src, &path).map_err(|e| format!("复制失败: {e}"))?;
        Ok(path.to_string_lossy().to_string())
    })
    .await
    .map_err(|e| format!("保存任务执行失败: {e}"))?
}

/// 视频库列表(按创建时间倒序)
#[tauri::command]
pub fn list_videos(app: AppHandle) -> Result<Vec<library::VideoMeta>, String> {
    let root = videos_dir(&app)?;
    Ok(library::list(&root))
}

/// 删除视频(整个产物目录移入系统回收站, 误删可恢复)
#[tauri::command]
pub fn delete_video(app: AppHandle, id: String) -> Result<(), String> {
    let root = videos_dir(&app)?;
    library::delete(&root, &id)
}
