/// 题库行解析 — 兼容「一二残局」题库格式:
/// 1. `FEN`                 执红
/// 2. `2#FEN`               执黑
/// 3. `FEN 中文标题`         执红带标题
/// 4. `2#FEN 中文标题`       执黑带标题
/// 另支持空行与 `#` / `//` 注释行

export interface Question {
  /** 局面 FEN (含行棋方) */
  fen: string;
  /** 题目名; 无标题时由界面显示序号 */
  title: string;
  /** 执黑题(2# 前缀): 玩家执黑, 引擎执红 */
  flipped: boolean;
}

const CJK_RE = /[\u4e00-\u9fff]/;

export function parseFenLine(raw: string): Question | null {
  let line = raw.trim();
  if (!line || line.startsWith("#") || line.startsWith("//")) return null;

  let flipped = false;
  if (line.startsWith("2#")) {
    flipped = true;
    line = line.slice(2).trim();
  }
  if (!line) return null;

  const tokens = line.split(/\s+/);
  // 至少需要 棋盘段 + 行棋方 两段
  if (tokens.length < 2) return null;
  const boardPart = tokens[0]!;
  const turnPart = tokens[1]!;
  if (!boardPart.includes("/") || (turnPart !== "w" && turnPart !== "b")) {
    return null;
  }

  // 第一个含汉字的 token 起为标题 (跳过 FEN 六字段)
  let titleStart = tokens.length;
  for (let i = 2; i < tokens.length; i++) {
    if (CJK_RE.test(tokens[i]!)) {
      titleStart = i;
      break;
    }
  }
  const title =
    titleStart < tokens.length
      ? tokens.slice(titleStart).join(" ").trim()
      : "";

  return {
    fen: tokens.slice(0, titleStart < tokens.length ? titleStart : tokens.length).join(" "),
    title,
    flipped,
  };
}

export function parseTikuText(text: string): { questions: Question[]; invalid: number } {
  const questions: Question[] = [];
  let invalid = 0;
  for (const line of text.split(/\r?\n/)) {
    const q = parseFenLine(line);
    if (q) questions.push(q);
    else if (line.trim() && !line.trim().startsWith("#") && !line.trim().startsWith("//")) {
      invalid += 1;
    }
  }
  return { questions, invalid };
}
