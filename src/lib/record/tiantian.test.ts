import { describe, expect, it } from "vitest";
import { START_FEN } from "../board/fen";
import type { MoveNode } from "../xqf/parser";
import { buildTiantianGame, movelistToIccs, parseTiantianTitle } from "./tiantian";

// 真实分享链接拉回的完整对局着法串（98 着，经合法着法校验）
const REAL_MOVELIST =
  "77477242796770628979808139488131173723241907102209191202060563647975001019102210666564657565304186853134071534333717102265622425262522346264341564244130242002052907030420243335474350412414353367553335557415271464405017105051101135316461515261674246483731116762525162615152616252517455055562655552656151506160505160661119494819184849273543451819494819592524524224345958484935473748476648576645";

function mainLine(game: { moves: MoveNode[] }): MoveNode[] {
  const out: MoveNode[] = [];
  let cur = game.moves[0];
  while (cur) {
    out.push(cur);
    cur = cur.children[0] ?? null;
  }
  return out;
}

describe("movelistToIccs", () => {
  it("十六进制坐标转 ICCS（列 a-i，行 0 为黑方底线）", () => {
    expect(movelistToIccs("7747")).toEqual([{ from: "h2", to: "e2" }]); // 炮二平五
    expect(movelistToIccs("8979")).toEqual([{ from: "i0", to: "h0" }]); // 车一平二
    expect(movelistToIccs("8081")).toEqual([{ from: "i9", to: "i8" }]); // 车9进1
  });

  it("拒绝非法着法串", () => {
    expect(() => movelistToIccs("77")).toThrowError(/格式不正确/);
    expect(() => movelistToIccs("77zz")).toThrowError(/格式不正确/);
    expect(() => movelistToIccs("9999")).toThrowError(/越界/);
  });
});

describe("parseTiantianTitle", () => {
  it("解析双方与结果", () => {
    const t = parseTiantianTitle("小伍[业8-1] 先负 demacer[业8-2]");
    expect(t.red).toBe("小伍[业8-1]");
    expect(t.black).toBe("demacer[业8-2]");
    expect(t.result).toBe("黑胜");
  });

  it("先和映射为和棋", () => {
    expect(parseTiantianTitle("甲 先和 乙").result).toBe("和棋");
  });

  it("无结果词时退化为整名", () => {
    const t = parseTiantianTitle("某局棋");
    expect(t.result).toBe("未知");
  });
});

describe("buildTiantianGame", () => {
  it("真实对局完整构建且逐着合法", () => {
    const { game } = buildTiantianGame({
      title: "甲[业8-1] 先胜 乙[业8-2]",
      movelist: REAL_MOVELIST,
    });
    expect(game.startFen).toBe(START_FEN);
    expect(game.moveCount).toBe(98);
    const line = mainLine(game);
    expect(line[0]!.iccs).toBe("h2e2");
    expect(line[0]!.notation).toBe("炮二平五");
    expect(game.info.red).toBe("甲[业8-1]");
    expect(game.info.black).toBe("乙[业8-2]");
    expect(game.info.result).toBe("红胜");
    expect(game.info.event).toBe("天天象棋");
  });

  it("非标准开局的着法串被着法校验拦下", () => {
    // 从标准起点走一个起点上无子的着法
    expect(() => buildTiantianGame({ title: "残局", movelist: "0806" })).toThrowError(/非法/);
  });
});
