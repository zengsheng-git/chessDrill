import { type Board, idx, pieceColor, type Pos } from "./board/types";
import { boardToFen, parseFen } from "./board/fen";
import { chineseNotation, moveIccs } from "./board/notation";
import { isInCheck } from "./board/rules";

export interface MoveRecord {
  /** 走子前的局面 FEN */
  fenBefore: string;
  /** 走子后的局面 FEN */
  fenAfter: string;
  iccs: string;
  notation: string;
  captured: string | null;
  /** 走子方 */
  side: "red" | "black";
  /** 走后是否将军对方 */
  check: boolean;
}

/// 在棋盘上执行一步走子并生成记录 (含中文记法与将军检测)
export function applyMove(
  board: Board,
  turn: "red" | "black",
  from: Pos,
  to: Pos,
): { board: Board; record: MoveRecord } {
  const iFrom = idx(from.x, from.y);
  const iTo = idx(to.x, to.y);
  const piece = board[iFrom]!;
  const captured = board[iTo];

  const notation = chineseNotation(board, from, to);
  const iccs = moveIccs(from, to);

  const next = board.slice();
  next[iTo] = piece;
  next[iFrom] = null;

  const sideAfter = turn === "red" ? "black" : "red";
  const check = isInCheck(next, sideAfter);

  return {
    board: next,
    record: {
      fenBefore: boardToFen(board, turn),
      fenAfter: boardToFen(next, sideAfter),
      iccs,
      notation,
      captured,
      side: turn,
      check,
    },
  };
}

/// 解析 FEN 得到棋盘与行棋方
export function boardAfterFen(fen: string): { board: Board; turn: "red" | "black" } {
  return parseFen(fen);
}

export function sideOf(piece: string): "red" | "black" {
  return pieceColor(piece);
}
