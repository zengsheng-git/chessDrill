// 视频导出类型与常量(字段保持 snake_case 以匹配 Rust 端 serde 默认约定)

/** 一手走子(Rust 端渲染所需) */
export interface VideoMoveStep {
  /** 走子前局面 FEN */
  fen_before: string;
  /** 走子后局面 FEN */
  fen_after: string;
  /** 着法(ICCS) */
  iccs: string;
  /** 中文记谱("炮二平五") */
  notation: string;
  /** 行棋方 */
  side: "red" | "black";
  /** 走后是否将军对方 */
  check: boolean;
}

export interface GenerateVideoParams {
  title: string;
  subtitle: string;
  moves: VideoMoveStep[];
  /** 每手解说词(与 moves 等长, 空串 = 该手不配音) */
  narration: string[];
  intro_narration: string;
  outro_narration: string;
  /** Edge TTS 音色名 */
  voice: string;
  /** 语速 -50 ~ +100 */
  rate: number;
  voice_enabled: boolean;
  /** 最后一手是否绝杀(结尾卡文案) */
  ends_mate: boolean;
}

export interface VideoProgress {
  stage: "prepare" | "tts" | "render" | "compose" | "done";
  current: number;
  total: number;
  message: string;
}

export interface VideoOutcome {
  dir: string;
  video_path: string;
  cover_path: string;
  duration_secs: number;
  size_bytes: number;
  move_count: number;
}

/** 视频库条目(Rust 端 VideoMeta) */
export interface VideoMetaDto {
  id: string;
  title: string;
  subtitle: string;
  duration_secs: number;
  size_bytes: number;
  created_ms: number;
  move_count: number;
  video_path: string;
  cover_path: string;
}

/** 导出数据源(由入口构造) */
export interface VideoSource {
  title: string;
  subtitle: string;
  moves: VideoMoveStep[];
  endsMate: boolean;
}

export type VideoSourceLoader = () => Promise<VideoSource>;

/** Edge TTS 预设音色 */
export const VOICES = [
  { value: "zh-CN-YunxiNeural", label: "云希 · 沉稳男声" },
  { value: "zh-CN-XiaoxiaoNeural", label: "晓晓 · 亲和女声" },
  { value: "zh-CN-YunjianNeural", label: "云健 · 磁性男声" },
  { value: "zh-CN-XiaoyiNeural", label: "晓伊 · 清亮女声" },
] as const;
