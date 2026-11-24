import { invoke } from "@tauri-apps/api/core";

/// 注意: 传给 Rust 的对象字段保持 snake_case, 以匹配 serde 默认约定

export interface TikuMeta {
  /** 题库显示名(去扩展名) */
  name: string;
  /** 题目数 */
  count: number;
}

export interface QuestionDto {
  fen: string;
  title: string;
  flipped: boolean;
}

export interface SearchResultDto {
  /** 引擎首选着法(ICCS); null = 行棋方无合法着法(已被绝杀/困毙) */
  bestmove: string | null;
  /** 最优线完整着法序列(ICCS) */
  pv: string[];
  /** 行棋方视角评分(厘兵; 将杀约 ±30000) */
  score_cp: number;
  /** 行棋方几步内将杀(正)或被将杀(负); null = 非杀局面 */
  mate_in: number | null;
}

export async function listTiku(): Promise<TikuMeta[]> {
  return invoke<TikuMeta[]>("list_tiku");
}

export async function readTiku(name: string): Promise<QuestionDto[]> {
  return invoke<QuestionDto[]>("read_tiku", { name });
}

/// 引擎单步应手/搜索指定局面
export async function engineMove(fen: string): Promise<SearchResultDto> {
  return invoke<SearchResultDto>("engine_move", { fen });
}

/// 引擎求解参考杀法线: 双方都按引擎最强应对推演, 直到终局或步数上限
export async function solveLine(fen: string): Promise<string[]> {
  return invoke<string[]>("solve_line", { fen });
}

// ------------------------------------------------------------------
// 复盘模块: 棋谱库 / 文件管理 / 软件检测
// ------------------------------------------------------------------

export interface FileEntry {
  name: string;
  path: string;
  ext: string;
  size: number;
}

export function isTauriEnv(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

export function scanDir(root: string): Promise<FileEntry[]> {
  return invoke<FileEntry[]>("scan_dir", { root });
}

export async function readFileBytes(path: string): Promise<Uint8Array> {
  const arr = await invoke<number[]>("read_file_bytes", { path });
  return new Uint8Array(arr);
}

export function revealInExplorer(path: string): Promise<void> {
  return invoke("reveal_in_explorer", { path });
}

export function deleteGameFile(path: string): Promise<void> {
  return invoke("delete_game_file", { path });
}

export function deleteGameDir(path: string): Promise<void> {
  return invoke("delete_game_dir", { path });
}

/** 重命名棋谱文件（后端保留原扩展名），返回新完整路径 */
export function renameGameFile(path: string, newName: string): Promise<string> {
  return invoke<string>("rename_game_file", { path, newName });
}

/** 重命名棋谱文件夹，返回新完整路径 */
export function renameGameDir(path: string, newName: string): Promise<string> {
  return invoke<string>("rename_game_dir", { path, newName });
}

export function scanDirs(root: string): Promise<string[]> {
  return invoke<string[]>("scan_dirs", { root });
}

export function createFolder(parentPath: string, folderName: string): Promise<string> {
  return invoke<string>("create_folder", { parentPath, folderName });
}

// ---- 软件棋检测 ----

/** 单手分析输入（与后端 AnalyzePly 约定一致；字段名须保持 snake_case，serde 按原样匹配） */
export interface AnalyzePlyInput {
  /** 行棋方: red | black */
  side: "red" | "black";
  iccs: string;
  fen: string;
  next_fen: string;
}

export function analyzeGame(plies: AnalyzePlyInput[]): Promise<void> {
  return invoke("analyze_game", { plies });
}

export function stopAnalysis(): Promise<void> {
  return invoke("stop_analysis");
}
