import { useEffect, useMemo, useState } from "react";
import Board from "../board/Board";
import VideoExportDialog from "../video/VideoExportDialog";
import { sourceFromQuestion } from "../../lib/video/build";
import { useQuiz } from "../../stores/quizStore";
import { findKing, isInCheck } from "../../lib/board/rules";
import { chineseNotation } from "../../lib/board/notation";
import type { Pos } from "../../lib/board/types";

interface DrillPanelProps {
  headerLeft?: React.ReactNode;
  onNext?: () => void;
  nextLabel?: string;
  nextDisabled?: boolean;
  onPrev?: () => void;
  prevDisabled?: boolean;
  showReveal?: boolean;
  showUndo?: boolean;
  /** 是否提供阶梯提示(测试模式为 false) */
  showHint?: boolean;
  footerHint?: string;
  extraAction?: { label: string; onClick: () => void };
}

function resultBanner(phase: string, reason: "mate" | "limit" | null) {
  if (phase === "won") {
    return reason === "limit"
      ? { title: "守和成功", cls: "text-emerald-600", sub: "撑满 60 回合未被将杀" }
      : { title: "将杀成功", cls: "text-emerald-600", sub: "漂亮，杀法干净利落" };
  }
  if (phase === "lost") {
    return reason === "limit"
      ? { title: "未能将杀", cls: "text-verm-600", sub: "60 回合内没有完成绝杀，再试一次" }
      : { title: "解题失败", cls: "text-verm-600", sub: "被对手反制，看看正确杀法" };
  }
  return null;
}

export default function DrillPanel({
  headerLeft,
  onNext,
  nextLabel = "下一题",
  nextDisabled = false,
  onPrev,
  prevDisabled = false,
  showReveal = true,
  showUndo = true,
  showHint = true,
  footerHint,
  extraAction,
}: DrillPanelProps) {
  const s = useQuiz();
  const [videoOpen, setVideoOpen] = useState(false);

  const checkPos = useMemo<Pos | null>(() => {
    if (s.phase !== "playing" || !s.board.length) return null;
    if (!isInCheck(s.board, s.turn)) return null;
    return findKing(s.board, s.turn);
  }, [s.board, s.turn, s.phase]);

  // 答案演示自动播放
  useEffect(() => {
    if (s.phase !== "revealing") return;
    const timer = setInterval(() => {
      useQuiz.getState().advanceReveal();
    }, 850);
    return () => clearInterval(timer);
  }, [s.phase]);

  const reveal = s.revealFrames[s.revealIndex];
  const banner = resultBanner(s.phase, s.finishReason);
  const fen =
    s.phase === "revealing" && reveal ? reveal.fen : s.board.length ? fenOf(s) : "";
  const revealLast =
    s.phase === "revealing" && reveal?.from && reveal?.to ? { from: reveal.from, to: reveal.to } : null;

  const interactive = s.phase === "playing" && !s.engineThinking && s.turn === s.playerSide;

  // 提示文案(替代底部 hint 显示, 零新增高度)
  const hintText = useMemo(() => {
    if (s.phase !== "playing") return null;
    if (s.hintLoading) return "提示求解中…";
    if (s.hintMove) {
      try {
        const text = chineseNotation(s.board, s.hintMove.from, s.hintMove.to);
        return `提示：建议走「${text}」`;
      } catch {
        return "提示：按箭头走子";
      }
    }
    return null;
  }, [s.phase, s.hintLoading, s.hintMove, s.board]);
  const canUndo = showUndo && s.phase === "playing" && !s.engineThinking && s.records.length > 0;

  // 着法横滚条文本: 1.炮二平五 车9进1  2.…
  const movesText = useMemo(() => {
    const parts: string[] = [];
    for (let i = 0; i < s.records.length; i += 2) {
      const no = i / 2 + 1;
      const red = s.records[i]?.side === "red" ? s.records[i]?.notation : "";
      const black = s.records[i + 1]?.side === "black" ? s.records[i + 1]?.notation : "";
      parts.push(`${no}.${red} ${black}`);
    }
    return parts.join("  ");
  }, [s.records]);

  const statusText =
    s.phase === "idle"
      ? "—"
      : s.phase === "playing"
        ? s.engineThinking
          ? "对手思考中…"
          : s.turn === s.playerSide
            ? "请你走子"
            : "等待"
        : s.phase === "revealing"
          ? "答案演示中"
          : "已结算";

  return (
    <div className="flex h-full min-w-0 flex-col">
      {/* 题目信息单行 */}
      <div className="flex items-center justify-between gap-2 px-3 pt-1.5 text-[11px] leading-4 text-ink-400">
        <span className="min-w-0 truncate">
          {headerLeft}
          {s.question && (
            <>
              {" "}· 第 {s.questionIndex + 1} 题
              {s.question.title && <span className="font-medium text-ink-300"> {s.question.title}</span>}
            </>
          )}
        </span>
        <span className="shrink-0">
          你执{s.playerSide === "red" ? "红" : "黑"} · {statusText} · 回合 {Math.floor(s.halfmoves / 2)}
        </span>
      </div>

      {/* 棋盘: 宽满优先, 高度不足时自动等比缩小完整显示(contain) */}
      <div className="relative flex min-h-0 flex-1 items-center justify-center overflow-hidden">
        <Board
          fen={fen}
          flipped={s.playerSide === "black"}
          lastMove={s.phase === "revealing" ? revealLast : s.lastMove}
          selected={s.selected}
          targets={s.targets}
          checkPos={checkPos}
          hintArrow={s.phase === "playing" ? s.hintMove : null}
          interactive={interactive}
          onSquareClick={(pos) => useQuiz.getState().clickSquare(pos)}
        />

        {/* 结算浮层(可关闭: 右上角 × 或点击遮罩空白) */}
        {(s.phase === "won" || s.phase === "lost") && banner && !s.overlayDismissed && (
          <div
            className="absolute inset-0 z-10 flex items-center justify-center bg-black/40"
            onClick={(e) => {
              if (e.target === e.currentTarget) useQuiz.getState().dismissOverlay();
            }}
          >
            <div className="relative w-64 rounded-xl bg-ink-800 p-5 pt-7 text-center shadow-2xl">
              <button
                onClick={() => useQuiz.getState().dismissOverlay()}
                title="关闭(查看棋盘)"
                className="absolute right-2 top-2 flex h-7 w-7 items-center justify-center rounded-full text-lg leading-none text-ink-400 hover:bg-ink-700 hover:text-ink-200"
              >
                ×
              </button>
              <div className={`text-xl font-bold ${banner.cls}`}>{banner.title}</div>
              <div className="mt-1.5 text-xs text-ink-400">{banner.sub}</div>
              <div className="mt-4 flex flex-col gap-2">
                {showReveal && (
                  <button
                    onClick={() => void useQuiz.getState().revealAnswer()}
                    disabled={s.revealLoading}
                    className="rounded-lg bg-gold-500 px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
                  >
                    {s.revealLoading ? "引擎求解中…" : "看答案"}
                  </button>
                )}
                <div className="flex gap-2">
                  <button
                    onClick={() => useQuiz.getState().retry()}
                    className="flex-1 rounded-lg border border-ink-600 px-3 py-2 text-sm text-ink-200 hover:bg-ink-850"
                  >
                    再做一次
                  </button>
                  {onNext && (
                    <button
                      onClick={onNext}
                      disabled={nextDisabled}
                      className="flex-1 rounded-lg bg-verm-600 px-3 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
                    >
                      {nextLabel}
                    </button>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* 答案演示进度条 */}
        {s.phase === "revealing" && reveal && (
          <div className="absolute bottom-2 left-1/2 -translate-x-1/2 whitespace-nowrap rounded-full bg-ink-800/95 px-4 py-1.5 text-xs text-ink-200 shadow-lg">
            <span className="mr-2 font-medium">{reveal.notation}</span>
            <span className="text-ink-400">
              {s.revealIndex + 1} / {s.revealFrames.length}
            </span>
          </div>
        )}
        {s.phase === "revealing" && (
          <button
            onClick={() => useQuiz.getState().advanceReveal()}
            className="absolute bottom-2 right-2 rounded-lg border border-ink-600 bg-ink-800 px-2.5 py-1 text-xs text-ink-300 hover:bg-ink-850"
          >
            跳过
          </button>
        )}
      </div>

      {/* 底部面板: 着法 + 单行按钮 */}
      <div className="shrink-0 border-t border-ink-700 bg-ink-900 px-2 py-1.5">
        <div className="h-4 overflow-x-auto whitespace-nowrap font-mono text-[11px] leading-4 text-ink-300">
          {movesText || <span className="text-ink-400">尚未走子</span>}
        </div>
        <div className="mt-1 flex gap-1">
          <button
            onClick={() => useQuiz.getState().undoMove()}
            disabled={!canUndo}
            className="flex-1 rounded-md border border-ink-600 bg-ink-900 px-1 py-1.5 text-[11px] text-ink-200 hover:bg-ink-850 disabled:opacity-40"
          >
            悔棋
          </button>
          {showHint && (
            <button
              onClick={() => void useQuiz.getState().giveHint()}
              disabled={s.phase !== "playing" || s.engineThinking || s.turn !== s.playerSide || s.hintLoading}
              className={`flex-1 rounded-md border px-1 py-1.5 text-[11px] disabled:opacity-40 ${
                s.hintMove || s.hintLoading
                  ? "border-emerald-600 bg-emerald-600/10 text-emerald-700"
                  : "border-ink-600 bg-ink-900 text-ink-200 hover:bg-ink-850"
              }`}
            >
              {s.hintLoading ? "求解中" : "提示"}
            </button>
          )}
          <button
            onClick={() => useQuiz.getState().retry()}
            disabled={s.phase === "idle" || s.phase === "revealing"}
            className="flex-1 rounded-md border border-ink-600 bg-ink-900 px-1 py-1.5 text-[11px] text-ink-200 hover:bg-ink-850 disabled:opacity-40"
          >
            重做
          </button>
          <button
            onClick={() => setVideoOpen(true)}
            disabled={!s.question || s.phase === "revealing"}
            title="把本题参考杀法线导出为竖版解说视频"
            className="flex-1 rounded-md border border-ink-600 bg-ink-900 px-1 py-1.5 text-[11px] text-ink-200 hover:bg-ink-850 disabled:opacity-40"
          >
            导视频
          </button>
          {onPrev && (
            <button
              onClick={onPrev}
              disabled={prevDisabled}
              className="flex-1 rounded-md border border-ink-600 bg-ink-900 px-1 py-1.5 text-[11px] text-ink-200 hover:bg-ink-850 disabled:opacity-40"
            >
              ◀ 上题
            </button>
          )}
          {extraAction && (
            <button
              onClick={extraAction.onClick}
              className="flex-1 rounded-md border border-ink-600 bg-ink-900 px-1 py-1.5 text-[11px] text-ink-300 hover:bg-ink-850"
            >
              {extraAction.label}
            </button>
          )}
          {onNext && (
            <button
              onClick={onNext}
              disabled={nextDisabled}
              className="flex-[1.5] rounded-md bg-verm-600 px-1 py-1.5 text-[11px] font-medium text-white hover:opacity-90 disabled:opacity-40"
            >
              {nextLabel}
            </button>
          )}
        </div>
        <div className="mt-0.5 truncate text-[10px] leading-3.5">
          {hintText ? (
            <span className="font-medium text-amber-700">{hintText}</span>
          ) : (s.phase === "won" || s.phase === "lost") && s.overlayDismissed ? (
            <span className="text-ink-300">
              {banner?.title} ·{" "}
              {showReveal && (
                <button
                  onClick={() => void useQuiz.getState().revealAnswer()}
                  disabled={s.revealLoading}
                  className="font-medium text-emerald-700 underline underline-offset-2 hover:opacity-80 disabled:opacity-50"
                >
                  {s.revealLoading ? "求解中…" : "看答案"}
                </button>
              )}
              {!showReveal && "已关闭结算框"}
            </span>
          ) : (
            footerHint && <span className="text-ink-400">{footerHint}</span>
          )}
        </div>
      </div>

      {/* 导出视频对话框: 推演本题参考杀法线 */}
      {videoOpen && (
        <VideoExportDialog
          loadSource={() => {
            const q = useQuiz.getState().question;
            if (!q) return Promise.reject(new Error("当前没有题目"));
            return sourceFromQuestion({
              fen: q.fen,
              title: q.title?.trim() || `${useQuiz.getState().tikuName} · 第 ${useQuiz.getState().questionIndex + 1} 题`,
              subtitle: useQuiz.getState().tikuName,
            });
          }}
          onClose={() => setVideoOpen(false)}
        />
      )}
    </div>
  );
}

function fenOf(s: ReturnType<typeof useQuiz.getState>): string {
  return s.records.length > 0 ? s.records[s.records.length - 1]!.fenAfter : s.question!.fen;
}
