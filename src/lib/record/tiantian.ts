import { START_FEN } from "../board/fen";
import type { ParsedGame } from "../xqf/parser";
import { buildGame } from "./toGame";

/** 后端 fetch_tiantian_qipu 的返回 */
export interface TiantianQipu {
  title: string;
  movelist: string;
}

export interface TiantianGame {
  game: ParsedGame;
  red: string;
  black: string;
}

/** 十六进制坐标（列, 行）→ ICCS：列 0-8 = a-i，行 0 为黑方底线 */
function coordToIccs(x: number, y: number): string {
  if (!(x >= 0 && x <= 8 && y >= 0 && y <= 9)) {
    throw new Error(`着法坐标越界（${x},${y}）`);
  }
  return String.fromCharCode(97 + x) + String(9 - y);
}

/** movelist：每步 4 个十六进制位 = 起列 起行 到列 到行 */
export function movelistToIccs(movelist: string): { from: string; to: string }[] {
  if (movelist.length === 0 || movelist.length % 4 !== 0 || /[^0-9a-f]/i.test(movelist)) {
    throw new Error("着法串格式不正确");
  }
  const moves: { from: string; to: string }[] = [];
  for (let i = 0; i < movelist.length; i += 4) {
    moves.push({
      from: coordToIccs(Number.parseInt(movelist[i]!, 16), Number.parseInt(movelist[i + 1]!, 16)),
      to: coordToIccs(Number.parseInt(movelist[i + 2]!, 16), Number.parseInt(movelist[i + 3]!, 16)),
    });
  }
  return moves;
}

/** "红方[业8-1] 先负 黑方[业8-2]" → 双方名 + GameInfo.result 中文结果词 */
export function parseTiantianTitle(title: string): { red: string; black: string; result: string } {
  const m = /^(.+?)\s*(先胜|先负|先和|和棋)\s*(.+)$/.exec(title.trim());
  if (!m) return { red: title.trim(), black: "黑方", result: "未知" };
  const result = m[2] === "先胜" ? "红胜" : m[2] === "先负" ? "黑胜" : "和棋";
  return { red: m[1]!.trim(), black: m[3]!.trim(), result };
}

/** 拉谱结果构建对局；非标准开局（如残局分享）会被着法校验拦下并抛出中文错误 */
export function buildTiantianGame(qipu: TiantianQipu): TiantianGame {
  const { red, black, result } = parseTiantianTitle(qipu.title);
  const game = buildGame(START_FEN, movelistToIccs(qipu.movelist));
  game.info.title = qipu.title.trim();
  game.info.event = "天天象棋";
  game.info.red = red || "红方";
  game.info.black = black || "黑方";
  game.info.result = result;
  return { game, red, black };
}
