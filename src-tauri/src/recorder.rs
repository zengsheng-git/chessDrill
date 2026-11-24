//! 录制状态机：同步定位棋盘 → 后台线程 200ms 轮询识别 → 帧间 diff 加稳定复核产出走子事件
//! 事件: recorder://status | recorder://position | recorder://move | recorder://resync | recorder://warning

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, OnceLock};
use std::thread::{self, JoinHandle};
use std::time::Duration;

use serde::Serialize;
use tauri::{AppHandle, Emitter};

use crate::capture::{find_window, CaptureWindow};
use crate::detect::{
    board_check, board_diff, board_fix, board_fen, detections_bound, detections_to_board, BoardChangeState, Camp,
    Changed,
};
use crate::yolo;

const LOOP_INTERVAL_MS: u64 = 200;
/// 走子复核的补帧间隔
const CONFIRM_DELAY_MS: u64 = 120;
/// 复核追认的最大补帧次数(超长动画仍未稳定则放弃, 留待下一轮轮询重判)
const MAX_CONFIRM_ATTEMPTS: usize = 3;
const MAX_CAPTURE_FAILURES: usize = 3;
const MAX_CHECK_FAILURES: usize = 3;
const MAX_UNKNOWN_CHANGES: usize = 3;

// ---- 事件 payload ----

#[derive(Serialize, Clone)]
pub struct StatusPayload {
    /// locating | recording | stopped | error
    pub phase: String,
    pub message: Option<String>,
}

#[derive(Serialize, Clone)]
pub struct PositionPayload {
    pub fen: String,
}

/// 基准盘面重对齐通知: 前端据此重置本地推演盘面(已录着法保留)
#[derive(Serialize, Clone)]
pub struct ResyncPayload {
    pub fen: String,
}

#[derive(Serialize, Clone)]
pub struct MovePayload {
    pub ply: u32,
    pub from: String,
    pub to: String,
    pub piece: String,
    pub captured: Option<String>,
    pub fen: String,
}

#[derive(Serialize, Clone)]
pub struct WarningPayload {
    pub message: String,
}

// ---- 全局录制状态 ----

#[derive(Default)]
struct Inner {
    thread: Option<JoinHandle<()>>,
    stop_flag: Option<Arc<AtomicBool>>,
    /// 会话代号, 后台线程退出时仅清理属于自己的会话, 防止误清新一轮录制
    generation: u64,
}

struct RecorderState {
    inner: Mutex<Inner>,
}

static STATE: OnceLock<RecorderState> = OnceLock::new();

fn state() -> &'static RecorderState {
    STATE.get_or_init(|| RecorderState { inner: Mutex::new(Inner::default()) })
}

// ---- 后台线程 ----

struct RecorderContext {
    app: AppHandle,
    window: CaptureWindow,
    stop: Arc<AtomicBool>,
    generation: u64,
    last_board: [[char; 9]; 10],
}

fn emit_status(app: &AppHandle, phase: &str, message: Option<&str>) {
    let _ = app.emit("recorder://status", StatusPayload { phase: phase.to_string(), message: message.map(Into::into) });
}

fn emit_warning(app: &AppHandle, message: &str) {
    let _ = app.emit("recorder://warning", WarningPayload { message: message.to_string() });
}

/// 起点 FEN 行棋方固定红先(识别已归一化为红下黑上), 第 n 手后按手数交替
fn turn_after_ply(ply: u32) -> char {
    if ply % 2 == 1 { 'b' } else { 'w' }
}

/// 单帧完整识别: 截图 → 推理 → 归一化为红下黑上; 任一步失败返回 None
fn recognize(window: &CaptureWindow) -> Option<(Camp, [[char; 9]; 10])> {
    let image = window.capture()?;
    let detections = yolo::predict(image).ok()?;
    let (camp, mut board) = detections_to_board(&detections).ok()?;
    board_fix(&camp, &mut board);
    Some((camp, board))
}

/// 盘面复核结论
enum Confirmed {
    /// 稳定盘面与基准盘面构成完整一步
    Move([[char; 9]; 10], Changed),
    /// 稳定盘面无法用一步棋解释(极快连走/多步悔棋), 附稳定盘面供重新对齐
    Diverged([[char; 9]; 10]),
}

/// 走子动画的中段帧可能恰好吸附在滑动路径的中间交叉点上(如炮八平六经过的
/// c2), 与完成一步后的盘面 diff 完全同构, 故两格变化不能直接采信;
/// 以连续两帧一致为稳定标准, 动画推进期间持续以最新帧为候选追认,
/// 相邻着法插入(diff 退化为 Unknown)时, 依据回合制可断定候选已是完成态
fn confirm_move(
    window: &CaptureWindow,
    base: [[char; 9]; 10],
    candidate: [[char; 9]; 10],
) -> Option<Confirmed> {
    let mut candidate = candidate;
    for _ in 0..MAX_CONFIRM_ATTEMPTS {
        thread::sleep(Duration::from_millis(CONFIRM_DELAY_MS));
        let (_, board) = recognize(window)?;
        if board == base || !board_check(board) {
            // 抖动回归基准或识别异常: 放弃本轮, 交还主循环重判
            return None;
        }
        if board == candidate {
            let (changed, state) = board_diff(base, board);
            return match state {
                BoardChangeState::Move => Some(Confirmed::Move(board, changed)),
                BoardChangeState::Unknown => Some(Confirmed::Diverged(board)),
                BoardChangeState::One => None,
            };
        }
        let (_, state) = board_diff(base, board);
        match state {
            // 相邻着法已插入: 候选即上一步的完成态
            BoardChangeState::Unknown => {
                let (changed, cand_state) = board_diff(base, candidate);
                return match cand_state {
                    BoardChangeState::Move => Some(Confirmed::Move(candidate, changed)),
                    _ => Some(Confirmed::Diverged(board)),
                };
            }
            // 动画仍在推进, 以最新帧为候选继续追认
            _ => candidate = board,
        }
    }
    None
}

/// 确认一步并广播: 同方连走告警后推进手数发出 move 事件
fn accept_move(
    app: &AppHandle,
    confirmed: [[char; 9]; 10],
    changed: Changed,
    ply: &mut u32,
    last_camp: &mut Option<Camp>,
) {
    if Some(changed.camp) == *last_camp {
        emit_warning(app, "检测到同一方连续行棋（可能为悔棋或识别异常），请核对着法");
    }
    *last_camp = Some(changed.camp);
    *ply += 1;
    let _ = app.emit(
        "recorder://move",
        MovePayload {
            ply: *ply,
            from: changed.from,
            to: changed.to,
            piece: changed.piece.to_string(),
            captured: changed.captured.map(|c| c.to_string()),
            fen: board_fen(turn_after_ply(*ply), confirmed),
        },
    );
}

/// 广播基准盘面重对齐
fn emit_resync(app: &AppHandle, ply: u32, board: [[char; 9]; 10]) {
    let _ = app.emit(
        "recorder://resync",
        ResyncPayload { fen: board_fen(turn_after_ply(ply), board) },
    );
}

/// 包一层捕获 panic: 线程内任何未预期错误只终止本次录制, 不连锁拖垮调用方
fn record_loop_guarded(ctx: RecorderContext) {
    let RecorderContext { app, window, stop, generation, last_board } = ctx;
    // panic 分支也要能发事件, 在进入闭包前留一份轻量句柄
    let panic_app = app.clone();
    let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        record_loop(app, window, stop, generation, last_board);
    }));
    if let Err(e) = result {
        let msg = e
            .downcast_ref::<String>()
            .map(|s| s.as_str())
            .or_else(|| e.downcast_ref::<&str>().copied())
            .unwrap_or("未知错误");
        emit_status(&panic_app, "error", Some(&format!("录制线程异常退出: {msg}")));
    }
    cleanup_session(generation);
}

fn record_loop(app: AppHandle, window: CaptureWindow, stop: Arc<AtomicBool>, _generation: u64, mut last_board: [[char; 9]; 10]) {
    let mut ply: u32 = 0;
    let mut capture_failures = 0usize;
    let mut check_failures = 0usize;
    let mut unknown_count = 0usize;
    let mut paused = false;
    let mut last_camp: Option<Camp> = None;

    loop {
        if stop.load(Ordering::Relaxed) {
            emit_status(&app, "stopped", None);
            break;
        }
        thread::sleep(Duration::from_millis(LOOP_INTERVAL_MS));

        // 截图连续失败多为目标窗口已关闭, 通知后结束录制
        let Some(image) = window.capture() else {
            capture_failures += 1;
            if capture_failures >= MAX_CAPTURE_FAILURES {
                emit_status(&app, "error", Some("窗口已关闭，录制停止"));
                emit_status(&app, "stopped", None);
                break;
            }
            continue;
        };
        capture_failures = 0;

        // 推理出当前盘面(已归一化红下黑上)
        let frame = match yolo::predict(image) {
            Ok(d) => d,
            Err(_) => {
                check_failures += 1;
                if check_failures >= MAX_CHECK_FAILURES {
                    emit_warning(&app, "棋盘识别失败，请确认棋盘完整可见");
                    check_failures = 0;
                }
                continue;
            }
        };
        let (camp, mut board) = match detections_to_board(&frame) {
            Ok(v) => v,
            Err(_) => {
                check_failures += 1;
                if check_failures >= MAX_CHECK_FAILURES {
                    emit_warning(&app, "棋盘识别失败，请确认棋盘完整可见");
                    check_failures = 0;
                }
                continue;
            }
        };
        board_fix(&camp, &mut board);

        // 暂停中不接受新盘面: 画面回到已知盘面才直接恢复; 若悔棋/重开导致画面
        // 永远回不到基准, 则在盘面稳定后重对齐恢复, 避免录制假死
        if paused {
            if board == last_board {
                paused = false;
                unknown_count = 0;
                continue;
            }
            if board_check(board) {
                match confirm_move(&window, last_board, board) {
                    Some(Confirmed::Move(confirmed, changed)) => {
                        paused = false;
                        unknown_count = 0;
                        last_board = confirmed;
                        accept_move(&app, confirmed, changed, &mut ply, &mut last_camp);
                    }
                    Some(Confirmed::Diverged(confirmed)) => {
                        paused = false;
                        unknown_count = 0;
                        last_board = confirmed;
                        emit_resync(&app, ply, confirmed);
                        emit_warning(&app, "画面已恢复，盘面重新对齐，期间着法未录入");
                    }
                    None => {}
                }
            }
            continue;
        }

        if board == last_board {
            unknown_count = 0;
            continue;
        }

        if !board_check(board) {
            check_failures += 1;
            if check_failures >= MAX_CHECK_FAILURES {
                emit_warning(&app, "棋盘识别失败，请确认棋盘完整可见");
                check_failures = 0;
            }
            continue;
        }
        check_failures = 0;

        let (_, change_state) = board_diff(last_board, board);
        // 走子动画中段帧会恰好吸附在滑动路径的中间交叉点上, 与完整一步的
        // diff 同构, 故任何变化都先复核至盘面稳定才采信
        match confirm_move(&window, last_board, board) {
            Some(Confirmed::Move(confirmed, changed)) => {
                last_board = confirmed;
                unknown_count = 0;
                accept_move(&app, confirmed, changed, &mut ply, &mut last_camp);
            }
            Some(Confirmed::Diverged(confirmed)) => {
                last_board = confirmed;
                unknown_count = 0;
                emit_resync(&app, ply, confirmed);
                emit_warning(&app, "盘面出现无法逐手识别的变化（可能是连续快速走子或多步悔棋），已重新对齐，期间着法未录入");
            }
            None => {
                if let BoardChangeState::Unknown = change_state {
                    unknown_count += 1;
                    if unknown_count >= MAX_UNKNOWN_CHANGES {
                        emit_warning(&app, "画面变化异常，已暂停识别，请确认棋盘完整可见");
                        paused = true;
                        unknown_count = 0;
                    }
                }
                // Move/One 未复核稳定: 走子动画仍在进行, 保留基准盘面待下一轮判定
            }
        }
    }
}

/// 后台线程退出后清理会话槽位(仅当仍是本会话)
fn cleanup_session(generation: u64) {
    if let Ok(mut inner) = state().inner.lock() {
        if inner.generation == generation {
            inner.thread = None;
            inner.stop_flag = None;
        }
    }
}

// ---- Tauri 命令 ----

/// 开始录制: 定位目标窗口中的棋盘并识别初始盘面, 返回起点 FEN
#[tauri::command]
pub async fn start_recording(app: AppHandle, window_id: u32) -> Result<String, String> {
    let fen = {
        // 先检查再占用, 整个过程持锁防止并发双开
        let mut inner = state().inner.lock().map_err(|_| "录制状态异常".to_string())?;
        if inner.thread.is_some() {
            return Err("已经在录制中".to_string());
        }

        emit_status(&app, "locating", Some("正在定位棋盘"));

        // 整窗截图识别棋盘位置, 缓存裁剪区
        let mut cap = find_window(window_id).map(CaptureWindow::new).ok_or("目标窗口不存在")?;
        let image = cap.capture().ok_or("无法截取目标窗口画面")?;
        let (w, h) = (image.width(), image.height());
        let detections = yolo::predict(image)?;
        let (x, y, cw, ch) = detections_bound(w, h, &detections)?;
        cap.set_bound(x, y, cw, ch);

        // 裁剪区内重新识别初始盘面
        let image = cap.capture().ok_or("无法截取目标窗口画面")?;
        let detections = yolo::predict(image)?;
        let (camp, mut board) = detections_to_board(&detections)?;
        board_fix(&camp, &mut board);
        if !board_check(board) {
            return Err("棋盘识别无效，请确认窗口内棋盘完整且清晰".to_string());
        }
        // 起点行棋方固定红先: 识别盘面已归一化为红下黑上, 无法从画面判断真实行棋方
        let fen = board_fen('w', board);

        // 启动后台识别线程
        let generation = inner.generation.wrapping_add(1);
        let stop = Arc::new(AtomicBool::new(false));
        let ctx = RecorderContext { app: app.clone(), window: cap, stop: stop.clone(), generation, last_board: board };
        inner.thread = Some(thread::spawn(move || record_loop_guarded(ctx)));
        inner.stop_flag = Some(stop);
        inner.generation = generation;
        fen
    };

    emit_status(&app, "recording", Some("开始录制"));
    let _ = app.emit("recorder://position", PositionPayload { fen: fen.clone() });
    Ok(fen)
}

/// 停止录制: 置停止标志并回收线程; join 移到独立线程保证命令立即返回
#[tauri::command]
pub fn stop_recording() -> Result<(), String> {
    let handle = {
        let mut inner = state().inner.lock().map_err(|_| "录制状态异常".to_string())?;
        inner.stop_flag.as_ref().map(|f| f.store(true, Ordering::Relaxed));
        inner.stop_flag = None;
        inner.thread.take()
    };
    match handle {
        Some(handle) => {
            thread::spawn(move || {
                let _ = handle.join();
            });
            Ok(())
        }
        None => Err("当前没有正在进行的录制".to_string()),
    }
}
