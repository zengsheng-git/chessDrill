import { describe, expect, it } from "vitest";
import { START_FEN, parseFen } from "../board/fen";
import { idx } from "../board/types";
import type { MoveNode } from "../xqf/parser";
import { applyIccsRaw, buildGame, buildRecordedGame, iccsToPos } from "./toGame";

// 红黑交替的 8 步合法序列，第 5 步红兵吃黑卒
const MOVES = [
  { from: "h2", to: "e2" }, // 炮二平五
  { from: "h9", to: "g7" }, // 马8进7
  { from: "a3", to: "a4" }, // 兵九进一
  { from: "a6", to: "a5" }, // 卒1进1
  { from: "a4", to: "a5" }, // 兵九进一（吃卒）
  { from: "b7", to: "e7" }, // 炮2平5
  { from: "a0", to: "a1" }, // 车九进一
  { from: "i6", to: "i5" }, // 卒9进1
];

// 沿 children[0] 遍历主线（与 toPgn/goToEnd 的树形导航一致）
function mainLine(game: { moves: MoveNode[] }): MoveNode[] {
  const out: MoveNode[] = [];
  let cur = game.moves[0];
  while (cur) {
    out.push(cur);
    cur = cur.children[0] ?? null;
  }
  return out;
}

describe("iccsToPos", () => {
  it("解析 ICCS 坐标为棋盘坐标", () => {
    expect(iccsToPos("h2")).toEqual({ x: 7, y: 2 });
    expect(iccsToPos("a0")).toEqual({ x: 0, y: 0 });
  });

  it("拒绝合法范围外的坐标", () => {
    expect(() => iccsToPos("j9")).toThrowError(/无效坐标/);
  });
});

describe("buildGame", () => {
  it("构建与 XQF 解析同构的单线主线树", () => {
    const game = buildGame(START_FEN, MOVES);
    expect(game.startFen).toBe(START_FEN);
    expect(game.startTurn).toBe("red");
    expect(game.moveCount).toBe(MOVES.length);
    expect(game.branchCount).toBe(0);
    expect(game.moves).toHaveLength(1);
    const line = mainLine(game);
    expect(line).toHaveLength(MOVES.length);
    expect(line[0].ply).toBe(1);
    expect(line[0].path).toEqual([0]);
    expect(line[1].path).toEqual([0, 0]);
    expect(line[0].iccs).toBe("h2e2");
    expect(line[0].from).toEqual({ x: 7, y: 2 });
    expect(line[0].notation).toBe("炮二平五");
    expect(line[4].notation).toBe("兵九进一");
    expect(game.info.red).toBe("红方");
    expect(game.info.black).toBe("黑方");
  });

  it("每步 fen 为走子后局面且行棋方交替", () => {
    const line = mainLine(buildGame(START_FEN, MOVES));
    expect(line[0].fen).toBe(
      "rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C2C4/9/RNBAKABNR b - - 0 1",
    );
    expect(line[4].fen).toBe(
      "rnbakab1r/9/1c4nc1/2p1p1p1p/P8/9/2P1P1P1P/1C2C4/9/RNBAKABNR b - - 0 1",
    );
    expect(line[1].fen.endsWith(" w - - 0 1")).toBe(true);
  });

  it("非法着法抛出带手数的中文错误", () => {
    expect(() => buildGame(START_FEN, [{ from: "e3", to: "f3" }])).toThrowError(
      /第 1 手/,
    );
    expect(() =>
      buildGame(START_FEN, [
        { from: "h2", to: "e2" },
        { from: "e2", to: "e3" },
      ]),
    ).toThrowError(/第 2 手/);
  });
});

describe("applyIccsRaw", () => {
  it("不做规则校验，机械搬运棋子并记谱", () => {
    const board = parseFen(START_FEN).board;
    // 初始局面车九平五不合法（路上有子），raw 版应照样应用
    const applied = applyIccsRaw(board, "a0", "e0", "R");
    expect(applied.notation).toBe("车九平五");
    expect(applied.captured).toBe("K");
    expect(board[idx(0, 0)]).toBeNull();
    expect(board[idx(4, 0)]).toBe("R");
  });

  it("from 格为空时以观测棋子补位记谱", () => {
    const board = parseFen(START_FEN).board;
    board[idx(7, 2)] = null; // 模拟盘面与观测脱节
    const applied = applyIccsRaw(board, "h2", "e2", "C");
    expect(applied.notation).toBe("炮二平五");
    expect(board[idx(7, 2)]).toBeNull();
    expect(board[idx(4, 2)]).toBe("C");
  });
});

describe("buildRecordedGame", () => {
  it("直接采用录制快照，不重放校验（悔棋跳变后线性重放不成立）", () => {
    const afterH2E2 =
      "rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C2C4/9/RNBAKABNR b - - 0 1";
    const game = buildRecordedGame(START_FEN, [
      { from: "h2", to: "e2", notation: "炮二平五", fen: afterH2E2 },
      // 第 2 手是悔棋回到起点的快照：重放式构建会因棋子位置不符而出错
      { from: "e2", to: "h2", notation: "炮五平二", fen: START_FEN },
    ]);
    const line = mainLine(game);
    expect(game.moveCount).toBe(2);
    expect(line[0].ply).toBe(1);
    expect(line[0].notation).toBe("炮二平五");
    expect(line[1].ply).toBe(2);
    expect(line[1].fen).toBe(START_FEN);
  });
});
