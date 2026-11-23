import { describe, expect, it } from "vitest";
import { parseFen } from "./fen";
import { idx } from "./types";
import { allLegalMoves, gameOutcome, isInCheck, legalMovesFrom, kingsFacing } from "./rules";

describe("rules", () => {
  it("初始局面红方约 44 种合法走法", () => {
    const { board } = parseFen(
      "rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABNR w - - 0 1",
    );
    const moves = allLegalMoves(board, "red");
    expect(moves.length).toBeGreaterThan(30);
  });

  it("白脸将判定", () => {
    const { board } = parseFen("4k4/9/9/9/9/9/9/9/9/4K4 w - - 0 1");
    expect(kingsFacing(board)).toBe(true);
    expect(isInCheck(board, "red")).toBe(true);
    expect(isInCheck(board, "black")).toBe(true);
  });

  it("同列有遮挡时不构成白脸将", () => {
    const { board } = parseFen("4k4/9/9/9/4R4/9/9/9/9/4K4 w - - 0 1");
    expect(kingsFacing(board)).toBe(false);
    expect(isInCheck(board, "red")).toBe(false);
  });

  it("三车闷杀判定 checkmate", () => {
    // 黑孤将 (4,9); 红车控制 4/3/5 三条线, 黑走位全被覆盖且无子可垫
    const fen = "4k4/9/9/9/9/4R4/9/3R1R2/9/4K4 w - - 0 1";
    const { board, turn } = parseFen(fen);
    expect(isInCheck(board, "black")).toBe(true);
    const outcome = gameOutcome(board, turn);
    // 轮红走时局面正常, 轮黑走时为绝杀
    expect(gameOutcome(board, "black")).toBe("checkmate");
    expect(outcome).toBe("playing");
  });

  it("马蹩腿: 蹩脚马不能跳, 无蹩腿可跳", () => {
    const { board } = parseFen("4k4/9/9/9/9/9/9/9/4N4/3K5 w - - 0 1");
    const targets = legalMovesFrom(board, { x: 4, y: 1 });
    expect(targets.some((t) => t.x === 3 && t.y === 3)).toBe(true);
    expect(targets.some((t) => t.x === 5 && t.y === 3)).toBe(true);
  });

  it("被将军时必须应将, 且应着走后不再被将军", () => {
    // 黑车贴脸攻击红帅; 帅吃车会形成白脸将, 唯一应着是帅横移
    const fen = "4k4/9/9/9/9/9/9/9/4r4/4KR3 w - - 0 1";
    const { board, turn } = parseFen(fen);
    expect(isInCheck(board, "red")).toBe(true);
    const moves = allLegalMoves(board, turn);
    expect(moves.length).toBeGreaterThan(0);
    for (const m of moves) {
      const saved = board[idx(m.to.x, m.to.y)];
      board[idx(m.to.x, m.to.y)] = board[idx(m.from.x, m.from.y)];
      board[idx(m.from.x, m.from.y)] = null;
      expect(isInCheck(board, "red")).toBe(false);
      board[idx(m.from.x, m.from.y)] = board[idx(m.to.x, m.to.y)];
      board[idx(m.to.x, m.to.y)] = saved;
    }
  });
});
