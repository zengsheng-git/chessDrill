// 视频导出数据构建: 把棋谱主线 / 题目杀法线推演为渲染所需的走子序列
// 棋规推演在前端完成(applyMove), Rust 端只做渲染合成
import { isSameBoardFen, parseFen } from "../board/fen";
import { gameOutcome } from "../board/rules";
import { applyMove } from "../move";
import { solveLine } from "../ipc";
import type { Pos } from "../board/types";
import type { ParsedGame } from "../xqf/parser";
import type { BranchPointInfo, VideoMoveStep, VideoSource } from "./types";

function iccsFrom(iccs: string): Pos {
  return { x: iccs.charCodeAt(0) - 97, y: Number(iccs[1]) };
}

function iccsTo(iccs: string): Pos {
  return { x: iccs.charCodeAt(2) - 97, y: Number(iccs[3]) };
}

/** 把 ICCS 着法线逐手推演为走子序列, 并判定是否绝杀收尾 */
export function stepsFromLine(
  startFen: string,
  line: string[],
): { steps: VideoMoveStep[]; endsMate: boolean } {
  const { board, turn } = parseFen(startFen);
  const steps: VideoMoveStep[] = [];
  let b = board;
  let t = turn;
  for (const iccs of line) {
    const { board: nb, record } = applyMove(b, t, iccsFrom(iccs), iccsTo(iccs));
    steps.push({
      fen_before: record.fenBefore,
      fen_after: record.fenAfter,
      iccs: record.iccs,
      notation: record.notation,
      side: record.side,
      check: record.check,
    });
    b = nb;
    t = t === "red" ? "black" : "red";
  }
  // 走完后轮到的一方无合法着法且被将军 => 绝杀
  const endsMate =
    steps.length > 0 && gameOutcome(b, t) === "checkmate";
  return { steps, endsMate };
}

/** 复盘棋谱 → 主线视频数据源(逐层取第一变着; 同时收集分歧点供用户勾选变招) */
export function sourceFromGame(game: ParsedGame): VideoSource {
  const line: string[] = [];
  const mainFens: string[] = []; // 走完第 i+1 手主线后的局面 FEN
  const branchPoints: BranchPointInfo[] = [];
  let list = game.moves;
  let idx = 0;
  while (list.length > 0) {
    const node = list[0]!;
    // 多分支局面: 记录全部备选(不含主线); 变招线只取差异部分——走到与主线局面重新汇合为止
    // (棋谱变着树常在变化结束后复制一份共同后续, 那部分与主线重复, 不进视频)
    if (list.length > 1) {
      branchPoints.push({
        moveIndex: idx,
        mainline: { iccs: node.iccs, notation: node.notation },
        alternatives: list.slice(1).map((alt) => {
          const lineAlt = [{ iccs: alt.iccs, notation: alt.notation }];
          let sub = alt.children[0];
          let j = 0;
          while (sub) {
            j += 1;
            // 走完这手后若与主线对应局面相同 => 已汇合, 停止(不含此手)
            const mainFen = mainFens[idx + j - 1];
            if (mainFen && isSameBoardFen(sub.fen, mainFen)) break;
            lineAlt.push({ iccs: sub.iccs, notation: sub.notation });
            sub = sub.children[0];
          }
          return { iccs: alt.iccs, notation: alt.notation, line: lineAlt };
        }),
      });
    }
    line.push(node.iccs);
    mainFens.push(node.fen);
    idx += 1;
    list = node.children;
  }
  if (line.length === 0) {
    throw new Error("该棋谱没有着法, 无法导出视频");
  }
  const { steps, endsMate } = stepsFromLine(game.startFen, line);
  const title = game.info.title?.trim() || "象棋复盘";
  const players = [
    game.info.red ? `红：${game.info.red}` : null,
    game.info.black ? `黑：${game.info.black}` : null,
  ]
    .filter(Boolean)
    .join(" · ");
  const subtitle = players || game.info.event?.trim() || "";
  return { title, subtitle, moves: steps, endsMate, branchPoints };
}

/** 残局题目 → 参考杀法线视频数据源(联网调引擎求解) */
export async function sourceFromQuestion(opts: {
  fen: string;
  title: string;
  subtitle: string;
}): Promise<VideoSource> {
  const line = await solveLine(opts.fen);
  if (line.length === 0) {
    throw new Error("引擎未求解出杀法线, 无法导出视频");
  }
  const { steps, endsMate } = stepsFromLine(opts.fen, line);
  return { title: opts.title, subtitle: opts.subtitle, moves: steps, endsMate, branchPoints: [] };
}
