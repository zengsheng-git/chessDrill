// 视频导出类型与常量(字段保持 snake_case 以匹配 Rust 端 serde 默认约定)

/** 棋盘标注: 圈注(单点)或箭头(起点→终点), 红=威胁/关键 绿=路线/说明 */
export interface VideoAnnotation {
  kind: "circle" | "arrow";
  /** ICCS 单点(圈注)或起点(箭头) */
  from: string;
  /** 箭头终点(圈注为空) */
  to: string | null;
  color: "red" | "green";
}

/** 变招演示的一手(变招线主线, 首手为备选本身, 其余为后续/对方应手) */
export interface VideoBranchMove {
  iccs: string;
  notation: string;
}

/** 变招演示(该手之前, 按变招线逐手真实走子后回退) */
export interface VideoBranchDemo {
  moves: VideoBranchMove[];
  /** 逐手自定义解说词(与 moves 等长, 空串 = 该手用自动模板) */
  comments?: string[];
}

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
  /** 该手棋盘标注 */
  annotations?: VideoAnnotation[];
  /** 该手之前的变招演示(用户勾选) */
  branches?: VideoBranchDemo[];
  /** 变招预览卡自定义解说词(空 = 自动模板) */
  branch_preview_comment?: string;
}

/** 变招选择配置: 勾选 + 演示手数 + 自定义解说词 */
export interface BranchConfig {
  /** 分歧点 moveIndex → 勾选的备选 iccs 列表 */
  picks: Record<number, string[]>;
  /** 分歧点 moveIndex → 演示手数(0 = 全部; 缺省 = 2) */
  lineLens: Record<number, number>;
  /** 演示卡自定义解说词, key = `${moveIndex}:${iccs}`(空 = 自动模板) */
  altComments: Record<string, string>;
  /** 预览卡自定义解说词, key = moveIndex(空 = 自动模板) */
  previewComments: Record<number, string>;
}

/** 棋谱分歧点信息(导出对话框供用户勾选变招) */
export interface BranchPointInfo {
  /** 主线手序号(分歧发生在走这手之前) */
  moveIndex: number;
  /** 主线着法 */
  mainline: { iccs: string; notation: string };
  /** 备选(不含主线), line = 该变招线主线全部着法(首手为备选本身) */
  alternatives: {
    iccs: string;
    notation: string;
    line: { iccs: string; notation: string }[];
  }[];
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
  /** 生成耗时(秒) */
  elapsed_secs: number;
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
  /** 生成耗时(秒; 旧条目为 0 不显示) */
  elapsed_secs: number;
}

/** 导出数据源(由入口构造) */
export interface VideoSource {
  title: string;
  subtitle: string;
  moves: VideoMoveStep[];
  endsMate: boolean;
  /** 棋谱分歧点(仅复盘来源; 练习来源为空) */
  branchPoints: BranchPointInfo[];
}

export type VideoSourceLoader = () => Promise<VideoSource>;

/** Edge TTS 预设音色 */
export const VOICES = [
  { value: "zh-CN-YunxiNeural", label: "云希 · 沉稳男声" },
  { value: "zh-CN-XiaoxiaoNeural", label: "晓晓 · 亲和女声" },
  { value: "zh-CN-YunjianNeural", label: "云健 · 磁性男声" },
  { value: "zh-CN-XiaoyiNeural", label: "晓伊 · 清亮女声" },
] as const;
