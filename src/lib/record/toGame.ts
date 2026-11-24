import { boardToFen, parseFen } from "../board/fen";
import { isPseudoLegalMove } from "../board/rules";
import { chineseNotation } from "../board/notation";
import {
  idx,
  pieceColor,
  type Board,
  type Color,
  type Piece,
  type Pos,
} from "../board/types";
import type { GameInfo, MoveNode, ParsedGame } from "../xqf/parser";

/** ICCS 坐标（如 "h2"）转棋盘坐标：文件 a-i→x 0-8，行 0-9→y 0-9 */
export function iccsToPos(iccs: string): Pos {
  if (!/^[a-i][0-9]$/.test(iccs)) {
    throw new Error(`无效坐标「${iccs}」`);
  }
  return { x: iccs.charCodeAt(0) - 97, y: iccs.charCodeAt(1) - 48 };
}

export interface AppliedMove {
  notation: string;
  captured: Piece | null;
  /** 走子后的局面 */
  fen: string;
  turnAfter: Color;
}

/** 机械应用一步 ICCS 着法（就地修改 board，不做规则校验）：录制的唯一事实
 *  来源是识别结果，异常观测也照实入谱；from 格为空说明盘面已与观测脱节，
 *  先落上观测棋子保证记谱上下文一致，由调用方按权威 FEN 对齐 */
export function applyIccsRaw(
  board: Board,
  fromIccs: string,
  toIccs: string,
  pieceChar: Piece,
): AppliedMove {
  const from = iccsToPos(fromIccs);
  const to = iccsToPos(toIccs);
  if (!board[idx(from.x, from.y)]) board[idx(from.x, from.y)] = pieceChar;
  const piece = board[idx(from.x, from.y)]!;
  const notation = chineseNotation(board, from, to);
  const captured = board[idx(to.x, to.y)];
  board[idx(to.x, to.y)] = piece;
  board[idx(from.x, from.y)] = null;
  const turnAfter: Color = pieceColor(piece) === "red" ? "black" : "red";
  return { notation, captured, fen: boardToFen(board, turnAfter), turnAfter };
}

/** 在盘面上校验并应用一步 ICCS 着法（就地修改 board），供 PGN 解析等
 *  以文件为源的场景使用；非法着法抛出带手数的错误 */
export function applyIccs(
  board: Board,
  fromIccs: string,
  toIccs: string,
  ply: number,
): AppliedMove {
  const from = iccsToPos(fromIccs);
  const to = iccsToPos(toIccs);
  const piece = board[idx(from.x, from.y)];
  if (!piece || !isPseudoLegalMove(board, from, to)) {
    throw new Error(`第 ${ply} 手着法非法（${fromIccs}${toIccs}）`);
  }
  return applyIccsRaw(board, fromIccs, toIccs, piece);
}

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

function formatDate(d: Date): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

function formatDateTime(d: Date): string {
  return `${formatDate(d)} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

/** 单线主线的公共装配：链成 children[0] 树并补齐对局信息 */
function assembleGame(startFen: string, startTurn: Color, nodes: MoveNode[]): ParsedGame {
  // 单线主线：根层仅首手，后续沿 children[0] 链接（与 XQF 解析结构同构）
  for (let i = 0; i < nodes.length - 1; i++) {
    nodes[i]!.children = [nodes[i + 1]!];
  }

  const now = new Date();
  const info: GameInfo = {
    title: `录制对局 ${formatDateTime(now)}`,
    event: null,
    date: formatDate(now),
    site: null,
    red: "红方",
    black: "黑方",
    result: "未知",
    type: "其它",
    version: 0,
    comment: null,
  };

  return {
    info,
    startFen,
    startTurn,
    moves: nodes.length > 0 ? [nodes[0]!] : [],
    moveCount: nodes.length,
    branchCount: 0,
  };
}

/** 将 ICCS 着法流重放构建为与 XQF 解析同构的对局数据（单线主线），非法着法抛错 */
export function buildGame(
  startFen: string,
  moves: { from: string; to: string }[],
): ParsedGame {
  const { board, turn } = parseFen(startFen);
  const work = board.slice();

  const nodes: MoveNode[] = moves.map((m, i) => {
    const ply = i + 1;
    const applied = applyIccs(work, m.from, m.to, ply);
    return {
      id: i,
      path: new Array<number>(i + 1).fill(0),
      from: iccsToPos(m.from),
      to: iccsToPos(m.to),
      iccs: m.from + m.to,
      notation: applied.notation,
      comment: null,
      fen: applied.fen,
      ply,
      children: [],
    };
  });
  return assembleGame(startFen, turn, nodes);
}

/** 录制着法快照 */
export interface RecordedSnapshot {
  from: string;
  to: string;
  notation: string;
  /** 该手走完后的权威盘面 */
  fen: string;
}

/** 将录制快照流构建为对局数据：不重放、不校验，记谱与盘面均采用录制当时
 *  的快照——悔棋/重开等跳变发生后从起点线性重放不再成立，快照才是事实 */
export function buildRecordedGame(startFen: string, moves: RecordedSnapshot[]): ParsedGame {
  const { turn } = parseFen(startFen);
  const nodes: MoveNode[] = moves.map((m, i) => ({
    id: i,
    path: new Array<number>(i + 1).fill(0),
    from: iccsToPos(m.from),
    to: iccsToPos(m.to),
    iccs: m.from + m.to,
    notation: m.notation,
    comment: null,
    fen: m.fen,
    ply: i + 1,
    children: [],
  }));
  return assembleGame(startFen, turn, nodes);
}
