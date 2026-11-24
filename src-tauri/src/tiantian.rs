//! 天天象棋分享链接导入：经爱棋谱（秀棋谱）公开拉谱接口换取对局标题与着法串。
//! 接口契约：POST 分享链接原文到 get_qipu.php，返回 { ok, data: { title, movelist } }；
//! movelist 的十六进制坐标在 lib/record/tiantian.ts 里解析为 ICCS 着法

use std::time::Duration;

use serde::Serialize;

const FETCH_URL: &str = "https://www.iqipu.com/web/api/get_qipu.php";
/// 允许提交的分享链接前缀，防止命令被当作任意 HTTP 转发器
const ALLOWED_LINK_PREFIXES: [&str; 3] = [
    "https://speed.gamecenter.qq.com/",
    "https://xui.qq.com/",
    "https://image.qqchess.qq.com/",
];

#[derive(Serialize, Clone)]
pub struct TiantianQipu {
    /// 形如 "红方[业8-1] 先负 黑方[业8-2]"
    pub title: String,
    /// 每步 4 个十六进制位的着法串
    pub movelist: String,
}

/// 拉取天天象棋分享链接对应的棋谱（同步命令，网络阻塞由 Tauri 线程池承担）
#[tauri::command]
pub fn fetch_tiantian_qipu(link: String) -> Result<TiantianQipu, String> {
    let link = link.trim().to_string();
    if !ALLOWED_LINK_PREFIXES.iter().any(|p| link.starts_with(p)) {
        return Err("不是天天象棋分享链接".to_string());
    }

    let resp = ureq::post(FETCH_URL)
        .set("Content-Type", "text/plain;charset=UTF-8")
        .set("Referer", "https://www.iqipu.com/tools/show")
        .set("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36")
        .timeout(Duration::from_secs(20))
        .send_string(&link)
        .map_err(|e| format!("拉谱服务请求失败：{e}"))?;

    let body: serde_json::Value =
        resp.into_json().map_err(|_| "拉谱服务返回格式异常".to_string())?;
    if !body.get("ok").and_then(|v| v.as_bool()).unwrap_or(false) {
        let msg = body
            .pointer("/data/msg")
            .and_then(|v| v.as_str())
            .or_else(|| body.get("msg").and_then(|v| v.as_str()))
            .unwrap_or("服务未返回棋谱");
        return Err(format!("拉谱失败：{msg}"));
    }
    let data = body.get("data").ok_or("拉谱服务返回缺少数据")?;
    let title = data.get("title").and_then(|v| v.as_str()).unwrap_or("").trim().to_string();
    let movelist = data.get("movelist").and_then(|v| v.as_str()).unwrap_or("").to_string();
    if title.is_empty() || movelist.is_empty() {
        return Err("拉谱失败：分享链接已失效或棋谱不存在".to_string());
    }
    Ok(TiantianQipu { title, movelist })
}
