import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type { GenerateVideoParams, VideoMetaDto, VideoOutcome, VideoProgress } from "./types";

/// 注意: 传给 Rust 的对象字段保持 snake_case, 以匹配 serde 默认约定

/** 启动后台生成, 立即返回; 进度/结果通过 video://* 事件通知 */
export function generateVideo(params: GenerateVideoParams): Promise<void> {
  return invoke("generate_video", { params });
}

export function stopVideoGeneration(): Promise<void> {
  return invoke("stop_video_generation");
}

/** 在资源管理器中打开视频产物 */
export function revealVideo(path: string): Promise<void> {
  return invoke("reveal_video", { path });
}

/** 视频另存为, 返回新路径 */
export function saveVideoAs(srcPath: string, fileName: string): Promise<string> {
  return invoke<string>("save_video_as", { srcPath, fileName });
}

/** 视频库列表(按创建时间倒序) */
export function listVideos(): Promise<VideoMetaDto[]> {
  return invoke<VideoMetaDto[]>("list_videos");
}

/** 删除视频(移入系统回收站) */
export function deleteVideo(id: string): Promise<void> {
  return invoke("delete_video", { id });
}

export function listenVideoProgress(cb: (p: VideoProgress) => void): Promise<UnlistenFn> {
  return listen<VideoProgress>("video://progress", (e) => cb(e.payload));
}

export function listenVideoDone(cb: (o: VideoOutcome) => void): Promise<UnlistenFn> {
  return listen<VideoOutcome>("video://done", (e) => cb(e.payload));
}

export function listenVideoError(cb: (msg: string) => void): Promise<UnlistenFn> {
  return listen<string>("video://error", (e) => cb(e.payload));
}
