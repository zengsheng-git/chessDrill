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
