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

/** 截图识别结果(Rust 端 Recognition) */
export interface Recognition {
  /** 校正为红方在下后的 FEN(行棋方固定红 w, 由用户确认) */
  fen: string;
  /** 是否通过布局合法性校验 */
  legal: boolean;
  /** 校验提示 */
  issues: string[];
  /** 识别到的棋子数 */
  pieces_count: number;
  /** 识别区域 PNG 预览图 base64 */
  preview_base64: string;
}

/** 识别一张截图(剪贴板粘贴/本地上传的图片字节) */
export function recognizeImage(bytes: Uint8Array): Promise<Recognition> {
  return invoke<Recognition>("recognize_image", { bytes });
}
