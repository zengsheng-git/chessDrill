//! 单张截图识别局面: 整图粗定位棋盘 → 裁剪精识别棋子 → 方向校正 → 合法性校验
//! (移植自 residual-deduction 的 recognize 链路, 复用本项目 yolo/detect 积木)
use image::RgbaImage;
use serde::Serialize;

use crate::detect;
use crate::detect::Camp;
use crate::yolo;

#[derive(Debug, Serialize)]
pub struct Recognition {
    /// 校正为红方在下后的 FEN(行棋方固定为红 w, 由用户在前端确认)
    pub fen: String,
    /// 是否通过布局合法性校验
    pub legal: bool,
    /// 校验提示
    pub issues: Vec<String>,
    /// 识别到的棋子数
    pub pieces_count: usize,
    /// 识别区域(棋盘+半格边距)的 PNG 预览图 base64, 供前端核对
    pub preview_base64: String,
}

pub fn recognize(origin: RgbaImage) -> Result<Recognition, String> {
    let (origin_w, origin_h) = origin.dimensions();
    if origin_w < 64 || origin_h < 64 {
        return Err("图片尺寸过小".to_string());
    }

    // 第一遍: 整图压缩到模型输入, 粗定位棋盘
    let pass1 = yolo::predict(origin.clone()).map_err(|e| format!("模型推理失败: {e}"))?;
    let (cx, cy, cw, ch) = detect::detections_bound(origin_w, origin_h, &pass1)?;

    // 第二遍: 裁剪棋盘+半格边距区域, 精确识别棋子
    let crop = image::imageops::crop_imm(&origin, cx, cy, cw, ch).to_image();
    let detections = yolo::predict(crop.clone()).map_err(|e| format!("模型推理失败: {e}"))?;

    let (bottom_camp, mut board) = detect::detections_to_board(&detections)?;
    if bottom_camp == Camp::None {
        return Err("未识别到将/帅, 请确认截图包含完整棋盘".to_string());
    }
    // 统一方向: 红方在下
    detect::board_fix(&bottom_camp, &mut board);

    let pieces_count = board.iter().flatten().filter(|&&p| p != ' ').count();
    if pieces_count < 4 {
        return Err("识别到的棋子过少, 请换更清晰的截图".to_string());
    }

    let mut issues = Vec::new();
    let legal = detect::board_check(board);
    if !legal {
        issues.push("棋子布局未通过合法性校验, 识别可能有误, 请核对预览图".to_string());
    }

    Ok(Recognition {
        fen: detect::board_fen('w', board),
        legal,
        issues,
        pieces_count,
        preview_base64: crop_to_base64(crop),
    })
}

// 预览图: 宽度压到 360 以内再编码 PNG base64, 减小传输体积
fn crop_to_base64(crop: RgbaImage) -> String {
    let img = image::DynamicImage::ImageRgba8(crop);
    let scaled = if img.width() > 360 {
        let ratio = 360.0 / img.width() as f64;
        img.resize_exact(
            360,
            ((img.height() as f64 * ratio) as u32).max(1),
            image::imageops::FilterType::Triangle,
        )
    } else {
        img
    };
    let mut png = std::io::Cursor::new(Vec::new());
    if scaled.write_to(&mut png, image::ImageFormat::Png).is_err() {
        return String::new();
    }
    use base64::Engine as _;
    base64::engine::general_purpose::STANDARD.encode(png.into_inner())
}

/// tauri 命令: 识别一张图片(剪贴板截图 / 本地图片文件字节)
#[tauri::command]
pub async fn recognize_image(bytes: Vec<u8>) -> Result<Recognition, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let origin = image::load_from_memory(&bytes)
            .map_err(|e| format!("图片解码失败: {e}"))?
            .to_rgba8();
        recognize(origin)
    })
    .await
    .map_err(|e| format!("识别任务执行失败: {e}"))?
}
