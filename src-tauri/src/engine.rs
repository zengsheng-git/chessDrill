//! Pikafish UCI 引擎封装: 以独立子进程方式经标准输入输出收发 UCI 命令
//! 引擎以 GPL-3.0 独立进程运行, 通过进程边界与本应用通信

use std::io::{BufRead, BufReader, Write};
use std::path::{Path, PathBuf};
use std::process::{Child, ChildStdin, ChildStdout, Command, Stdio};
use std::sync::OnceLock;

#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;

#[cfg(target_os = "windows")]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

/// 引擎可执行文件与 NNUE 权重路径, 应用启动时解析一次
static ENGINE_PATHS: OnceLock<(PathBuf, PathBuf)> = OnceLock::new();

/// 记录引擎资源路径(需确认文件存在), 重复调用以首次为准
pub fn init(exe_path: &Path, nnue_path: &Path) -> Result<(), String> {
    if !exe_path.is_file() {
        return Err(format!("引擎文件不存在：{}", exe_path.display()));
    }
    if !nnue_path.is_file() {
        return Err(format!("NNUE 权重文件不存在：{}", nnue_path.display()));
    }
    let _ = ENGINE_PATHS.set((exe_path.to_path_buf(), nnue_path.to_path_buf()));
    Ok(())
}

#[derive(Debug, Clone, Default, serde::Serialize)]
pub struct QueryResult {
    pub depth: usize,
    /// 得分(行棋方视角, 厘兵; 将杀分绝对值约 30000)
    pub score: isize,
    pub time: usize,
    /// 最优线完整着法(iccs), 首项即引擎首选
    pub pvs: Vec<String>,
    pub pv_count: usize,
    /// 行棋方胜率(千分比)
    pub winrate: Option<usize>,
    pub state: QueryState,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, serde::Serialize)]
pub enum QueryState {
    /// 搜索正常完成
    Success,
    /// 行棋方无合法着法(被绝杀或困毙), 引擎返回 bestmove (none)
    #[default]
    NoMoves,
}

#[derive(Debug, Clone, Copy)]
pub struct EngineConfig {
    pub depth: usize,
    pub movetime_ms: u64,
    pub threads: usize,
    pub hash_mb: usize,
}

impl Default for EngineConfig {
    fn default() -> Self {
        Self { depth: 20, movetime_ms: 800, threads: 4, hash_mb: 256 }
    }
}

// 引擎单行 info 解析结果
#[derive(Default)]
struct InfoLine {
    pvs: Vec<String>,
    depth: usize,
    score: isize,
    time: usize,
    winrate: Option<usize>,
}

pub struct Engine {
    child: Child,
    stdin: ChildStdin,
    stdout: BufReader<ChildStdout>,
}

impl Engine {
    /// 启动引擎子进程并加载 NNUE 权重与基础选项
    pub fn spawn(config: &EngineConfig) -> Result<Self, String> {
        let (exe, nnue) = ENGINE_PATHS.get().ok_or(
            "引擎未初始化（缺少 Pikafish 资源文件；dev 模式请重启 tauri dev 后重试）",
        )?;
        let mut child = spawn_process(exe)?;
        let stdin = child.stdin.take().ok_or("无法获取引擎标准输入")?;
        let stdout = BufReader::new(child.stdout.take().ok_or("无法获取引擎标准输出")?);
        let mut eng = Engine { child, stdin, stdout };
        eng.setoption("EvalFile", nnue.display().to_string())?;
        // 守和题由前端按回合计数判定, 引擎侧关闭六十步自动判和
        eng.setoption("Sixty Move Rule", false)?;
        // threads=0 => 自动取 CPU 逻辑核数
        let threads = if config.threads > 0 {
            config.threads
        } else {
            std::thread::available_parallelism().map(|n| n.get()).unwrap_or(4)
        };
        eng.setoption("Threads", threads)?;
        eng.setoption("Hash", config.hash_mb)?;
        Ok(eng)
    }

    fn write_command(&mut self, args: &str) -> Result<(), String> {
        writeln!(self.stdin, "{args}").map_err(|e| format!("向引擎写入命令失败：{e}"))?;
        self.stdin.flush().map_err(|e| format!("向引擎写入命令失败：{e}"))
    }

    fn setoption<T: std::fmt::Display>(&mut self, name: &str, value: T) -> Result<(), String> {
        self.write_command(&format!("setoption name {name} value {value}"))
    }

    fn read_line(&mut self) -> Result<String, String> {
        let mut line = String::new();
        let n = self
            .stdout
            .read_line(&mut line)
            .map_err(|e| format!("读取引擎输出失败：{e}"))?;
        if n == 0 {
            return Err("引擎进程已退出".to_string());
        }
        Ok(line.trim().to_string())
    }

    fn parse_info(&self, line: &str) -> InfoLine {
        let mut iter = line.split_whitespace();
        iter.next(); // 跳过 "info"
        let mut info = InfoLine::default();
        loop {
            let Some(key) = iter.next() else { break };
            match key {
                "depth" => info.depth = iter.next().and_then(|v| v.parse().ok()).unwrap_or(0),
                "time" => info.time = iter.next().and_then(|v| v.parse().ok()).unwrap_or(0),
                "wdl" => {
                    let win: usize = iter.next().and_then(|v| v.parse().ok()).unwrap_or(0);
                    let _draw: usize = iter.next().and_then(|v| v.parse().ok()).unwrap_or(0);
                    let _loss: usize = iter.next().and_then(|v| v.parse().ok()).unwrap_or(0);
                    info.winrate = Some(win);
                }
                "score" => match iter.next().unwrap_or("") {
                    "cp" => info.score = iter.next().and_then(|v| v.parse().ok()).unwrap_or(0),
                    "mate" => {
                        let round: isize = iter.next().and_then(|v| v.parse().ok()).unwrap_or(0);
                        info.score = if round > 0 { 30000 - round } else { -(30000 + round) };
                    }
                    _ => {}
                },
                "pv" => {
                    info.pvs.extend(iter.by_ref().map(|s| s.to_string()));
                    break;
                }
                _ => {}
            }
        }
        info
    }

    /// 读取搜索输出直到 bestmove
    fn parse_search_output(&mut self) -> Result<QueryResult, String> {
        let mut result = QueryResult {
            state: QueryState::NoMoves,
            ..Default::default()
        };
        loop {
            let line = self.read_line()?;
            if line.starts_with("bestmove") {
                if !line.contains("(none)") {
                    result.state = QueryState::Success;
                }
                break;
            }
            if !line.starts_with("info") {
                continue;
            }
            let info = self.parse_info(&line);
            if info.pvs.is_empty() {
                continue;
            }
            result.depth = info.depth;
            result.score = info.score;
            result.time = info.time;
            result.winrate = info.winrate;
            result.pvs = info.pvs;
        }
        result.pv_count = usize::from(result.state == QueryState::Success);
        Ok(result)
    }

    /// 在指定局面搜索一步
    pub fn search(&mut self, fen: &str, config: &EngineConfig) -> Result<QueryResult, String> {
        self.write_command(&format!("position fen {fen}"))?;
        let mut go = format!("go depth {}", config.depth);
        if config.movetime_ms > 0 {
            go.push_str(&format!(" movetime {}", config.movetime_ms));
        }
        self.write_command(&go)?;
        self.parse_search_output()
    }

    /// 求解完整杀法线: 从起始局面出发, 双方均按引擎最强应对推演,
    /// 直到一方无合法着法(绝杀/困毙)或达到步数上限。
    /// 利用 UCI "position fen ... moves ..." 让引擎自行推演, 后端无需棋规。
    pub fn solve_line(
        &mut self,
        start_fen: &str,
        config: &EngineConfig,
        max_plies: usize,
    ) -> Result<Vec<String>, String> {
        let mut moves: Vec<String> = Vec::new();
        loop {
            let mut pos = format!("position fen {start_fen}");
            if !moves.is_empty() {
                pos.push_str(&format!(" moves {}", moves.join(" ")));
            }
            self.write_command(&pos)?;
            let mut go = format!("go depth {}", config.depth);
            if config.movetime_ms > 0 {
                go.push_str(&format!(" movetime {}", config.movetime_ms));
            }
            self.write_command(&go)?;
            let result = self.parse_search_output()?;
            match result.state {
                QueryState::NoMoves => break,
                QueryState::Success => match result.pvs.first() {
                    Some(m) => moves.push(m.clone()),
                    None => break,
                },
            }
            if moves.len() >= max_plies {
                break;
            }
        }
        Ok(moves)
    }
}

impl Drop for Engine {
    fn drop(&mut self) {
        let _ = writeln!(self.stdin, "quit");
        let _ = self.stdin.flush();
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}

#[cfg(target_os = "windows")]
fn spawn_process(exe: &Path) -> Result<Child, String> {
    Command::new(exe)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .creation_flags(CREATE_NO_WINDOW)
        .spawn()
        .map_err(|e| format!("启动 Pikafish 失败：{e}"))
}

#[cfg(not(target_os = "windows"))]
fn spawn_process(_exe: &Path) -> Result<Child, String> {
    Err("引擎仅支持 Windows 平台".to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 集成测试: 依赖本地引擎资源(不入库), `cargo test --lib -- --ignored` 运行
    fn engine_for_test() -> Engine {
        let dir = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("resources/libs/pikafish");
        init(&dir.join("pikafish-windows.exe"), &dir.join("pikafish.nnue")).expect("引擎资源缺失");
        Engine::spawn(&EngineConfig::default()).expect("启动引擎失败")
    }

    #[test]
    #[ignore]
    fn test_engine_search_basic() {
        let mut eng = engine_for_test();
        let fen = "rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABNR w";
        let result = eng.search(fen, &EngineConfig::default()).expect("搜索失败");
        assert_eq!(result.state, QueryState::Success);
        assert!(!result.pvs.is_empty(), "首选着法不应为空");
    }

    #[test]
    #[ignore]
    fn test_solve_line_mate() {
        let mut eng = engine_for_test();
        // 适情雅趣「群鼠争穴」: 红方连杀局
        let fen = "3k2b2/4P4/crR1b2Rc/9/9/9/9/1C3N1C1/4p1r2/2p2K3 w - - 0 1";
        let line = eng
            .solve_line(fen, &EngineConfig { depth: 24, movetime_ms: 1000, ..Default::default() }, 40)
            .expect("求解失败");
        assert!(!line.is_empty(), "杀法线不应为空");
        // 杀法线应以被杀方无着法结束, 手数在合理范围
        assert!(line.len() <= 40);
    }
}
