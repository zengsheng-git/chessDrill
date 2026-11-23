import { type Board, type Color, idx, inBoard, pieceColor, type Pos } from "./types";

function inPalace(x: number, y: number, color: "red" | "black"): boolean {
  if (x < 3 || x > 5) return false;
  return color === "red" ? y >= 0 && y <= 2 : y >= 7 && y <= 9;
}

function crossedRiver(y: number, color: "red" | "black"): boolean {
  return color === "red" ? y >= 5 : y <= 4;
}

function clearPath(board: Board, from: Pos, to: Pos): boolean {
  const dx = Math.sign(to.x - from.x);
  const dy = Math.sign(to.y - from.y);
  let x = from.x + dx;
  let y = from.y + dy;
  while (x !== to.x || y !== to.y) {
    if (board[idx(x, y)]) return false;
    x += dx;
    y += dy;
  }
  return true;
}

function screenCount(board: Board, from: Pos, to: Pos): number {
  let count = 0;
  const dx = Math.sign(to.x - from.x);
  const dy = Math.sign(to.y - from.y);
  let x = from.x + dx;
  let y = from.y + dy;
  while (x !== to.x || y !== to.y) {
    if (board[idx(x, y)]) count += 1;
    x += dx;
    y += dy;
  }
  return count;
}

export function isPseudoLegalMove(
  board: Board,
  from: Pos,
  to: Pos,
): boolean {
  if (!inBoard(from.x, from.y) || !inBoard(to.x, to.y)) return false;
  const piece = board[idx(from.x, from.y)];
  if (!piece) return false;
  const target = board[idx(to.x, to.y)];
  if (target && pieceColor(target) === pieceColor(piece)) return false;
  if (from.x === to.x && from.y === to.y) return false;

  const color = pieceColor(piece);
  const kind = piece.toUpperCase();
  const dxF = to.x - from.x;
  const dyF = to.y - from.y;
  const adx = Math.abs(dxF);
  const ady = Math.abs(dyF);

  switch (kind) {
    case "R":
      return dxF === 0 || dyF === 0 ? clearPath(board, from, to) : false;
    case "C": {
      if (dxF !== 0 && dyF !== 0) return false;
      const screens = screenCount(board, from, to);
      return target ? screens === 1 : screens === 0;
    }
    case "N":
      if (!((adx === 1 && ady === 2) || (adx === 2 && ady === 1))) return false;
      return !board[idx(from.x + Math.sign(dxF) * (adx > ady ? 1 : 0), from.y + Math.sign(dyF) * (ady > adx ? 1 : 0))];
    case "B": {
      if (adx !== 2 || ady !== 2) return false;
      if (crossedRiver(to.y, color) !== crossedRiver(from.y, color)) return false;
      return !board[idx(from.x + dxF / 2, from.y + dyF / 2)];
    }
    case "A":
      return adx === 1 && ady === 1 && inPalace(to.x, to.y, color);
    case "K":
      return adx + ady === 1 && inPalace(to.x, to.y, color);
    case "P": {
      if (adx + ady !== 1) return false;
      const forward = color === "red" ? 1 : -1;
      if (dyF === forward && adx === 0) return true;
      return adx === 1 && dyF === 0 && crossedRiver(from.y, color);
    }
    default:
      return false;
  }
}

// ---------------------------------------------------------------------------
// 以下为将军检测 / 合法走法过滤 / 终局判定 (杀法练习核心)
// ---------------------------------------------------------------------------

export function findKing(board: Board, color: Color): Pos | null {
  const target = color === "red" ? "K" : "k";
  for (let i = 0; i < board.length; i++) {
    if (board[i] === target) {
      return { x: i % 9, y: Math.floor(i / 9) };
    }
  }
  return null;
}

/// 两王同线且中间无子(白脸将), 双方均视为被攻击状态
export function kingsFacing(board: Board): boolean {
  const red = findKing(board, "red");
  const black = findKing(board, "black");
  if (!red || !black || red.x !== black.x) return false;
  // 红在下(y 小)黑在上(y 大), 从红方向上扫到黑方, 中间须无子
  for (let y = red.y + 1; y < black.y; y++) {
    if (board[idx(red.x, y)]) return false;
  }
  return true;
}

/// color 方是否正被将军(含白脸将)
export function isInCheck(board: Board, color: Color): boolean {
  const king = findKing(board, color);
  if (!king) return true;
  if (kingsFacing(board)) return true;
  const enemy: Color = color === "red" ? "black" : "red";
  for (let i = 0; i < board.length; i++) {
    const p = board[i];
    if (!p || pieceColor(p) !== enemy) continue;
    const from = { x: i % 9, y: Math.floor(i / 9) };
    if (isPseudoLegalMove(board, from, king)) return true;
  }
  return false;
}

/// 模拟走子, 检查走后己方是否仍被将军(含白脸将); 非法则不可走
function survivesSelfCheck(board: Board, from: Pos, to: Pos, color: Color): boolean {
  const saved = board[idx(to.x, to.y)];
  board[idx(to.x, to.y)] = board[idx(from.x, from.y)];
  board[idx(from.x, from.y)] = null;
  const bad = isInCheck(board, color);
  board[idx(from.x, from.y)] = board[idx(to.x, to.y)];
  board[idx(to.x, to.y)] = saved;
  return !bad;
}

/// 某格棋子的全部合法走法
export function legalMovesFrom(board: Board, from: Pos): Pos[] {
  const piece = board[idx(from.x, from.y)];
  if (!piece) return [];
  const color = pieceColor(piece);
  const out: Pos[] = [];
  for (let x = 0; x < 9; x++) {
    for (let y = 0; y < 10; y++) {
      if (x === from.x && y === from.y) continue;
      const to = { x, y };
      if (!isPseudoLegalMove(board, from, to)) continue;
      if (!survivesSelfCheck(board, from, to, color)) continue;
      out.push(to);
    }
  }
  return out;
}

export interface FullMove {
  from: Pos;
  to: Pos;
}

/// color 方的全部合法走法
export function allLegalMoves(board: Board, color: Color): FullMove[] {
  const out: FullMove[] = [];
  for (let i = 0; i < board.length; i++) {
    const p = board[i];
    if (!p || pieceColor(p) !== color) continue;
    const from = { x: i % 9, y: Math.floor(i / 9) };
    for (const to of legalMovesFrom(board, from)) {
      out.push({ from, to });
    }
  }
  return out;
}

export type GameOutcome = "playing" | "checkmate" | "stalemate";

/// turn 方行棋时的局面状态: 继续对弈 / 被将杀 / 被困毙(中规困毙亦判负)
export function gameOutcome(board: Board, turn: Color): GameOutcome {
  if (allLegalMoves(board, turn).length > 0) return "playing";
  return isInCheck(board, turn) ? "checkmate" : "stalemate";
}
