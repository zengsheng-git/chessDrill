//! 题库扫描与解析 — 兼容「一二残局」题库格式:
//! 每行一个题目: `FEN` / `2#FEN` / `FEN 中文标题` / `2#FEN 中文标题`
//! 支持空行与 `#` / `//` 注释行

use std::fs;
use std::path::{Path, PathBuf};

use serde::Serialize;
use tauri::Manager;

#[derive(Debug, Clone, Serialize)]
pub struct TikuMeta {
    /// 题库显示名(去扩展名)
    pub name: String,
    /// 题目数
    pub count: usize,
}

#[derive(Debug, Clone, Serialize)]
pub struct Question {
    pub fen: String,
    pub title: String,
    /// 执黑题(2# 前缀): 玩家执黑, 引擎执红
    pub flipped: bool,
}

fn is_cjk(s: &str) -> bool {
    s.chars().any(|c| ('\u{4e00}'..='\u{9fff}').contains(&c))
}

/// 解析一行题目; 返回 None 表示注释/空行/无效行
pub fn parse_fen_line(raw: &str) -> Option<Question> {
    let mut line = raw.trim();
    if line.is_empty() || line.starts_with('#') || line.starts_with("//") {
        return None;
    }

    let flipped = line.starts_with("2#");
    if flipped {
        line = line[2..].trim_start();
    }
    if line.is_empty() {
        return None;
    }

    let tokens: Vec<&str> = line.split_whitespace().collect();
    if tokens.len() < 2 {
        return None;
    }
    let board_part = tokens[0];
    let turn_part = tokens[1];
    if !board_part.contains('/') || (turn_part != "w" && turn_part != "b") {
        return None;
    }

    // 第一个含汉字的 token 起为标题 (跳过 FEN 六字段)
    let mut title_start = tokens.len();
    for (i, t) in tokens.iter().enumerate().skip(2) {
        if is_cjk(t) {
            title_start = i;
            break;
        }
    }
    let title = if title_start < tokens.len() {
        tokens[title_start..].join(" ")
    } else {
        String::new()
    };

    Some(Question {
        fen: tokens[..title_start.min(tokens.len())].join(" "),
        title,
        flipped,
    })
}

/// 解析题库文本
pub fn parse_tiku_text(text: &str) -> Vec<Question> {
    text.lines().filter_map(parse_fen_line).collect()
}

/// 题库目录: dev 优先取源码树, 打包版取安装资源目录
pub fn tiku_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    #[cfg(debug_assertions)]
    {
        let src = Path::new(env!("CARGO_MANIFEST_DIR")).join("resources/tiku");
        if src.is_dir() {
            return Ok(src);
        }
    }
    app.path()
        .resolve("resources/tiku", tauri::path::BaseDirectory::Resource)
        .map_err(|e| format!("解析题库资源目录失败：{e}"))
}

/// 校验题库名(防路径穿越), 返回完整路径
fn tiku_file(app: &tauri::AppHandle, name: &str) -> Result<PathBuf, String> {
    if name.is_empty()
        || name.contains('/')
        || name.contains('\\')
        || name.contains("..")
    {
        return Err("非法题库名".to_string());
    }
    Ok(tiku_dir(app)?.join(format!("{name}.txt")))
}

/// 列出全部内置题库(按文件名排序)
pub fn list_tiku_impl(app: &tauri::AppHandle) -> Result<Vec<TikuMeta>, String> {
    let dir = tiku_dir(app)?;
    let mut metas = Vec::new();
    let entries = fs::read_dir(&dir).map_err(|e| format!("读取题库目录失败：{e}"))?;
    for entry in entries {
        let entry = entry.map_err(|e| format!("读取题库目录失败：{e}"))?;
        let path = entry.path();
        if !path.is_file() {
            continue;
        }
        let ext = path.extension().and_then(|e| e.to_str());
        if !ext.map(|e| e.eq_ignore_ascii_case("txt")).unwrap_or(false) {
            continue;
        }
        let name = path
            .file_stem()
            .and_then(|s| s.to_str())
            .unwrap_or("")
            .to_string();
        if name.is_empty() {
            continue;
        }
        let text = fs::read_to_string(&path)
            .map_err(|e| format!("读取题库 {name} 失败：{e}"))?;
        let count = parse_tiku_text(&text).len();
        metas.push(TikuMeta { name, count });
    }
    metas.sort_by(|a, b| a.name.cmp(&b.name));
    Ok(metas)
}

/// 读取单个题库的全部题目
pub fn read_tiku_impl(app: &tauri::AppHandle, name: &str) -> Result<Vec<Question>, String> {
    let path = tiku_file(app, name)?;
    let text = fs::read_to_string(&path).map_err(|e| format!("读取题库 {name} 失败：{e}"))?;
    Ok(parse_tiku_text(&text))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_fen_line_variants() {
        // 执红带标题
        let q = parse_fen_line("2baka3/3P3N1/bN7/7nc/9/4C1P2/P5n1P/B3R3B/4Apr2/2RAK3c w - - 0 1 气吞关右").unwrap();
        assert!(!q.flipped);
        assert_eq!(q.title, "气吞关右");
        assert_eq!(q.fen, "2baka3/3P3N1/bN7/7nc/9/4C1P2/P5n1P/B3R3B/4Apr2/2RAK3c w - - 0 1");

        // 执黑(2# 前缀)
        let q = parse_fen_line("2#4k4/9/9/9/9/9/9/9/4R4/4K4 w - - 0 1").unwrap();
        assert!(q.flipped);
        assert_eq!(q.title, "");
        assert_eq!(q.fen, "4k4/9/9/9/9/9/9/9/4R4/4K4 w - - 0 1");

        // 注释与空行
        assert!(parse_fen_line("# comment").is_none());
        assert!(parse_fen_line("// note").is_none());
        assert!(parse_fen_line("   ").is_none());
        // 无效行
        assert!(parse_fen_line("not a fen").is_none());
    }
}
