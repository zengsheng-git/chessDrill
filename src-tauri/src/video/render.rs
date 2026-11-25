// 视频帧渲染: 竖版 1080x1920
// 棋盘与棋子视觉 1:1 翻译自本项目前端 Board.tsx(SVG):
//   渐变木底板 / #7a5426 格线 / 楷体楚河汉界与路数 / 径向渐变棋子面 + 描边内环 + 柔投影 /
//   起点绿色四角括号 + 落点绿色圆环 / 将军红圈; 画布背景与文字配色取自 index.css 主题。
// 布局按本画面重新设计: 标题 + 大棋盘居中 + 当前行棋 + 底部字幕条(留抖音安全区)。
use ab_glyph::{Font as _, FontVec, ScaleFont as _};
use image::{Rgba, RgbaImage};
use imageproc::drawing::{
    draw_hollow_circle_mut, draw_line_segment_mut, draw_text_mut,
};
use imageproc::rect::Rect;
use std::collections::HashMap;

pub const FPS: u32 = 30;
pub const CANVAS_W: u32 = 1080;
pub const CANVAS_H: u32 = 1920;

/// 棋盘: board[row][col]; row 0 为画面顶部(黑方底线), 大写=红方
pub type Board = [[char; 9]; 10];

const QITI_TTF: &[u8] = include_bytes!("../../assets/qiti.ttf");

// ---- 主题色(index.css)与棋盘色(Board.tsx) ----
const BG: [u8; 3] = [0xf5, 0xf0, 0xe2]; // --c-ink-950 画布底
const INK_200: [u8; 3] = [0x3c, 0x34, 0x2a]; // --c-ink-200 主文字
const INK_300: [u8; 3] = [0x6f, 0x60, 0x46]; // --c-ink-300
const INK_400: [u8; 3] = [0x98, 0x87, 0x6a]; // --c-ink-400 次要文字
const SUB_TITLE_TEXT: [u8; 3] = [0xf5, 0xf0, 0xe2]; // 字幕文字(米白)
const SUB_BAND: [u8; 3] = [0x3c, 0x34, 0x2a]; // 字幕条底(ink-200)
const GRID: Rgba<u8> = Rgba([0x7a, 0x54, 0x26, 255]); // 格线 #7a5426
const FRAME: Rgba<u8> = Rgba([0x8a, 0x5a, 0x20, 255]); // 外框 #8a5a20
const RIVER_TEXT: [u8; 3] = [0x9a, 0x74, 0x34]; // 楚河汉界 #9a7434
const COORD_TEXT: [u8; 3] = [0x6b, 0x4a, 0x1e]; // 路数 #6b4a1e
const MARK_GREEN: Rgba<u8> = Rgba([0x2e, 0x9e, 0x5b, 255]); // 走子标记 #2e9e5b
const CHECK_RED: Rgba<u8> = Rgba([0xdc, 0x26, 0x26, 230]); // 将军 #dc2626
// 木底板渐变 #f0d8a8 → #e6c68c(55%) → #dcb877
const WOOD_1: [u8; 3] = [0xf0, 0xd8, 0xa8];
const WOOD_2: [u8; 3] = [0xe6, 0xc6, 0x8c];
const WOOD_3: [u8; 3] = [0xdc, 0xb8, 0x77];

// ---- 棋盘几何(Board.tsx 按 scale=CELL'/62 换算; SVG CELL=62 PAD=46 R=26) ----
const CELL: i32 = 108; // 62 * 1.742
const PAD: i32 = 80; // 46 * 1.742
const PIECE_R: i32 = 45; // 26 * 1.742
const BOARD_W: i32 = PAD * 2 + CELL * 8; // 1024
const BOARD_X: i32 = (CANVAS_W as i32 - BOARD_W) / 2; // 28, 水平绝对居中
const BOARD_Y: i32 = 200; // 棋盘图左上角

// 信息区
const TITLE_Y: i32 = 52;
const TITLE_SIZE: f32 = 50.0;
const HEADLINE_Y: i32 = 126;
const HEADLINE_SIZE: f32 = 30.0;
const MAIN_Y: i32 = 1386; // 当前行棋大字 / 开场结尾信息行起点
const MAIN_SIZE: f32 = 46.0;
const INFO_SIZE: f32 = 32.0;
const INFO_STEP: i32 = 54;
// 字幕条(底部, 留抖音安全区)
const SUB_BAND_X: i32 = 40;
const SUB_BAND_Y: i32 = 1466;
const SUB_BAND_W: i32 = 1000;
const SUB_BAND_H: i32 = 150;
const SUB_BAND_R: i32 = 24;
const SUB_SIZE: f32 = 38.0;
const SUB_LINE_STEP: i32 = 58;
pub const SUBTITLE_MAX_CHARS: usize = 26;

/// 一个场景的一帧所需全部数据
pub struct FrameScene {
    pub board_before: Board,
    pub board_after: Board,
    /// 走子场景: 本手着法(ICCS); None = 开场/结尾卡
    pub move_iccs: Option<String>,
    pub title: String,
    /// 顶部副标题行(副标题/题库/说明)
    pub headline: String,
    /// 底部大字行: "第 3 手 · 红方 炮二平五"(走子场景)
    pub current_move: Option<String>,
    /// 开场/结尾信息行(大字行位置)
    pub info_lines: Vec<String>,
    /// 完整解说词(供 TTS 与时长估算)
    pub subtitle: String,
    /// 按场景进度轮播的字幕分段
    pub subtitles: Vec<String>,
    /// 被将军的将帅位置(棋盘坐标 row0=顶)
    pub check_pos: Option<(usize, usize)>,
}

/// 标准中国象棋 FEN → 棋盘; 返回 (棋盘, 行棋方 'w'红/'b'黑)
pub fn fen_to_board(fen: &str) -> Result<(Board, char), String> {
    let parts: Vec<&str> = fen.trim().split_whitespace().collect();
    let rows: Vec<&str> = parts.first().ok_or("FEN 为空")?.split('/').collect();
    if rows.len() != 10 {
        return Err(format!("FEN 行数不是 10: {}", rows.len()));
    }
    let mut board: Board = [[' '; 9]; 10];
    for (i, row) in rows.iter().enumerate() {
        let mut col = 0usize;
        for ch in row.chars() {
            if let Some(n) = ch.to_digit(10) {
                col += n as usize;
            } else {
                if col >= 9 {
                    return Err(format!("FEN 第 {i} 行列数超界"));
                }
                board[i][col] = ch;
                col += 1;
            }
        }
        if col != 9 {
            return Err(format!("FEN 第 {i} 行列数不是 9: {col}"));
        }
    }
    let side = parts.get(1).copied().unwrap_or("w").chars().next().unwrap_or('w');
    Ok((board, side))
}

/// 找某方的将/帅位置: side 'w'(红) 找 'K', 'b'(黑) 找 'k'
pub fn find_king(board: &Board, side: char) -> Option<(usize, usize)> {
    let king = if side == 'w' { 'K' } else { 'k' };
    for row in 0..10 {
        for col in 0..9 {
            if board[row][col] == king {
                return Some((col, row));
            }
        }
    }
    None
}

/// 解析 ICCS 着法 → (from_col, from_row, to_col, to_row, 移动的棋子)
/// 数字端 0 为画面底部(红方底线), 换算 row = 9 - digit
pub fn iccs_endpoints(board: &Board, iccs: &str) -> (usize, usize, usize, usize, char) {
    let digit = |c: u8| -> usize {
        (c as char)
            .to_digit(10)
            .unwrap_or_else(|| panic!("ICCS 行号无效: {}", c as char)) as usize
    };
    let b = iccs.as_bytes();
    let fx = (b[0] as usize) - 97;
    let fy = 9 - digit(b[1]);
    let tx = (b[2] as usize) - 97;
    let ty = 9 - digit(b[3]);
    (fx, fy, tx, ty, board[fy][fx])
}

// 棋子字形(与前端 pieceGlyph 一致)
fn piece_glyph(piece: char) -> char {
    match piece {
        'K' => '帅', 'A' => '仕', 'B' => '相', 'N' => '马', 'R' => '车', 'C' => '炮', 'P' => '兵',
        'k' => '将', 'a' => '士', 'b' => '象', 'n' => '马', 'r' => '车', 'c' => '炮', 'p' => '卒',
        _ => '?',
    }
}

// 棋子文字色: 红 #b02818 / 黑 #26221c; 描边: 红 #a03020 / 黑 #3a3a3a; 内环: 红 #c2402a / 黑 #4a4a4a
const FACE_EDGE_W: i32 = 3; // 描边宽(1.6 * 1.742)

pub struct Renderer {
    kai_font: FontVec,   // 楷体(--font-piece): 标题/棋子/楚河汉界/记谱大字
    text_font: FontVec,  // 正文字体: 副标题/字幕/数字路数
    pieces: HashMap<char, RgbaImage>, // 预烘焙棋子精灵(渐变面+描边+内环+投影+字)
    board_cache: RgbaImage, // 静态底图(背景+完整棋盘), 每帧 clone
}

impl Renderer {
    pub fn new() -> Result<Self, String> {
        // 楷体(--font-piece 首选 KaiTi), 缺失退回内置楷风字体
        let kai_font = match std::fs::read("C:/Windows/Fonts/simkai.ttf") {
            Ok(bytes) => FontVec::try_from_vec(bytes)
                .unwrap_or_else(|_| FontVec::try_from_vec(QITI_TTF.to_vec()).unwrap()),
            Err(_) => FontVec::try_from_vec(QITI_TTF.to_vec())
                .map_err(|e| format!("楷体加载失败: {e}"))?,
        };
        // 正文: 微软雅黑(msyh.ttc face 0) → 黑体 → 内置兜底
        let text_font = load_body_font()?;
        let mut renderer = Renderer {
            kai_font,
            text_font,
            pieces: HashMap::new(),
            board_cache: RgbaImage::new(1, 1),
        };
        // 预烘焙 14 种棋子精灵(红大写/黑小写)
        for piece in [
            'K', 'A', 'B', 'N', 'R', 'C', 'P', 'k', 'a', 'b', 'n', 'r', 'c', 'p',
        ] {
            let sprite = renderer.bake_piece(piece);
            renderer.pieces.insert(piece, sprite);
        }
        // 静态底图
        let mut cache = RgbaImage::new(CANVAS_W, CANVAS_H);
        renderer.draw_background(&mut cache);
        renderer.draw_board(&mut cache);
        renderer.board_cache = cache;
        Ok(renderer)
    }

    // 单个棋子精灵: 画布 (PIECE_R*2 + 24) 见方, 中心留投影偏移余量
    fn bake_piece(&self, piece: char) -> RgbaImage {
        let red = piece.is_uppercase();
        let r = PIECE_R;
        let pad = 12;
        let size = (r + pad * 2) as u32 * 2;
        let mut img = RgbaImage::new(size, size);
        let mid = size as i32 / 2;
        let shadow_dy = 4;

        // 柔和投影(多层同心圆近似高斯衰减; SVG dropShadow dy≈4 blur≈4)
        // 画在渐变面之前, 大部分被棋子面覆盖, 露出下缘月牙影
        for (grow, alpha) in [(7u8, 26u8), (4, 36), (1, 44)] {
            paint_circle(&mut img, mid, mid + shadow_dy, r + grow as i32, Rgba([0x3a, 0x2a, 0x12, alpha]));
        }

        // 径向渐变棋子面: 中心偏移 (-0.24R, -0.36R), 半径 0.85*2R; 三段色 #faf0d8/#f1e2bd/#e2cb98
        let gcx = mid - (0.24 * r as f32) as i32;
        let gcy = mid - (0.36 * r as f32) as i32;
        let grad_r = 0.85 * 2.0 * r as f32;
        let c1 = [0xfa, 0xf0, 0xd8];
        let c2 = [0xf1, 0xe2, 0xbd];
        let c3 = [0xe2, 0xcb, 0x98];
        for y in (mid - r - 2)..=(mid + r + 2) {
            for x in (mid - r - 2)..=(mid + r + 2) {
                let dx = x - mid;
                let dy = y - mid;
                let dist2 = dx * dx + dy * dy;
                if dist2 > (r + 1) * (r + 1) {
                    continue;
                }
                let gdx = (x - gcx) as f32;
                let gdy = (y - gcy) as f32;
                let t = ((gdx * gdx + gdy * gdy).sqrt() / grad_r).clamp(0.0, 1.0);
                let c = if t < 0.7 {
                    lerp3(&c1, &c2, t / 0.7)
                } else {
                    lerp3(&c2, &c3, (t - 0.7) / 0.3)
                };
                img.put_pixel(x as u32, y as u32, Rgba([c[0], c[1], c[2], 255]));
            }
        }

        // 外描边(红 #a03020 / 黑 #3a3a3a, 宽 ~3)
        let edge = if red { [0xa0, 0x30, 0x20] } else { [0x3a, 0x3a, 0x3a] };
        stroke_circle(&mut img, mid, mid, r, FACE_EDGE_W, edge);

        // 内环(红 #c2402a / 黑 #4a4a4a, 宽 2, 透明度 0.7)
        let inner = if red { [0xc2, 0x40, 0x2a] } else { [0x4a, 0x4a, 0x4a] };
        stroke_circle(&mut img, mid, mid, r - 9, 2, inner);

        // 字(楷体 700, 红 #b02818 / 黑 #26221c, 垂直微调 1px*scale)
        let glyph = piece_glyph(piece);
        let color = if red { [0xb0, 0x28, 0x18] } else { [0x26, 0x22, 0x1c] };
        let size_f = 30.0 * 1.742; // 52
        let w = text_width(&self.kai_font, size_f, &glyph.to_string());
        draw_text_mut(
            &mut img,
            Rgba([color[0], color[1], color[2], 255]),
            mid - (w / 2.0) as i32,
            mid - (size_f / 2.0) as i32 + 2,
            size_f,
            &self.kai_font,
            &glyph.to_string(),
        );
        img
    }

    // 画布底色(纯色, 与应用 body 一致)
    fn draw_background(&self, canvas: &mut RgbaImage) {
        for p in canvas.pixels_mut() {
            *p = Rgba([BG[0], BG[1], BG[2], 255]);
        }
    }

    // 完整棋盘: 渐变木底板 + 外框 + 格线 + 九宫 + 角标 + 楚河汉界 + 路数
    fn draw_board(&self, canvas: &mut RgbaImage) {
        let ox = BOARD_X;
        let oy = BOARD_Y;
        let px = |col: i32| ox + PAD + col * CELL;
        let py = |row: i32| oy + PAD + row * CELL;

        // 木底板: SVG rect(10,10,568,630) rx=14 → (17,17,989,1097) rx=24, 对角三段渐变
        draw_round_rect_gradient(
            canvas,
            ox + 17,
            oy + 17,
            (568.0 * 1.742) as i32,
            (630.0 * 1.742) as i32,
            24,
            &WOOD_1,
            &WOOD_2,
            &WOOD_3,
        );

        // 外框: SVG rect(PAD-7, PAD-7, 8C+14, 9C+14) w3 → 缩进12 宽5
        draw_rect_stroke(
            canvas,
            px(0) - 12,
            py(0) - 12,
            CELL * 8 + 24,
            CELL * 9 + 24,
            5,
            FRAME,
        );

        // 横线 10 条
        for row in 0..=9 {
            draw_line_w(canvas, px(0), py(row), px(8), py(row), 2, GRID);
        }
        // 竖线 9 条(中列在河界断开)
        for col in 0..=8 {
            if col == 0 || col == 8 {
                draw_line_w(canvas, px(col), py(0), px(col), py(9), 2, GRID);
            } else {
                draw_line_w(canvas, px(col), py(0), px(col), py(4), 2, GRID);
                draw_line_w(canvas, px(col), py(5), px(col), py(9), 2, GRID);
            }
        }
        // 九宫斜线
        for (x0, y0, x1, y1) in [(3, 0, 5, 2), (5, 0, 3, 2), (3, 7, 5, 9), (5, 7, 3, 9)] {
            draw_line_w(canvas, px(x0), py(y0), px(x1), py(y1), 2, GRID);
        }
        // 炮/兵位角标(gap5 len7 → 9/12; 两侧限界)
        for (col, row) in [
            (1, 2), (7, 2), (1, 7), (7, 7),
            (0, 3), (2, 3), (4, 3), (6, 3), (8, 3),
            (0, 6), (2, 6), (4, 6), (6, 6), (8, 6),
        ] {
            draw_corner_marks(canvas, px(col), py(row), 9, 12, 2, col == 0, col == 8);
        }

        // 楚河汉界: 楷体 52 #9a7434 op0.75, 组中心在 2/6 列; 两字左右对称分布
        let river_cy = (py(4) + py(5)) / 2;
        let river_size = 52.0;
        let half_gap = (river_size * 0.85) as i32;
        for (cx, text) in [(px(2), "楚河"), (px(6), "汉界")] {
            let chars: Vec<char> = text.chars().collect();
            for (i, ch) in chars.iter().enumerate() {
                let center = cx + if i == 0 { -half_gap } else { half_gap };
                let w = text_width(&self.kai_font, river_size, &ch.to_string());
                draw_text_mut(
                    canvas,
                    Rgba([RIVER_TEXT[0], RIVER_TEXT[1], RIVER_TEXT[2], 190]),
                    center - (w / 2.0) as i32,
                    river_cy - (river_size / 2.0) as i32,
                    river_size,
                    &self.kai_font,
                    &ch.to_string(),
                );
            }
        }

        // 路数: 顶部黑方数字(正文体), 底部红方汉字(楷体); 外移避开首末行棋子
        let red_nums = ["九", "八", "七", "六", "五", "四", "三", "二", "一"];
        let coord_size = 26.0;
        for col in 0..=8 {
            let num = (col + 1).to_string();
            draw_text_center(
                canvas,
                &self.text_font,
                coord_size,
                rgb(COORD_TEXT),
                px(col),
                py(0) - 62,
                &num,
            );
            draw_text_center(
                canvas,
                &self.kai_font,
                coord_size,
                rgb(COORD_TEXT),
                px(col),
                py(9) + 62,
                red_nums[col as usize],
            );
        }
    }

    /// 绘制一帧. t ∈ [0,1]; t<1 表示走子动画进度, t>=1 为落定状态
    pub fn render_frame(&self, scene: &FrameScene, t: f32) -> RgbaImage {
        let mut canvas = self.board_cache.clone();
        let animating = t < 1.0 && scene.move_iccs.is_some();

        let px = |col: usize| BOARD_X + PAD + col as i32 * CELL;
        let py = |row: usize| BOARD_Y + PAD + row as i32 * CELL;

        if animating {
            // 动画阶段: 其他棋子取 before 局面, 移动棋子 ease-out 插值
            let (fx, fy, tx, ty, piece) = {
                let iccs = scene.move_iccs.as_ref().expect("animating 需要 move_iccs");
                iccs_endpoints(&scene.board_before, iccs)
            };
            // 起点绿色四角括号
            draw_corner_bracket(&mut canvas, px(fx), py(fy), 30, 16, 4, MARK_GREEN);
            for row in 0..10usize {
                for col in 0..9usize {
                    if (col, row) != (fx, fy) && scene.board_before[row][col] != ' ' {
                        self.overlay_piece(&mut canvas, scene.board_before[row][col], px(col), py(row));
                    }
                }
            }
            let ease = 1.0 - (1.0 - t).powi(3);
            let cx = (px(fx) as f32 + (px(tx) - px(fx)) as f32 * ease) as i32;
            let cy = (py(fy) as f32 + (py(ty) - py(fy)) as f32 * ease) as i32;
            if piece != ' ' {
                self.overlay_piece(&mut canvas, piece, cx, cy);
            }
        } else {
            // 落定状态
            for row in 0..10usize {
                for col in 0..9usize {
                    let piece = scene.board_after[row][col];
                    if piece != ' ' {
                        self.overlay_piece(&mut canvas, piece, px(col), py(row));
                    }
                }
            }
            if let Some(iccs) = &scene.move_iccs {
                let (fx, fy, tx, ty, _) = iccs_endpoints(&scene.board_after, iccs);
                // 起点绿括号 + 落点绿圆环(天天象棋风格, 与前端一致)
                draw_corner_bracket(&mut canvas, px(fx), py(fy), 30, 16, 4, MARK_GREEN);
                draw_ring_w(&mut canvas, px(tx), py(ty), PIECE_R + 5, 4, MARK_GREEN);
            }
        }

        // 被将军的将帅红圈
        if let Some((kx, ky)) = scene.check_pos {
            if !animating {
                draw_ring_w(&mut canvas, px(kx), py(ky), PIECE_R + 14, 5, CHECK_RED);
            }
        }

        self.draw_panel(&mut canvas, scene);
        self.draw_subtitle(&mut canvas, scene, t);
        canvas
    }

    fn overlay_piece(&self, canvas: &mut RgbaImage, piece: char, cx: i32, cy: i32) {
        if let Some(sprite) = self.pieces.get(&piece) {
            image::imageops::overlay(
                canvas,
                sprite,
                (cx - sprite.width() as i32 / 2) as i64,
                (cy - sprite.height() as i32 / 2) as i64,
            );
        }
    }

    // 顶部标题/副标题 + 底部当前行棋大字或开场结尾信息行
    fn draw_panel(&self, canvas: &mut RgbaImage, scene: &FrameScene) {
        let cx = CANVAS_W as i32 / 2;
        draw_text_center(canvas, &self.kai_font, TITLE_SIZE, rgb(INK_200), cx, TITLE_Y, &scene.title);
        if !scene.headline.is_empty() {
            draw_text_center(canvas, &self.text_font, HEADLINE_SIZE, rgb(INK_400), cx, HEADLINE_Y, &scene.headline);
        }

        if let Some(mv) = &scene.current_move {
            draw_text_center(canvas, &self.kai_font, MAIN_SIZE, rgb(INK_200), cx, MAIN_Y, mv);
        }
        let mut y = MAIN_Y;
        for line in &scene.info_lines {
            draw_text_center(canvas, &self.text_font, INFO_SIZE, rgb(INK_300), cx, y, line);
            y += INFO_STEP;
        }
    }

    // 字幕: 长解说词已切段, 按场景进度 t 轮播; 深色圆角条 + 米白字
    fn draw_subtitle(&self, canvas: &mut RgbaImage, scene: &FrameScene, t: f32) {
        let chunks = &scene.subtitles;
        if chunks.is_empty() {
            return;
        }
        let idx = ((t * chunks.len() as f32) as usize).min(chunks.len() - 1);
        let text = &chunks[idx];
        fill_round_rect_blend(canvas, SUB_BAND_X, SUB_BAND_Y, SUB_BAND_W, SUB_BAND_H, SUB_BAND_R, rgb(SUB_BAND), 242);
        let lines = wrap_chars(text, SUBTITLE_MAX_CHARS);
        let mut y = if lines.len() > 1 {
            SUB_BAND_Y + (SUB_BAND_H - lines.len() as i32 * SUB_LINE_STEP) / 2
        } else {
            SUB_BAND_Y + (SUB_BAND_H - SUB_SIZE as i32) / 2
        };
        for line in lines {
            draw_text_center(canvas, &self.text_font, SUB_SIZE, rgb(SUB_TITLE_TEXT), CANVAS_W as i32 / 2, y, &line);
            y += SUB_LINE_STEP;
        }
    }
}

// ---------- 绘制工具 ----------

fn rgb(c: [u8; 3]) -> Rgba<u8> {
    Rgba([c[0], c[1], c[2], 255])
}

fn lerp3(a: &[u8; 3], b: &[u8; 3], t: f32) -> [u8; 3] {
    let f = |x: u8, y: u8| (x as f32 + (y as f32 - x as f32) * t).round() as u8;
    [f(a[0], b[0]), f(a[1], b[1]), f(a[2], b[2])]
}

fn text_width(font: &FontVec, px_size: f32, text: &str) -> f32 {
    let scaled = font.as_scaled(px_size);
    text.chars().map(|c| scaled.h_advance(scaled.glyph_id(c))).sum()
}

fn draw_text_center(canvas: &mut RgbaImage, font: &FontVec, px_size: f32, color: Rgba<u8>, cx: i32, y: i32, text: &str) {
    let w = text_width(font, px_size, text);
    draw_text_mut(canvas, color, cx - (w / 2.0) as i32, y, px_size, font, text);
}

// 圆内 source-over 合成(保留画布已有 alpha, 用于精灵半透明投影)
fn paint_circle(canvas: &mut RgbaImage, cx: i32, cy: i32, r: i32, color: Rgba<u8>) {
    let sa = color[3] as f32 / 255.0;
    if sa <= 0.0 {
        return;
    }
    let r2 = r * r;
    for y in (cy - r)..=(cy + r) {
        if y < 0 || y >= canvas.height() as i32 {
            continue;
        }
        for x in (cx - r)..=(cx + r) {
            if x < 0 || x >= canvas.width() as i32 {
                continue;
            }
            let dx = x - cx;
            let dy = y - cy;
            if dx * dx + dy * dy > r2 {
                continue;
            }
            let d = canvas.get_pixel(x as u32, y as u32);
            let da = d[3] as f32 / 255.0;
            let oa = sa + da * (1.0 - sa);
            if oa <= 0.0 {
                continue;
            }
            let mix = |s: u8, b: u8| ((s as f32 * sa + b as f32 * da * (1.0 - sa)) / oa) as u8;
            canvas.put_pixel(
                x as u32,
                y as u32,
                Rgba([mix(color[0], d[0]), mix(color[1], d[1]), mix(color[2], d[2]), (oa * 255.0) as u8]),
            );
        }
    }
}

// 圆环描边(像素级, 任意宽度)
fn stroke_circle(canvas: &mut RgbaImage, cx: i32, cy: i32, r: i32, width: i32, color: [u8; 3]) {
    let outer = (r + width / 2 + 1) as i64;
    let outer2 = outer * outer;
    let inner = (r - width / 2 - 1).max(0) as i64;
    let inner2 = inner * inner;
    for y in (cy - outer as i32)..=(cy + outer as i32) {
        if y < 0 || y >= canvas.height() as i32 {
            continue;
        }
        for x in (cx - outer as i32)..=(cx + outer as i32) {
            if x < 0 || x >= canvas.width() as i32 {
                continue;
            }
            let dx = (x - cx) as i64;
            let dy = (y - cy) as i64;
            let d2 = dx * dx + dy * dy;
            if d2 <= outer2 && d2 >= inner2 {
                canvas.put_pixel(x as u32, y as u32, Rgba([color[0], color[1], color[2], 255]));
            }
        }
    }
}

// 粗线段(沿法线偏移多条 1px 线)
fn draw_line_w(canvas: &mut RgbaImage, x0: i32, y0: i32, x1: i32, y1: i32, width: i32, color: Rgba<u8>) {
    let dx = (x1 - x0) as f32;
    let dy = (y1 - y0) as f32;
    let len = (dx * dx + dy * dy).sqrt().max(1.0);
    let nx = -dy / len;
    let ny = dx / len;
    let half = (width - 1) as f32 / 2.0;
    for i in 0..width {
        let off = -half + i as f32;
        draw_line_segment_mut(
            canvas,
            (x0 as f32 + nx * off, y0 as f32 + ny * off),
            (x1 as f32 + nx * off, y1 as f32 + ny * off),
            color,
        );
    }
}

// 圆环(多圈加宽)
fn draw_ring_w(canvas: &mut RgbaImage, cx: i32, cy: i32, r: i32, width: i32, color: Rgba<u8>) {
    let half = width / 2;
    for rr in (r - half)..=(r + half) {
        draw_hollow_circle_mut(canvas, (cx, cy), rr, color);
    }
}

// 矩形描边
fn draw_rect_stroke(canvas: &mut RgbaImage, x: i32, y: i32, w: i32, h: i32, width: i32, color: Rgba<u8>) {
    for i in 0..width {
        let r = Rect::at(x + i, y + i).of_size((w - 2 * i).max(1) as u32, (h - 2 * i).max(1) as u32);
        imageproc::drawing::draw_hollow_rect_mut(canvas, r, color);
    }
}

// 圆角矩形判断(内部点)
fn in_round_rect(x: i32, y: i32, rx0: i32, ry0: i32, w: i32, h: i32, r: i32) -> bool {
    if x < rx0 || y < ry0 || x >= rx0 + w || y >= ry0 + h {
        return false;
    }
    let cx = x - rx0;
    let cy = y - ry0;
    let dx = if cx < r { r - cx } else if cx >= w - r { cx - (w - r - 1) } else { 0 };
    let dy = if cy < r { r - cy } else if cy >= h - r { cy - (h - r - 1) } else { 0 };
    dx * dx + dy * dy <= r * r
}

// 圆角矩形渐变填充(对角三段色)
#[allow(clippy::too_many_arguments)]
fn draw_round_rect_gradient(
    canvas: &mut RgbaImage,
    x: i32,
    y: i32,
    w: i32,
    h: i32,
    r: i32,
    c1: &[u8; 3],
    c2: &[u8; 3],
    c3: &[u8; 3],
) {
    for yy in y..y + h {
        for xx in x..x + w {
            if !in_round_rect(xx, yy, x, y, w, h, r) {
                continue;
            }
            let t = (((xx - x) as f32 / w as f32) + ((yy - y) as f32 / h as f32)) / 2.0;
            let c = if t < 0.55 {
                lerp3(c1, c2, t / 0.55)
            } else {
                lerp3(c2, c3, (t - 0.55) / 0.45)
            };
            canvas.put_pixel(xx as u32, yy as u32, Rgba([c[0], c[1], c[2], 255]));
        }
    }
}

// 圆角矩形 alpha 混合填充(字幕条)
fn fill_round_rect_blend(canvas: &mut RgbaImage, x: i32, y: i32, w: i32, h: i32, r: i32, color: Rgba<u8>, alpha: u8) {
    for yy in y..y + h {
        for xx in x..x + w {
            if !in_round_rect(xx, yy, x, y, w, h, r) {
                continue;
            }
            if xx < 0 || yy < 0 || xx >= canvas.width() as i32 || yy >= canvas.height() as i32 {
                continue;
            }
            let bg = canvas.get_pixel(xx as u32, yy as u32);
            let inv = 255 - alpha as u32;
            let mix = |fg: u8, b: u8| ((fg as u32 * alpha as u32 + b as u32 * inv) / 255) as u8;
            canvas.put_pixel(xx as u32, yy as u32, Rgba([mix(color[0], bg[0]), mix(color[1], bg[1]), mix(color[2], bg[2]), 255]));
        }
    }
}

// 炮/兵位角标: 四象限 L 形(Board.tsx cornerPath; 两侧限界)
#[allow(clippy::too_many_arguments)]
fn draw_corner_marks(canvas: &mut RgbaImage, cx: i32, cy: i32, gap: i32, len: i32, w: i32, has_left: bool, has_right: bool) {
    for (sx, has_x) in [(-1, has_left), (1, has_right)] {
        if !has_x {
            continue;
        }
        for sy in [-1i32, 1] {
            let jx = cx + sx * gap;
            let jy = cy + sy * gap;
            draw_line_w(canvas, jx, jy, jx + sx * len, jy, w, GRID);
            draw_line_w(canvas, jx, jy, jx, jy + sy * len, w, GRID);
        }
    }
}

// 走子起点四角括号(四向 L 形, 天天象棋风格)
fn draw_corner_bracket(canvas: &mut RgbaImage, cx: i32, cy: i32, gap: i32, len: i32, w: i32, color: Rgba<u8>) {
    for sx in [-1i32, 1] {
        for sy in [-1i32, 1] {
            let jx = cx + sx * gap;
            let jy = cy + sy * gap;
            draw_line_w(canvas, jx, jy, jx + sx * len, jy, w, color);
            draw_line_w(canvas, jx, jy, jx, jy + sy * len, w, color);
        }
    }
}

// 按字符数折行(最多两行, 超长部分舍去), max=0 表示不折行
fn wrap_chars(text: &str, max: usize) -> Vec<String> {
    if max == 0 {
        return vec![text.to_string()];
    }
    let total = text.chars().count();
    if total <= max {
        return vec![text.to_string()];
    }
    let first: String = text.chars().take(max).collect();
    let second: String = text.chars().skip(max).take(max).collect();
    vec![first, second]
}

// 正文/字幕字体: 微软雅黑(msyh.ttc face 0) → 黑体 → 内置楷风兜底
fn load_body_font() -> Result<FontVec, String> {
    let from_file = |path: &str, index: u32| -> Option<FontVec> {
        let bytes = std::fs::read(path).ok()?;
        if path.ends_with(".ttc") {
            FontVec::try_from_vec_and_index(bytes, index).ok()
        } else {
            FontVec::try_from_vec(bytes).ok()
        }
    };
    let font = from_file("C:/Windows/Fonts/msyh.ttc", 0)
        .or_else(|| from_file("C:/Windows/Fonts/msyh.ttf", 0))
        .or_else(|| from_file("C:/Windows/Fonts/simhei.ttf", 0))
        .unwrap_or_else(|| FontVec::try_from_vec(QITI_TTF.to_vec()).expect("内置字体无效"));
    Ok(font)
}

/// 把长解说词切成多条字幕(每条 ≤ max 字), 优先在标点处断句, 各段随场景进度轮播
pub fn split_subtitle(text: &str, max: usize) -> Vec<String> {
    let text = text.trim();
    if text.is_empty() {
        return vec![];
    }
    if max == 0 {
        return vec![text.to_string()];
    }
    let chars: Vec<char> = text.chars().collect();
    if chars.len() <= max {
        return vec![text.to_string()];
    }
    // 先定段数使每段尽量均匀, 再在目标断点附近找标点
    let n = (chars.len() + max - 1) / max;
    let target = (chars.len() + n - 1) / n;
    const BREAKS: [char; 9] = ['，', '。', '！', '？', '；', '、', ',', '.', ' '];
    let mut out = Vec::new();
    let mut start = 0usize;
    while start < chars.len() {
        let end = (start + target).min(chars.len());
        let mut cut = end;
        if end < chars.len() {
            // 从目标断点向回找最近的标点(最多回看 8 字, 避免产生碎片段)
            for i in (start + 1..=end).rev() {
                if BREAKS.contains(&chars[i - 1]) {
                    cut = i;
                    break;
                }
                if end - i >= 8 {
                    break;
                }
            }
        }
        let cut = cut.max(start + 1);
        let seg: String = chars[start..cut].iter().collect();
        let seg = seg.trim();
        if !seg.is_empty() {
            out.push(seg.to_string());
        }
        start = cut;
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_fen_to_board() {
        // 标准开局: 第一行黑方底线(rnbakabnr), 最后行红方底线(RNBAKABNR), 红先行
        let (board, side) = fen_to_board("rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABNR w - - 0 1").unwrap();
        assert_eq!(side, 'w');
        assert_eq!(board[0][0], 'r'); // 顶部(黑)左角 = 黑车
        assert_eq!(board[9][0], 'R'); // 底部(红)左角 = 红车
        assert_eq!(board[9][4], 'K'); // 红帅
        assert_eq!(board[0][4], 'k'); // 黑将
        assert_eq!(find_king(&board, 'w'), Some((4, 9)));
        assert_eq!(find_king(&board, 'b'), Some((4, 0)));
    }

    #[test]
    fn test_iccs_endpoints() {
        // chessDrill ICCS: 字母=列, 数字=行(0 为红方底线) → "a0a1" = 红方左侧第一步
        let mut board: Board = [[' '; 9]; 10];
        board[9][0] = 'R';
        let (fx, fy, tx, ty, piece) = iccs_endpoints(&board, "a0a1");
        assert_eq!((fx, fy, tx, ty), (0, 9, 0, 8));
        assert_eq!(piece, 'R');
    }

    #[test]
    fn test_split_subtitle() {
        assert_eq!(split_subtitle("", 24), Vec::<String>::new());
        assert_eq!(split_subtitle("短解说", 24), vec!["短解说".to_string()]);
        let long = "一".repeat(49);
        let chunks = split_subtitle(&long, 24);
        assert_eq!(chunks.len(), 3);
        assert!(chunks.iter().all(|c| c.chars().count() <= 24));
    }

    // 视觉验证: 渲染走子场景关键帧落盘 %TEMP%/chessdrill-video-preview/ (人工查看)
    // 运行: cargo test --lib test_dump_frames -- --ignored
    #[test]
    #[ignore]
    fn test_dump_frames() {
        let (board, _) =
            fen_to_board("rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABNR w - - 0 1").unwrap();
        // 模拟"炮二平五"后的局面做走子落定帧
        let (after, _) =
            fen_to_board("rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C2C4/9/RNBAKABNR b - - 0 1").unwrap();
        let sub = "红方架中炮, 直指黑方中路, 一步积极的开局选择。我们一步一步来看。";
        let scene = FrameScene {
            board_before: board,
            board_after: after,
            move_iccs: Some("h2e2".to_string()),
            title: "中炮对屏风马".to_string(),
            headline: "红：演示 · 黑：对手".to_string(),
            current_move: Some("第 1 手 · 红方 炮二平五".to_string()),
            info_lines: vec![],
            subtitle: sub.to_string(),
            subtitles: split_subtitle(sub, SUBTITLE_MAX_CHARS),
            check_pos: None,
        };
        let renderer = Renderer::new().unwrap();
        let dir = std::env::temp_dir().join("chessdrill-video-preview");
        std::fs::create_dir_all(&dir).unwrap();
        for (name, t) in [("anim", 0.35f32), ("done", 1.0)] {
            let frame = renderer.render_frame(&scene, t);
            assert_eq!((frame.width(), frame.height()), (CANVAS_W, CANVAS_H));
            let path = dir.join(format!("{name}.png"));
            frame.save(&path).unwrap();
            println!("saved {}", path.display());
        }
    }
}
