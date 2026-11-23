import { describe, expect, it } from "vitest";
import { parseFenLine, parseTikuText } from "./tiku";

describe("tiku parseFenLine", () => {
  it("执红带标题(适情雅趣格式)", () => {
    const q = parseFenLine(
      "2baka3/3P3N1/bN7/7nc/9/4C1P2/P5n1P/B3R3B/4Apr2/2RAK3c w - - 0 1 气吞关右",
    );
    expect(q).not.toBeNull();
    expect(q!.flipped).toBe(false);
    expect(q!.title).toBe("气吞关右");
    expect(q!.fen).toBe(
      "2baka3/3P3N1/bN7/7nc/9/4C1P2/P5n1P/B3R3B/4Apr2/2RAK3c w - - 0 1",
    );
  });

  it("执黑 2# 前缀", () => {
    const q = parseFenLine("2#4k4/9/9/9/9/9/9/9/4R4/4K4 w - - 0 1");
    expect(q!.flipped).toBe(true);
    expect(q!.title).toBe("");
    expect(q!.fen).toBe("4k4/9/9/9/9/9/9/9/4R4/4K4 w - - 0 1");
  });

  it("无标题纯 FEN", () => {
    const q = parseFenLine("4k4/9/9/9/9/9/9/9/4R4/4K4 w - - 0 1");
    expect(q!.title).toBe("");
    expect(q!.flipped).toBe(false);
  });

  it("注释与空行返回 null", () => {
    expect(parseFenLine("")).toBeNull();
    expect(parseFenLine("  ")).toBeNull();
    expect(parseFenLine("# 注释")).toBeNull();
    expect(parseFenLine("// 注释")).toBeNull();
  });

  it("无效行返回 null", () => {
    expect(parseFenLine("hello world")).toBeNull();
    expect(parseFenLine("2#")).toBeNull();
  });

  it("parseTikuText 统计", () => {
    const text = [
      "# header",
      "",
      "4k4/9/9/9/9/9/9/9/4R4/4K4 w - - 0 1",
      "2#3ak4/4a1P2/9/9/9/9/9/9/9/4K4 w - - 0 1 某题名",
      "garbage line here",
    ].join("\n");
    const { questions, invalid } = parseTikuText(text);
    expect(questions.length).toBe(2);
    expect(invalid).toBe(1);
  });
});
