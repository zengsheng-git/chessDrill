import { create } from "zustand";
import { type Board, type Color, type Pos, idx } from "../lib/board/types";
import { legalMovesFrom, gameOutcome } from "../lib/board/rules";
import { parseFen } from "../lib/board/fen";
import { applyMove, type MoveRecord } from "../lib/move";
import { engineMove, solveLine } from "../lib/ipc";
import type { Question } from "../lib/tiku";
import { useProgress } from "./progressStore";
import { useSettings } from "./settingsStore";
import { sfx } from "../lib/audio";

/// 回合计数上限(半回合): 执红题未在限内将杀判负; 执黑守和题撑满判过关
const HALFMOVE_LIMIT = 120;

export type QuizMode = "practice" | "test" | "wrong";

export type Phase = "idle" | "playing" | "won" | "lost" | "revealing";

export interface RevealFrame {
  fen: string;
  from: Pos | null;
  to: Pos | null;
  notation: string;
}

interface QuizState {
  mode: QuizMode;
  tikuName: string;
  questionIndex: number;
  question: Question | null;

  board: Board;
  turn: Color;
  playerSide: Color;
  records: MoveRecord[];
  halfmoves: number;

  selected: Pos | null;
  targets: Pos[];
  lastMove: { from: Pos; to: Pos } | null;

  /** 提示: 对应局面 fen / 引擎建议着法(ICCS)缓存 / 建议走法(箭头) */
  hintForFen: string | null;
  hintBest: string | null;
  hintMove: { from: Pos; to: Pos } | null;
  hintLoading: boolean;

  engineThinking: boolean;
  phase: Phase;
  /** 结算原因: mate=将杀 / limit=回合撑满 */
  finishReason: "mate" | "limit" | null;
  /** 结算浮层是否已被用户关闭(关闭后可查看棋盘终局) */
  overlayDismissed: boolean;

  revealFrames: RevealFrame[];
  revealIndex: number;
  revealLoading: boolean;
  /** 演示前的结算态, 演示结束恢复 */
  revealPrevPhase: Phase | null;

  loadQuestion: (mode: QuizMode, tikuName: string, index: number, q: Question) => void;
  /** 退出当前题(回 idle 空态) */
  closeQuestion: () => void;
  clickSquare: (pos: Pos) => void;
  undoMove: () => void;
  retry: () => void;
  revealAnswer: () => Promise<void>;
  advanceReveal: () => void;
  /** 关闭结算浮层(可查看终局局面) */
  dismissOverlay: () => void;
  /** 阶梯提示: 第一次标棋子, 第二次给完整走法; 局面变化后提示失效 */
  giveHint: () => Promise<void>;
}

/** 竞态令牌: 题目切换/悔棋后自增, 进行中的引擎回调以旧 id 直接作废 */
let queryId = 0;

function iccsFrom(iccs: string): Pos {
  return { x: iccs.charCodeAt(0) - 97, y: Number(iccs[1]) };
}

function iccsTo(iccs: string): Pos {
  return { x: iccs.charCodeAt(2) - 97, y: Number(iccs[3]) };
}

export const useQuiz = create<QuizState>()((set, get) => {
  const token = () => ++queryId;
  const valid = (id: number) => id === queryId;

  /** 结算: 写进度(测试模式除外) + 音效 */
  const finish = (id: number, result: "win" | "lose", reason: "mate" | "limit") => {
    if (!valid(id)) return;
    const s = get();
    set({
      engineThinking: false,
      phase: result === "win" ? "won" : "lost",
      finishReason: reason,
      selected: null,
      targets: [],
      overlayDismissed: false,
    });
    if (useSettings.getState().sound) {
      if (result === "win") sfx.win();
      else sfx.lose();
    }
    useProgress.getState().recordResult(s.tikuName, s.questionIndex, result);
  };

  /** 引擎应手(异步) */
  const engineReply = async (id: number) => {
    const s = get();
    const fen = s.records[s.records.length - 1]?.fenAfter ?? s.question?.fen ?? "";
    try {
      const reply = await engineMove(fen);
      if (!valid(id) || get().phase !== "playing") return;
      if (!reply.bestmove) {
        // 引擎无合法着法: 已被玩家将杀/困毙(兜底, 常规在前端判定)
        finish(id, "win", "mate");
        return;
      }
      const { board: b, turn: t } = parseFen(fen);
      const from = iccsFrom(reply.bestmove);
      const to = iccsTo(reply.bestmove);
      const { record } = applyMove(b, t, from, to);
      afterMove(record, id);
    } catch (e) {
      console.error("引擎应手失败", e);
      if (valid(id)) {
        // 引擎异常不直接判负, 给出可重做的提示
        set({
          engineThinking: false,
          phase: "lost",
          finishReason: null,
          revealPrevPhase: null,
          revealFrames: [],
          revealIndex: 0,
          revealLoading: false,
        });
        alert("引擎应手异常，请点「重做」重试本题");
      }
    }
  };

  /** 每一手走子后的统一推进: 判定终局 / 回合上限 / 交给引擎 */
  const afterMove = (record: MoveRecord, id: number) => {
    const s = get();
    if (!valid(id) || s.phase !== "playing") return;

    const { board } = parseFen(record.fenAfter);
    const mover = record.side;
    const opponent: Color = mover === "red" ? "black" : "red";
    const outcome = gameOutcome(board, opponent);

    // 音效
    if (useSettings.getState().sound) {
      if (outcome === "playing") {
        if (record.captured) sfx.capture();
        else sfx.move();
        if (record.check) sfx.check();
      }
    }

    const halfmoves = s.halfmoves + 1;
    const base = {
      records: [...s.records, record],
      board,
      turn: opponent,
      halfmoves,
      lastMove: { from: iccsFrom(record.iccs), to: iccsTo(record.iccs) },
      selected: null,
      targets: [],
      // 局面已变, 提示失效
      hintForFen: null,
      hintBest: null,
      hintMove: null,
      // 引擎应手完成即解锁界面; 轮到引擎时下方分支再置 true
      engineThinking: false,
    };

    // 对手(引擎方)无合法走法 => 被将杀/困毙, 行棋方胜
    if (outcome === "checkmate" || outcome === "stalemate") {
      set(base);
      finish(id, mover === s.playerSide ? "win" : "lose", "mate");
      return;
    }

    // 回合上限
    if (halfmoves >= HALFMOVE_LIMIT) {
      set(base);
      finish(id, s.playerSide === "black" ? "win" : "lose", "limit");
      return;
    }

    if (opponent === s.playerSide) {
      set(base);
      return;
    }

    // 轮到引擎
    set({ ...base, engineThinking: true });
    void engineReply(id);
  };

  return {
    mode: "practice",
    tikuName: "",
    questionIndex: 0,
    question: null,

    board: [],
    turn: "red",
    playerSide: "red",
    records: [],
    halfmoves: 0,

    selected: null,
    targets: [],
    lastMove: null,

    hintForFen: null,
    hintBest: null,
    hintMove: null,
    hintLoading: false,

    engineThinking: false,
    phase: "idle",
    finishReason: null,
    overlayDismissed: false,

    revealFrames: [],
    revealIndex: 0,
    revealLoading: false,
    revealPrevPhase: null,

    loadQuestion: (mode, tikuName, index, q) => {
      token();
      const { board, turn } = parseFen(q.fen);
      set({
        mode,
        tikuName,
        questionIndex: index,
        question: q,
        board,
        turn,
        playerSide: q.flipped ? "black" : "red",
        records: [],
        halfmoves: 0,
        selected: null,
        targets: [],
        lastMove: null,
        hintForFen: null,
        hintBest: null,
        hintMove: null,
        hintLoading: false,
        engineThinking: false,
        phase: "playing",
        finishReason: null,
        overlayDismissed: false,
        revealFrames: [],
        revealIndex: 0,
        revealLoading: false,
        revealPrevPhase: null,
      });
    },

    closeQuestion: () => {
      token();
      set({
        mode: "practice",
        tikuName: "",
        questionIndex: 0,
        question: null,
        board: [],
        turn: "red",
        playerSide: "red",
        records: [],
        halfmoves: 0,
        selected: null,
        targets: [],
        lastMove: null,
        engineThinking: false,
        phase: "idle",
        finishReason: null,
        overlayDismissed: false,
        revealFrames: [],
        revealIndex: 0,
        revealLoading: false,
        revealPrevPhase: null,
      });
    },

    clickSquare: (pos) => {
      const s = get();
      if (s.phase !== "playing" || s.engineThinking) return;
      if (s.turn !== s.playerSide) return;

      if (s.selected) {
        const isTarget = s.targets.some((t) => t.x === pos.x && t.y === pos.y);
        if (isTarget) {
          const id = token();
          const { record } = applyMove(s.board, s.turn, s.selected, pos);
          afterMove(record, id);
          return;
        }
      }

      const piece = s.board[idx(pos.x, pos.y)];
      if (piece) {
        const color: Color = piece === piece.toUpperCase() ? "red" : "black";
        if (color === s.playerSide) {
          if (s.selected && s.selected.x === pos.x && s.selected.y === pos.y) {
            set({ selected: null, targets: [] });
          } else {
            set({ selected: pos, targets: legalMovesFrom(s.board, pos) });
          }
          if (useSettings.getState().sound) sfx.click();
          return;
        }
      }
      set({ selected: null, targets: [] });
    },

    undoMove: () => {
      const s = get();
      if (s.phase !== "playing" || s.engineThinking || s.records.length === 0) return;
      const last = s.records[s.records.length - 1]!;
      // 最后一手是玩家 => 悔一手; 是引擎 => 连玩家的手一起悔
      const k = Math.min(last.side === s.playerSide ? 1 : 2, s.records.length);
      const back = s.records[s.records.length - k]!;
      const { board, turn } = parseFen(back.fenBefore);
      token();
      set({
        records: s.records.slice(0, s.records.length - k),
        board,
        turn,
        halfmoves: Math.max(0, s.halfmoves - k),
        selected: null,
        targets: [],
        hintForFen: null,
        hintBest: null,
        hintMove: null,
        lastMove:
          s.records.length - k >= 1
            ? {
                from: iccsFrom(s.records[s.records.length - k - 1]!.iccs),
                to: iccsTo(s.records[s.records.length - k - 1]!.iccs),
              }
            : null,
        engineThinking: false,
      });
    },

    retry: () => {
      const s = get();
      if (!s.question) return;
      s.loadQuestion(s.mode, s.tikuName, s.questionIndex, s.question);
    },

    revealAnswer: async () => {
      const s = get();
      if (!s.question || s.revealLoading) return;
      if (s.phase !== "won" && s.phase !== "lost") return;
      const prevPhase = s.phase;
      set({ revealLoading: true, revealFrames: [], revealIndex: 0, revealPrevPhase: prevPhase });
      try {
        const line = await solveLine(s.question.fen);
        // 前端逐手推演出演示帧
        const { board, turn } = parseFen(s.question.fen);
        const frames: RevealFrame[] = [
          { fen: s.question.fen, from: null, to: null, notation: "起始局面" },
        ];
        let b = board;
        let t = turn;
        for (const iccs of line) {
          const from = iccsFrom(iccs);
          const to = iccsTo(iccs);
          const { board: nb, record } = applyMove(b, t, from, to);
          frames.push({
            fen: record.fenAfter,
            from,
            to,
            notation: `${record.side === "red" ? "红" : "黑"}：${record.notation}`,
          });
          b = nb;
          t = t === "red" ? "black" : "red";
        }
        set({ revealLoading: false, revealFrames: frames, revealIndex: 0, phase: "revealing" });
      } catch (e) {
        console.error("求解杀法线失败", e);
        set({ revealLoading: false, revealPrevPhase: null });
        alert("引擎求解失败，请重试");
      }
    },

    advanceReveal: () => {
      const s = get();
      if (s.phase !== "revealing") return;
      if (s.revealIndex < s.revealFrames.length - 1) {
        set({ revealIndex: s.revealIndex + 1 });
        if (useSettings.getState().sound) sfx.click();
      } else {
        set({ phase: s.revealPrevPhase ?? "lost", revealPrevPhase: null });
      }
    },

    giveHint: async () => {
      const s = get();
      if (s.phase !== "playing" || s.engineThinking || s.turn !== s.playerSide) return;
      if (!s.board.length || !s.question) return;
      const fen =
        s.records.length > 0 ? s.records[s.records.length - 1]!.fenAfter : s.question.fen;

      // 同局面已缓存 => 直接重画箭头(不再调引擎)
      if (s.hintForFen === fen && s.hintBest) {
        set({ hintMove: { from: iccsFrom(s.hintBest), to: iccsTo(s.hintBest) } });
        if (useSettings.getState().sound) sfx.click();
        return;
      }

      set({ hintLoading: true });
      try {
        const reply = await engineMove(fen);
        if (!reply.bestmove) {
          set({ hintLoading: false });
          return;
        }
        // 等待期间局面可能已变(如重做/切题), 只对发起时的局面生效
        if (get().phase !== "playing") {
          set({ hintLoading: false });
          return;
        }
        set({
          hintLoading: false,
          hintForFen: fen,
          hintBest: reply.bestmove,
          hintMove: { from: iccsFrom(reply.bestmove), to: iccsTo(reply.bestmove) },
        });
        if (useSettings.getState().sound) sfx.click();
      } catch (e) {
        console.error("提示求解失败", e);
        set({ hintLoading: false });
        alert("引擎提示求解失败，请重试");
      }
    },

    dismissOverlay: () => {
      if (get().phase === "won" || get().phase === "lost") {
        set({ overlayDismissed: true });
        if (useSettings.getState().sound) sfx.click();
      }
    },
  };
});
