// 生成调度: 走子数据 → 场景序列 → 逐场景 TTS+渲染编码 → 拼接 → 封面
// 模式移植自 residual-deduction(server/src/generator.rs), 简化: 无引擎推演/分支/音效/BGM
use std::path::Path;
use std::path::PathBuf;
use std::sync::atomic::AtomicBool;
use std::sync::atomic::Ordering;
use std::time::SystemTime;
use std::time::UNIX_EPOCH;

use crate::video::ffmpeg as ff;
use crate::video::library;
use crate::video::render::apply_iccs;
use crate::video::render::find_king;
use crate::video::render::fen_to_board;
use crate::video::render::parse_point;
use crate::video::render::split_subtitle;
use crate::video::render::AnnotationColor;
use crate::video::render::AnnotationKind;
use crate::video::render::FrameScene;
use crate::video::render::SceneAnnotation;
use crate::video::render::SUBTITLE_MAX_CHARS;
use crate::video::render::FPS;
use crate::video::render::Renderer;
use crate::video::render::CANVAS_H;
use crate::video::render::CANVAS_W;
use crate::video::tts;
use crate::video::GenerateParams;
use crate::video::VideoOutcome;
use crate::video::VideoProgress;

const LEAD: f64 = 0.35; // 每场景开头留白
const TAIL: f64 = 0.5; // 每场景结尾留白
const ANIM_SECS: f64 = 0.45; // 走子滑动动画时长
const MIN_MOVE_DUR: f64 = 1.4; // 走子场景最短时长
const MIN_CARD_DUR: f64 = 2.2; // 开场/结尾卡最短时长

// 写一段静音 wav(关闭配音或 TTS 失败时兜底, 保证视频仍可产出)
pub fn write_silent_wav(path: &Path, seconds: f64) -> Result<(), String> {
    const SR: u32 = 24000;
    let samples = ((seconds * SR as f64) as usize).max(1);
    let data_len = (samples * 2) as u32;
    let mut buf = Vec::with_capacity(44 + samples * 2);
    buf.extend_from_slice(b"RIFF");
    buf.extend_from_slice(&(36 + data_len).to_le_bytes());
    buf.extend_from_slice(b"WAVE");
    buf.extend_from_slice(b"fmt ");
    buf.extend_from_slice(&16u32.to_le_bytes());
    buf.extend_from_slice(&1u16.to_le_bytes()); // PCM
    buf.extend_from_slice(&1u16.to_le_bytes()); // 单声道
    buf.extend_from_slice(&SR.to_le_bytes());
    buf.extend_from_slice(&(SR * 2).to_le_bytes()); // byte rate
    buf.extend_from_slice(&2u16.to_le_bytes()); // block align
    buf.extend_from_slice(&16u16.to_le_bytes()); // bits per sample
    buf.extend_from_slice(b"data");
    buf.extend_from_slice(&data_len.to_le_bytes());
    buf.resize(44 + samples * 2, 0);
    std::fs::write(path, buf).map_err(|e| format!("写入静音 wav 失败: {e}"))
}

fn now_ms() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_millis() as u64).unwrap_or(0)
}

fn make_id() -> String {
    let secs = SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0);
    let (y, m, d) = {
        let days = (secs / 86400) as i64;
        let z = days + 719_468;
        let era = if z >= 0 { z } else { z - 146_096 } / 146_097;
        let doe = (z - era * 146_097) as u64;
        let yoe = (doe - doe / 1460 + doe / 36524 - doe / 146_096) / 365;
        let y = yoe as i64 + era * 400;
        let doy = doe - (365 * yoe + yoe / 4 - yoe / 100); // [0, 365]
        let mp = (5 * doy + 2) / 153; // [0, 11]
        let m = if mp < 10 { mp + 3 } else { mp - 9 } as u32; // [1, 12]
        let day = (doy - (153 * mp + 2) / 5 + 1) as u32;
        (y, m, day)
    };
    let (hh, mm, ss) = ((secs % 86400) / 3600, (secs % 3600) / 60, secs % 60);
    format!("v{y:04}{m:02}{d:02}-{hh:02}{mm:02}{ss}")
}

fn frame_to_rgb(frame: &image::RgbaImage) -> Vec<u8> {
    let (w, h) = frame.dimensions();
    let mut rgb = Vec::with_capacity((w * h * 3) as usize);
    for p in frame.pixels() {
        rgb.extend_from_slice(&[p[0], p[1], p[2]]);
    }
    rgb
}

// 前端标注 DTO → 场景标注(非法数据静默跳过)
fn to_scene_annotations(dtos: &[crate::video::AnnotationDto]) -> Vec<SceneAnnotation> {
    dtos
        .iter()
        .filter_map(|a| {
            let from = parse_point(&a.from)?;
            let to = match a.to.as_deref() {
                Some(t) => match parse_point(t) {
                    Some(p) => Some(p),
                    None => return None,
                },
                None => None,
            };
            let kind = if a.kind == "arrow" {
                if to.is_none() {
                    return None; // 箭头必须有终点
                }
                AnnotationKind::Arrow
            } else {
                AnnotationKind::Circle
            };
            let color = if a.color == "green" {
                AnnotationColor::Green
            } else {
                AnnotationColor::Red
            };
            Some(SceneAnnotation { kind, from, to, color })
        })
        .collect()
}

// 预览画面标注: 主线箭头(绿) + 各变招首手箭头(红), 用于走主线前的预览卡与回看段每次回到的预览画面
fn fork_annotations(mv: &crate::video::VideoMoveStep) -> Vec<SceneAnnotation> {
    let mut annotations = vec![SceneAnnotation {
        kind: AnnotationKind::Arrow,
        from: parse_point(&mv.iccs[0..2]).expect("主线 iccs 起点"),
        to: Some(parse_point(&mv.iccs[2..4]).expect("主线 iccs 落点")),
        color: AnnotationColor::Green,
    }];
    annotations.extend(mv.branches.iter().filter_map(|b| {
        let first = b.moves.first()?;
        Some(SceneAnnotation {
            kind: AnnotationKind::Arrow,
            from: parse_point(&first.iccs[0..2])?,
            to: Some(parse_point(&first.iccs[2..4])?),
            color: AnnotationColor::Red,
        })
    }));
    annotations
}

// 走子数据 → 场景序列(开场卡 + 走子 × N + 结尾卡)
fn build_scenes(params: &GenerateParams) -> Result<Vec<FrameScene>, String> {
    if params.moves.is_empty() {
        return Err("没有走子数据, 无法生成视频".to_string());
    }
    let mut scenes = Vec::new();

    // 开场卡: 初始局面
    let (start_board, start_side) = fen_to_board(&params.moves[0].fen_before)?;
    let side_txt = if start_side == 'b' { "黑" } else { "红" };
    let intro_sub = params.intro_narration.trim();
    scenes.push(FrameScene {
        board_before: start_board,
        board_after: start_board,
        move_iccs: None,
        title: params.title.trim().to_string(),
        headline: params.subtitle.trim().to_string(),
        current_move: None,
        info_lines: vec![format!("共 {} 手 · {}方先行", params.moves.len(), side_txt)],
        subtitle: intro_sub.to_string(),
        subtitles: split_subtitle(intro_sub, SUBTITLE_MAX_CHARS),
        check_pos: None,
        annotations: vec![],
        cyan_marks: false,
    });

    // 走子场景(该手勾选了变招时, 先插"变招预览卡"与每变招"真实走子演示卡")
    let mut branch_review_scenes: Vec<FrameScene> = Vec::new(); // 片尾变招回看段(主线全部讲完之后)
    for (i, mv) in params.moves.iter().enumerate() {
        let (before, _) = fen_to_board(&mv.fen_before)?;

        // 变招预览卡: 主线箭头(绿) + 各变招箭头(红)对比, 观众先看清分叉; 再走主线, 最后逐手演示变招
        if !mv.branches.is_empty() {
            let alts: Vec<String> = mv
                .branches
                .iter()
                .map(|b| b.moves.first().map(|m| m.notation.clone()).unwrap_or_default())
                .collect();
            let mover_txt_b = if mv.side == "black" { "黑方" } else { "红方" };
            let preview_sub = mv.branch_preview_comment.trim().to_string();
            let preview_sub = if preview_sub.is_empty() {
                format!(
                    "主线走 {}。{} 另有变招 {}。我们先看变招, 再走主线。",
                    mv.notation, mover_txt_b, alts.join("、")
                )
            } else {
                preview_sub
            };
            let annotations = fork_annotations(mv);
            scenes.push(FrameScene {
                board_before: before,
                board_after: before,
                move_iccs: None,
                title: params.title.trim().to_string(),
                headline: params.subtitle.trim().to_string(),
                current_move: Some(format!("第 {} 手 · 主线与变招对比", i + 1)),
                info_lines: vec![],
                subtitle: preview_sub.clone(),
                subtitles: split_subtitle(&preview_sub, SUBTITLE_MAX_CHARS),
                check_pos: None,
                annotations,
                cyan_marks: false,
            });
        }

        // 主线走子场景
        let (after, turn_after) = fen_to_board(&mv.fen_after)?;
        let mover_txt = if mv.side == "black" { "黑方" } else { "红方" };
        // 将军警示圈标注被将一方(走完后轮到的一方)的将/帅
        let check_pos = if mv.check { find_king(&after, turn_after) } else { None };
        let narration = params.narration.get(i).map(|s| s.trim()).unwrap_or("");
        scenes.push(FrameScene {
            board_before: before,
            board_after: after,
            move_iccs: Some(mv.iccs.clone()),
            title: params.title.trim().to_string(),
            headline: String::new(),
            current_move: Some(format!("第 {} 手 · {} {}", i + 1, mover_txt, mv.notation)),
            info_lines: vec![],
            subtitle: narration.to_string(),
            subtitles: split_subtitle(narration, SUBTITLE_MAX_CHARS),
            check_pos,
            annotations: to_scene_annotations(&mv.annotations),
            cyan_marks: false,
        });

        // 变招逐手演示(不进入主线叙事, 统一追加到片尾"变招回看"段): 青色标记, 解说词逐手自定义(空 = 自动模板)
        // 每个变招开讲前都先回到预览画面(分叉局面 + 主线/变招箭头), 观众看完一个变招回到分叉处再看下一个
        if !mv.branches.is_empty() {
            let mover_txt_b = if mv.side == "black" { "黑方" } else { "红方" };
            let picked = mv.branches.len();
            for (bi, b) in mv.branches.iter().enumerate() {
                // 回到预览画面; 解说词优先用户自定义, 留空自动衔接: 首个变招交代主线着法, 之后"看完 X, 再看 Y"
                let next_txt = b.moves.first().map(|m| m.notation.as_str()).unwrap_or("");
                let custom_sub = mv.branch_review_comments.get(bi).map(|s| s.trim()).unwrap_or("");
                let back_sub = if !custom_sub.is_empty() {
                    custom_sub.to_string()
                } else if bi == 0 {
                    if picked == 1 {
                        format!("主线走 {}。下面回看变招 {}。", mv.notation, next_txt)
                    } else {
                        format!("主线走 {}。下面逐个回看变招, 先看 {}。", mv.notation, next_txt)
                    }
                } else {
                    let prev_txt =
                        mv.branches[bi - 1].moves.first().map(|m| m.notation.as_str()).unwrap_or("");
                    format!("看完 {}。回到分叉局面, 再看变招 {}。", prev_txt, next_txt)
                };
                branch_review_scenes.push(FrameScene {
                    board_before: before,
                    board_after: before,
                    move_iccs: None,
                    title: params.title.trim().to_string(),
                    headline: params.subtitle.trim().to_string(),
                    current_move: Some(format!("第 {} 手 · 主线与变招对比", i + 1)),
                    info_lines: vec![],
                    subtitle: back_sub.clone(),
                    subtitles: split_subtitle(&back_sub, SUBTITLE_MAX_CHARS),
                    check_pos: None,
                    annotations: fork_annotations(mv),
                    cyan_marks: false,
                });
                let total = b.moves.len();
                let mut cur = before;
                for (k, m) in b.moves.iter().enumerate() {
                    let after_m = apply_iccs(&cur, &m.iccs);
                    // 解说词与主线一致: 只用用户输入, 留空则该手无字幕无配音(total 变量不再参与模板)
                    let _ = total;
                    let demo_sub = b.comments.get(k).map(|s| s.trim()).unwrap_or("").to_string();
                    branch_review_scenes.push(FrameScene {
                        board_before: cur,
                        board_after: after_m,
                        move_iccs: Some(m.iccs.clone()),
                        title: params.title.trim().to_string(),
                        headline: String::new(),
                        current_move: Some(format!("回看变招 · {} {}", mover_txt_b, m.notation)),
                        info_lines: vec![],
                        subtitle: demo_sub.clone(),
                        subtitles: split_subtitle(&demo_sub, SUBTITLE_MAX_CHARS),
                        check_pos: None,
                        annotations: b
                            .annotations
                            .get(k)
                            .map(|list| to_scene_annotations(list))
                            .unwrap_or_default(),
                        cyan_marks: true,
                    });
                    cur = after_m;
                }
            }
        }
    }

    // 片尾变招回看段: 主线全部讲完之后、结尾卡之前, 依次回放各分歧点的变招(最后一个变招讲完直接进结尾卡)
    let review_final = branch_review_scenes.last().map(|s| s.board_after);
    scenes.extend(branch_review_scenes);

    // 结尾卡: 终局局面; 有变招回看段时用最后一个变招演示的终面, 不再跳回主线终局
    let last = params.moves.last().expect("moves 非空已校验");
    let (mainline_final, _) = fen_to_board(&last.fen_after)?;
    let final_board = review_final.unwrap_or(mainline_final);
    let outro_sub = params.outro_narration.trim();
    let mut outro_info = vec![format!("共 {} 手", params.moves.len())];
    if params.ends_mate {
        outro_info.insert(0, "绝杀 · 精彩".to_string());
    }
    scenes.push(FrameScene {
        board_before: final_board,
        board_after: final_board,
        move_iccs: None,
        title: params.title.trim().to_string(),
        headline: params.subtitle.trim().to_string(),
        current_move: None,
        info_lines: outro_info,
        subtitle: outro_sub.to_string(),
        subtitles: split_subtitle(outro_sub, SUBTITLE_MAX_CHARS),
        check_pos: None,
        annotations: vec![],
        cyan_marks: false,
    });
    Ok(scenes)
}

// 场景时长: 有配音 = 留白 + 配音时长 + 留白; 无配音按内容估算
fn scene_duration(scene: &FrameScene, wav_dur: Option<f64>) -> f64 {
    let is_move = scene.move_iccs.is_some();
    let min = if is_move { MIN_MOVE_DUR } else { MIN_CARD_DUR };
    let est = match wav_dur {
        Some(d) => LEAD + d + TAIL,
        None if scene.subtitle.is_empty() => {
            if is_move {
                ANIM_SECS + 0.95
            } else {
                2.2
            }
        }
        None => {
            // 有字幕无配音(关闭配音或 TTS 失败): 按字数估算朗读时长
            LEAD + 0.8 + scene.subtitle.chars().count() as f64 * 0.22 + TAIL
        }
    };
    est.max(min)
}

pub fn generate(
    ffmpeg: &Path,
    out_root: &Path,
    params: &GenerateParams,
    stop: &AtomicBool,
    progress: &dyn Fn(VideoProgress),
) -> Result<VideoOutcome, String> {
    let started = std::time::Instant::now();
    let stopped = || stop.load(Ordering::Relaxed);

    // 1. 场景构建
    progress(VideoProgress { stage: "prepare".into(), current: 0, total: 0, message: "构建场景...".into() });
    let scenes = build_scenes(params)?;
    let renderer = Renderer::new()?;
    let total_scenes = scenes.len() as u32;

    // 2. 输出目录
    let id = make_id();
    let work_dir = out_root.join(&id);
    std::fs::create_dir_all(&work_dir).map_err(|e| format!("创建输出目录失败: {e}"))?;

    let mut segments: Vec<PathBuf> = Vec::new();
    let mut total_duration = 0f64;
    let mut tts_failed_any = false;

    for (i, scene) in scenes.iter().enumerate() {
        if stopped() {
            let _ = std::fs::remove_dir_all(&work_dir);
            return Err("已取消".to_string());
        }

        // 3. TTS(可关闭; 失败降级为静音, 视频照出)
        let sub_preview: String = scene.subtitle.chars().take(16).collect();
        progress(VideoProgress {
            stage: "tts".into(),
            current: i as u32,
            total: total_scenes,
            message: format!("配音 {}/{}: {}", i + 1, total_scenes, sub_preview),
        });
        let wav_path = work_dir.join(format!("scene_{i:02}.wav"));
        let mut wav_dur: Option<f64> = None;
        if !scene.subtitle.is_empty() {
            if params.voice_enabled {
                let mp3_path = work_dir.join(format!("scene_{i:02}.mp3"));
                match tts::synthesize(&scene.subtitle, &params.voice, params.rate) {
                    Ok(bytes) => {
                        std::fs::write(&mp3_path, &bytes).map_err(|e| format!("写入音频失败: {e}"))?;
                        ff::mp3_to_wav(ffmpeg, &mp3_path, &wav_path)?;
                        wav_dur = Some(ff::wav_duration(&wav_path)?);
                    }
                    Err(e) => {
                        tts_failed_any = true;
                        eprintln!("[chessdrill] 场景 {i} TTS 失败, 静音兜底: {e}");
                        progress(VideoProgress {
                            stage: "tts".into(),
                            current: i as u32,
                            total: total_scenes,
                            message: format!("第 {}/{} 段配音失败, 本段静音(不影响出片)", i + 1, total_scenes),
                        });
                    }
                }
            }
        }

        // 4. 时长与静音 wav
        let dur = scene_duration(scene, wav_dur);
        if wav_dur.is_none() {
            write_silent_wav(&wav_path, dur)?;
        }
        total_duration += dur;

        // 5. 渲染帧并编码(帧迭代器 → ffmpeg stdin 管道)
        let total_frames = ((dur * FPS as f64) as usize).max(2);
        let anim_frames = if scene.move_iccs.is_some() {
            ((ANIM_SECS * FPS as f64) as usize).clamp(1, total_frames - 1)
        } else {
            0
        };
        let mut frame_idx = 0usize;
        let renderer_ref = &renderer;
        let scene_ref = scene;
        let mut frames = std::iter::from_fn(move || {
            if frame_idx >= total_frames {
                return None;
            }
            let t = if anim_frames > 0 && frame_idx < anim_frames {
                frame_idx as f32 / anim_frames as f32
            } else {
                1.0
            };
            frame_idx += 1;
            Some(frame_to_rgb(&renderer_ref.render_frame(scene_ref, t)))
        });

        let seg_path = work_dir.join(format!("scene_{i:02}.mp4"));
        progress(VideoProgress {
            stage: "render".into(),
            current: i as u32,
            total: total_scenes,
            message: format!("渲染编码 {}/{}", i + 1, total_scenes),
        });
        ff::encode_segment(ffmpeg, &wav_path, &seg_path, (CANVAS_W, CANVAS_H), &mut frames)?;
        segments.push(seg_path);
    }

    // 6. 拼接 + 封面
    if stopped() {
        let _ = std::fs::remove_dir_all(&work_dir);
        return Err("已取消".to_string());
    }
    progress(VideoProgress {
        stage: "compose".into(),
        current: total_scenes,
        total: total_scenes,
        message: "拼接片段并生成封面...".into(),
    });
    let video_path = work_dir.join("video.mp4");
    ff::concat_segments(ffmpeg, &segments, &video_path, &work_dir)?;
    let cover_path = work_dir.join("cover.jpg");
    let thumb_at = (total_duration * 0.45).min(4.0).max(1.0);
    ff::extract_thumbnail(ffmpeg, &video_path, &cover_path, thumb_at)?;
    let duration = ff::video_duration(ffmpeg, &video_path).unwrap_or(total_duration);
    let size_bytes = std::fs::metadata(&video_path).map(|m| m.len()).unwrap_or(0);

    // 7. 解说词存档(便于回看/复用)
    let narration_json = serde_json::to_string_pretty(&serde_json::json!({
        "title": params.title,
        "subtitle": params.subtitle,
        "voice": params.voice,
        "rate": params.rate,
        "voice_enabled": params.voice_enabled,
        "intro": params.intro_narration,
        "outro": params.outro_narration,
        "tts_partial_failure": tts_failed_any,
        "narration": params.narration,
    }))
    .map_err(|e| format!("解说词序列化失败: {e}"))?;
    std::fs::write(work_dir.join("narration.json"), narration_json)
        .map_err(|e| format!("写入解说词失败: {e}"))?;

    // 8. 清理中间产物(保留成品/封面/解说词)
    if let Ok(entries) = std::fs::read_dir(&work_dir) {
        for entry in entries.flatten() {
            let name = entry.file_name().to_string_lossy().into_owned();
            if name.ends_with(".mp3") || name.ends_with(".wav") || name == "concat.txt" {
                let _ = std::fs::remove_file(entry.path());
            }
        }
    }

    // 9. 入库元数据(视频库列表用); 失败不阻断出片
    let meta = library::VideoMeta {
        id: id.clone(),
        title: params.title.trim().to_string(),
        subtitle: params.subtitle.trim().to_string(),
        duration_secs: duration,
        size_bytes,
        created_ms: now_ms(),
        move_count: params.moves.len(),
        video_path: video_path.to_string_lossy().into_owned(),
        cover_path: cover_path.to_string_lossy().into_owned(),
        elapsed_secs: started.elapsed().as_secs_f64(),
    };
    if let Err(e) = library::save_meta(out_root, &meta) {
        eprintln!("[chessdrill] 视频元数据入库失败(视频已生成): {e}");
    }

    progress(VideoProgress {
        stage: "done".into(),
        current: total_scenes,
        total: total_scenes,
        message: "生成完成".into(),
    });
    Ok(VideoOutcome {
        dir: work_dir.to_string_lossy().into_owned(),
        video_path: video_path.to_string_lossy().into_owned(),
        cover_path: cover_path.to_string_lossy().into_owned(),
        duration_secs: duration,
        size_bytes,
        move_count: params.moves.len(),
        elapsed_secs: started.elapsed().as_secs_f64(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    // 场景构建: 开场 + 走子 × N + 结尾; 将军圈与手数文案
    #[test]
    fn test_build_scenes() {
        let params = GenerateParams {
            title: "测试对局".into(),
            subtitle: "测试副标题".into(),
            moves: vec![
                crate::video::VideoMoveStep {
                    fen_before: "rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABNR w - - 0 1".into(),
                    fen_after: "rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKAB1R b - - 0 1".into(),
                    iccs: "h0h2".into(),
                    notation: "马二进三".into(),
                    side: "red".into(),
                    check: false,
                    annotations: vec![],
                    branches: vec![],
                    branch_preview_comment: String::new(),
                    branch_review_comments: vec![],
                },
            ],
            narration: vec!["红方跳马".into()],
            intro_narration: "大家好".into(),
            outro_narration: "再见".into(),
            voice: "zh-CN-YunxiNeural".into(),
            rate: 0,
            voice_enabled: false,
            ends_mate: false,
        };
        let scenes = build_scenes(&params).unwrap();
        assert_eq!(scenes.len(), 3);
        assert!(scenes[0].move_iccs.is_none());
        assert_eq!(scenes[1].current_move.as_deref(), Some("第 1 手 · 红方 马二进三"));
        assert!(scenes[1].check_pos.is_none());
        assert_eq!(scenes[1].subtitle, "红方跳马");
        assert_eq!(scenes[2].info_lines, vec!["共 1 手".to_string()]);
    }

    // 变招回看段: 每个变招演示前都回到预览画面(分叉局面卡), 演示完最后一个不回
    #[test]
    fn test_branch_review_returns_to_preview() {
        let mk_branch = |iccs: &str, notation: &str| crate::video::BranchDemoDto {
            moves: vec![crate::video::BranchMoveDto { iccs: iccs.into(), notation: notation.into() }],
            comments: vec![String::new()],
            annotations: vec![],
        };
        let params = GenerateParams {
            title: "测试对局".into(),
            subtitle: String::new(),
            moves: vec![crate::video::VideoMoveStep {
                fen_before: "rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABNR w - - 0 1".into(),
                fen_after: "rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKAB1R b - - 0 1".into(),
                iccs: "h0h2".into(),
                notation: "马二进三".into(),
                side: "red".into(),
                check: false,
                annotations: vec![],
                branches: vec![mk_branch("b2e2", "炮五平四"), mk_branch("b2e6", "炮五进四")],
                branch_preview_comment: String::new(),
                // bi=0 自定义衔接词; bi=1 留空用自动
                branch_review_comments: vec!["自定义衔接词".into(), String::new()],
            }],
            narration: vec!["红方跳马".into()],
            intro_narration: String::new(),
            outro_narration: String::new(),
            voice: "zh-CN-YunxiNeural".into(),
            rate: 0,
            voice_enabled: false,
            ends_mate: false,
        };
        let scenes = build_scenes(&params).unwrap();
        // 开场 + 走主线前预览卡 + 主线 + (回看预览 + 变招演示) × 2 + 结尾 = 8
        assert_eq!(scenes.len(), 8);
        assert_eq!(scenes[1].current_move.as_deref(), Some("第 1 手 · 主线与变招对比"));
        assert_eq!(scenes[1].annotations.len(), 3); // 主线绿箭头 + 两个变招红箭头
        // 预览卡回退解说词只列勾选的变招(此处两个全勾)
        assert_eq!(
            scenes[1].subtitle,
            "主线走 马二进三。红方 另有变招 炮五平四、炮五进四。我们先看变招, 再走主线。"
        );
        // 变招 1 演示前回到预览画面, 解说词用自定义衔接词
        assert!(scenes[3].move_iccs.is_none());
        assert_eq!(scenes[3].current_move.as_deref(), Some("第 1 手 · 主线与变招对比"));
        assert_eq!(scenes[3].subtitle, "自定义衔接词");
        assert_eq!(scenes[4].current_move.as_deref(), Some("回看变招 · 红方 炮五平四"));
        // 变招 2 演示前再次回到预览画面, 留空用自动衔接词
        assert!(scenes[5].move_iccs.is_none());
        assert_eq!(scenes[5].subtitle, "看完 炮五平四。回到分叉局面, 再看变招 炮五进四。");
        assert_eq!(scenes[6].current_move.as_deref(), Some("回看变招 · 红方 炮五进四"));
        // 最后一个变招讲完直接进结尾卡, 不再回预览画面; 结尾画面用变招终面, 不跳回主线终局
        assert_eq!(scenes[7].board_before, scenes[6].board_after);
        assert_ne!(scenes[7].board_before, scenes[2].board_after);
        assert_eq!(scenes[7].info_lines, vec!["共 1 手".to_string()]);
    }

    // 时长规则: 配音决定时长; 无字幕走子取短卡; 有字幕无配音按字数估
    #[test]
    fn test_scene_duration() {
        let mut scene = FrameScene {
            board_before: [[' '; 9]; 10],
            board_after: [[' '; 9]; 10],
            move_iccs: Some("a0a1".into()),
            title: String::new(),
            headline: String::new(),
            current_move: None,
            info_lines: vec![],
            subtitle: String::new(),
            subtitles: vec![],
            check_pos: None,
            annotations: vec![],
            cyan_marks: false,
        };
        // 有配音
        assert!((scene_duration(&scene, Some(2.0)) - (LEAD + 2.0 + TAIL)).abs() < 1e-9);
        // 无配音无字幕: 走子场景短时长
        assert!((scene_duration(&scene, None) - (ANIM_SECS + 0.95)).abs() < 1e-9);
        // 无配音有字幕: 按字数
        scene.subtitle = "一二三四五六七八九十".to_string();
        let est = scene_duration(&scene, None);
        assert!(est > 2.0);
    }
}
