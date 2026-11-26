// 视频库: 生成成品的存储索引(每视频目录一份 meta.json)
// 模式移植自 residual-deduction(server/src/library.rs), 删除改为回收站(chessDrill 既有风格)
use std::fs;
use std::path::Path;
use std::path::PathBuf;

use serde::Deserialize;
use serde::Serialize;

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct VideoMeta {
    pub id: String,
    pub title: String,
    #[serde(default)]
    pub subtitle: String,
    pub duration_secs: f64,
    pub size_bytes: u64,
    pub created_ms: u64,
    pub move_count: usize,
    pub video_path: String,
    pub cover_path: String,
    /// 生成耗时(秒; 旧 meta 无此字段)
    #[serde(default)]
    pub elapsed_secs: f64,
}

pub fn videos_dir(base: &Path) -> PathBuf {
    base.join("videos")
}

/// 列出全部视频(按创建时间倒序); 单个 meta 损坏时跳过不阻断
pub fn list(base: &Path) -> Vec<VideoMeta> {
    let dir = videos_dir(base);
    let mut metas = Vec::new();
    let Ok(entries) = fs::read_dir(&dir) else {
        return metas;
    };
    for entry in entries.flatten() {
        let meta_file = entry.path().join("meta.json");
        if let Ok(bytes) = fs::read(&meta_file) {
            if let Ok(meta) = serde_json::from_slice::<VideoMeta>(&bytes) {
                metas.push(meta);
            }
        }
    }
    metas.sort_by(|a, b| b.created_ms.cmp(&a.created_ms));
    metas
}

/// 校验视频 id(防路径穿越)
fn ensure_valid_id(id: &str) -> Result<(), String> {
    if id.is_empty() || id.contains('/') || id.contains('\\') || id.contains("..") {
        return Err("非法的视频 id".to_string());
    }
    Ok(())
}

/// 删除视频目录(移入系统回收站, 误删可恢复)
pub fn delete(base: &Path, id: &str) -> Result<(), String> {
    ensure_valid_id(id)?;
    let dir = videos_dir(base).join(id);
    let dir = dir.canonicalize().unwrap_or(dir);
    if !dir.is_dir() {
        return Err("视频不存在".to_string());
    }
    trash::delete(&dir).map_err(|e| format!("删除失败: {e}"))
}

pub fn save_meta(base: &Path, meta: &VideoMeta) -> Result<(), String> {
    ensure_valid_id(&meta.id)?;
    let dir = videos_dir(base).join(&meta.id);
    fs::create_dir_all(&dir).map_err(|e| format!("创建目录失败: {e}"))?;
    let json = serde_json::to_string_pretty(meta).map_err(|e| format!("序列化失败: {e}"))?;
    fs::write(dir.join("meta.json"), json).map_err(|e| format!("写入元数据失败: {e}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tmp_base(name: &str) -> PathBuf {
        // 每个测试独立目录, 避免并行测试相互干扰
        let dir = std::env::temp_dir().join(format!("chessdrill-video-lib-{}-{name}", std::process::id()));
        fs::create_dir_all(dir.join("videos")).unwrap();
        dir
    }

    #[test]
    fn test_save_and_list_sorted() {
        let base = tmp_base("sorted");
        for (id, created) in [("v1", 1000u64), ("v2", 3000), ("v3", 2000)] {
            save_meta(
                &base,
                &VideoMeta {
                    id: id.into(),
                    title: id.into(),
                    subtitle: String::new(),
                    duration_secs: 1.0,
                    size_bytes: 1,
                    created_ms: created,
                    move_count: 1,
                    video_path: "a".into(),
                    cover_path: "b".into(),
                },
            )
            .unwrap();
        }
        let metas = list(&base);
        assert_eq!(metas.len(), 3);
        // 创建时间倒序
        assert_eq!(metas[0].id, "v2");
        assert_eq!(metas[1].id, "v3");
        assert_eq!(metas[2].id, "v1");
        // 清理
        fs::remove_dir_all(&base).ok();
    }

    #[test]
    fn test_delete_rejects_traversal() {
        let base = tmp_base("traversal");
        assert!(delete(&base, "../escape").is_err());
        assert!(delete(&base, "").is_err());
        assert!(delete(&base, "a\\b").is_err());
        assert!(delete(&base, "not-exist").is_err());
        fs::remove_dir_all(&base).ok();
    }

    // 旧版 meta.json(无 subtitle 字段)必须能正常读取
    #[test]
    fn test_meta_backward_compat() {
        let json = r#"{
            "id": "v20261125-120000",
            "title": "中炮对屏风马",
            "duration_secs": 60.0,
            "size_bytes": 1000000,
            "created_ms": 0,
            "move_count": 3,
            "video_path": "video.mp4",
            "cover_path": "cover.jpg"
        }"#;
        let meta: VideoMeta = serde_json::from_str(json).unwrap();
        assert_eq!(meta.subtitle, "");
        assert_eq!(meta.move_count, 3);
    }
}
