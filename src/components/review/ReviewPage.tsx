import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import ReplayBoard from "./ReplayBoard";
import MoveTree from "./MoveTree";
import CommentPanel from "./CommentPanel";
import GameInfo from "./GameInfo";
import Sidebar from "./Sidebar";
import FileList from "./FileList";
import RecordPanel from "./RecordPanel";
import AnalysisPanel from "./AnalysisPanel";
import TiantianDialog from "./TiantianDialog";
import { isTauriEnv } from "../../lib/ipc";
import { useLibraryStore } from "../../stores/gameLibraryStore";
import { currentFen, selectNode, useGameStore } from "../../stores/gameStore";
import { useRecorderStore } from "../../stores/recorderStore";
import type { Pos } from "../../lib/board/types";

/** 悬停候选落点时的预览标记 */
type MovePreview = { from: Pos; to: Pos };

const BTN =
  "flex-1 rounded-md border border-ink-600 bg-ink-900 px-0.5 py-1 text-[11px] text-ink-200 hover:bg-ink-850 disabled:opacity-40 disabled:hover:bg-ink-900";

/// 复盘模块: 对齐练习模式的窄屏单列布局。
/// "棋谱库"子视图浏览/管理棋谱文件, "复盘台"子视图棋盘复盘; 打开棋谱自动切台。
export default function ReviewPage({ onExit }: { onExit: () => void }) {
  const [view, setView] = useState<"library" | "board">("library");
  const [infoOpen, setInfoOpen] = useState(false);
  const [recordOpen, setRecordOpen] = useState(false);
  const [analysisOpen, setAnalysisOpen] = useState(false);
  const [tiantianOpen, setTiantianOpen] = useState(false);
  const [previewMove, setPreviewMove] = useState<MovePreview | null>(null);

  const libraryRoot = useLibraryStore((s) => s.root);
  const libraryLoading = useLibraryStore((s) => s.loading);
  const libraryError = useLibraryStore((s) => s.error);
  const totalFiles = useLibraryStore((s) => s.files.length);

  const game = useGameStore((s) => s.game);
  const path = useGameStore((s) => s.path);
  const fileName = useGameStore((s) => s.fileName);
  const loadingGame = useGameStore((s) => s.loading);
  const gameError = useGameStore((s) => s.error);
  const flipped = useGameStore((s) => s.flipped);
  const goNext = useGameStore((s) => s.goNext);
  const goPrev = useGameStore((s) => s.goPrev);
  const switchVariation = useGameStore((s) => s.switchVariation);
  const gotoBranch = useGameStore((s) => s.gotoBranch);
  const goToStart = useGameStore((s) => s.goToStart);
  const goToEnd = useGameStore((s) => s.goToEnd);
  const toggleFlip = useGameStore((s) => s.toggleFlip);
  const pickBranch = useGameStore((s) => s.pickBranch);

  const recorderActive = useRecorderStore(
    (s) => s.phase === "recording" || s.phase === "locating",
  );

  // 首次进入时获取棋谱库根目录(已设置则跳过, 避免反复重扫 9000+ 文件)
  useEffect(() => {
    if (!isTauriEnv()) return;
    if (useLibraryStore.getState().root) return;
    void invoke<string>("library_dir")
      .then((dir) => useLibraryStore.getState().setRoot(dir))
      .catch((e) => console.error("获取棋谱库目录失败：", e));
  }, []);

  // 打开棋谱后自动切到复盘台
  const filePath = useGameStore((s) => s.filePath);
  useEffect(() => {
    if (filePath) setView("board");
  }, [filePath]);

  const hasGame = !!game;
  const node = selectNode(game, path);
  const fen = currentFen(game, path);
  const atStart = path.length === 0;
  const atEnd = !!node && node.children.length === 0;

  // 多分支局面: 全部候选以绿色箭头标注(中段带编号), 点编号按钮/数字键选择;
  // 落点点击仅在唯一候选匹配时生效(同落点多候选时用编号按钮, 避免歧义)
  const options = hasGame
    ? path.length === 0
      ? game!.moves
      : node?.children ?? []
    : [];
  const branchMode = options.length > 1;
  const branchOptions = branchMode ? options.map((o) => ({ from: o.from, to: o.to })) : [];

  const pickBySquare = (pos: Pos) => {
    const matches = options
      .map((o, i) => ({ o, i }))
      .filter(({ o }) => o.to.x === pos.x && o.to.y === pos.y);
    if (matches.length === 1) pickBranch(matches[0]!.i);
  };
  const previewBySquare = (pos: Pos | null) => {
    if (!pos) {
      setPreviewMove(null);
      return;
    }
    const opt = options.find((o) => o.to.x === pos.x && o.to.y === pos.y);
    setPreviewMove(opt ? { from: opt.from, to: opt.to } : null);
  };

  // 键盘导航(仅本页挂载期间生效, 不干扰练习页输入)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      // 着法/信息浮层: Esc 关闭
      if (infoOpen) {
        if (e.key === "Escape") {
          e.preventDefault();
          setInfoOpen(false);
        }
        return;
      }
      // 多分支局面: 数字键 1-9 直接选择对应候选
      if (branchMode && /^[1-9]$/.test(e.key)) {
        e.preventDefault();
        pickBranch(Math.min(Number(e.key) - 1, options.length - 1));
        return;
      }
      switch (e.key) {
        case "ArrowLeft":
          e.preventDefault();
          goPrev();
          break;
        case "ArrowRight":
          e.preventDefault();
          goNext();
          break;
        case "ArrowUp":
          e.preventDefault();
          switchVariation(-1);
          break;
        case "ArrowDown":
          e.preventDefault();
          switchVariation(1);
          break;
        case "Home":
          e.preventDefault();
          goToStart();
          break;
        case "End":
          e.preventDefault();
          goToEnd();
          break;
        case "f":
        case "F":
          toggleFlip();
          break;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [goNext, goPrev, switchVariation, goToStart, goToEnd, toggleFlip, branchMode, options.length, pickBranch, infoOpen]);

  // 棋盘区滚轮前后翻着法(Ctrl+滚轮留给全局缩放)
  const boardAreaRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const el = boardAreaRef.current;
    if (!el) return;
    let last = 0;
    const onWheel = (e: WheelEvent) => {
      if (e.ctrlKey) return;
      const now = Date.now();
      if (now - last < 90) return;
      last = now;
      if (e.deltaY > 0) goNext();
      else if (e.deltaY < 0) goPrev();
    };
    el.addEventListener("wheel", onWheel, { passive: true });
    return () => el.removeEventListener("wheel", onWheel);
  }, [goNext, goPrev]);

  const toolButtons = (
    <>
      <button
        onClick={() => setTiantianOpen(true)}
        title="粘贴天天象棋分享链接，直接还原成棋谱"
        className="rounded-md border border-ink-600 bg-ink-900 px-1.5 py-1 text-[11px] text-ink-200 hover:bg-ink-850"
      >
        链接
      </button>
      <button
        onClick={() => setRecordOpen(true)}
        title="录制对方棋软窗口的着法，可导出 PGN 或导入复盘台"
        className={`relative rounded-md border border-ink-600 bg-ink-900 px-1.5 py-1 text-[11px] text-ink-200 hover:bg-ink-850`}
      >
        {recorderActive && (
          <span className="absolute right-1 top-1 h-1.5 w-1.5 animate-pulse rounded-full bg-verm-500" />
        )}
        录制
      </button>
      <button
        onClick={() => setAnalysisOpen(true)}
        disabled={!hasGame}
        title="用 Pikafish 引擎逐手对照分析，评估对局是否软件生成（仅供参考）"
        className="rounded-md border border-ink-600 bg-ink-900 px-1.5 py-1 text-[11px] text-ink-200 hover:bg-ink-850 disabled:opacity-40"
      >
        检测
      </button>
    </>
  );

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* 顶部工具行 */}
      <div className="flex items-center gap-1.5 border-b border-ink-700 bg-ink-900 px-2 py-1.5">
        <button
          onClick={onExit}
          title="返回模块选择"
          className="rounded-md px-1.5 py-1 text-sm leading-none text-ink-400 transition-colors hover:bg-ink-800 hover:text-ink-200"
        >
          ←
        </button>
        {view === "library" ? (
          <>
            <span className="text-[11px] font-semibold tracking-wider text-ink-300">
              棋谱库{libraryRoot && <span className="ml-1 font-normal text-ink-400">共 {totalFiles} 盘</span>}
            </span>
            <button
              onClick={() => void useLibraryStore.getState().rescan()}
              disabled={!libraryRoot || libraryLoading}
              title="重新扫描棋谱库"
              className="rounded-md border border-ink-600 bg-ink-900 px-1.5 py-1 text-[11px] text-ink-200 hover:bg-ink-850 disabled:opacity-40"
            >
              {libraryLoading ? "扫描中" : "刷新"}
            </button>
            <span className="flex-1" />
            {toolButtons}
          </>
        ) : (
          <>
            <button
              onClick={() => setView("library")}
              title="返回棋谱库"
              className="rounded-md border border-ink-600 bg-ink-900 px-1.5 py-1 text-[11px] text-ink-200 hover:bg-ink-850"
            >
              ← 库
            </button>
            <span className="min-w-0 flex-1 truncate text-[11px] text-ink-300" title={fileName ?? undefined}>
              {fileName ?? "未打开棋谱"}
            </span>
            {toolButtons}
          </>
        )}
      </div>

      {(libraryError || gameError) && (
        <div className="shrink-0 border-b border-verm-600/40 bg-verm-600/10 px-3 py-1 text-[11px] text-verm-600">
          {libraryError ?? gameError}
        </div>
      )}

      {view === "library" ? (
        // 棋谱库: 上分类树, 下文件列表
        <div className="flex min-h-0 flex-1 flex-col">
          <div className="flex h-[36%] min-h-0 flex-col border-b border-ink-700">
            <Sidebar />
          </div>
          <div className="min-h-0 flex-1">
            <FileList />
          </div>
        </div>
      ) : (
        // 复盘台: 棋盘 + 导航 + 着法树/信息
        <div className="flex min-h-0 flex-1 flex-col">
          <div ref={boardAreaRef} className="relative flex min-h-0 flex-1 items-center justify-center overflow-hidden" title="滚轮可前后翻看着法">
            <ReplayBoard
              fen={fen}
              flipped={flipped}
              lastMove={node ? { from: node.from, to: node.to } : null}
              previewMove={previewMove}
              branchOptions={branchOptions}
              onSquareClick={pickBySquare}
              onSquareHover={previewBySquare}
            />
            {!hasGame && (
              <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
                <div className="rounded-xl border border-ink-700 bg-ink-900/90 px-5 py-3.5 text-center shadow-xl">
                  <p className="text-sm text-gold-500">从棋谱库选择一盘棋，即可开始复盘</p>
                  <p className="mt-1 text-[11px] text-ink-400">
                    ← → 或滚轮翻着法 · ↑ ↓ 切换变例 · F 翻转棋盘
                  </p>
                </div>
              </div>
            )}
            {loadingGame && (
              <div className="absolute inset-0 z-20 flex items-center justify-center bg-ink-950/60">
                <span className="animate-pulse text-sm text-gold-500">正在解析棋谱…</span>
              </div>
            )}
          </div>

          {/* 单行小按钮: 与练习模式同款尺寸 */}
          <div className="shrink-0 border-t border-ink-700 bg-ink-900 px-2 py-1.5">
            <div className="flex gap-1">
              <button onClick={goToStart} disabled={!hasGame || atStart} className={BTN} title="回到开始（Home）">
                ⏮开局
              </button>
              <button onClick={goPrev} disabled={!hasGame || atStart} className={BTN} title="上一步（←）">
                ◀上手
              </button>
              <button onClick={goNext} disabled={!hasGame || atEnd} className={BTN} title="下一步（→）">
                下手▶
              </button>
              <button onClick={goToEnd} disabled={!hasGame || atEnd} className={BTN} title="走到终局（End）">
                终局⏭
              </button>
              <button onClick={() => gotoBranch(-1)} disabled={!hasGame || atStart} className={BTN} title="跳到上一个有变招的局面">
                ‹分歧
              </button>
              <button onClick={() => gotoBranch(1)} disabled={!hasGame} className={BTN} title="跳到下一个有变招的局面">
                分歧›
              </button>
              <button onClick={toggleFlip} className={BTN} title="翻转棋盘（F）">
                ⇅翻转
              </button>
              <button
                onClick={() => setInfoOpen(true)}
                disabled={!hasGame}
                className={`${BTN} ${hasGame ? "border-gold-500/50 text-gold-500" : ""}`}
                title="着法树与对局信息"
              >
                📝谱
              </button>
            </div>
            {/* 分支局面: 编号按钮行, 点编号选走对应箭头候选 */}
            {branchMode && (
              <div className="flex gap-1 pt-1">
                {options.slice(0, 9).map((opt, i) => (
                  <button
                    key={opt.id}
                    onClick={() => pickBranch(i)}
                    className={`${BTN} border-emerald-600/50 font-semibold text-emerald-700`}
                    title={`走 ${opt.notation}（数字键 ${i + 1}）`}
                  >
                    {i + 1}
                  </button>
                ))}
                {options.length > 9 && (
                  <span className="flex flex-1 items-center justify-end px-1 text-[10px] text-ink-400">
                    其余 {options.length - 9} 个候选用着法树选择
                  </span>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {/* 着法树与对局信息浮层(按需弹出, 不占棋盘空间) */}
      {infoOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-ink-950/70"
          onClick={() => setInfoOpen(false)}
        >
          <div
            className="flex max-h-[80vh] w-[min(460px,calc(100vw-24px))] flex-col rounded-xl border border-gold-500/40 bg-ink-900 p-4 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-2 flex shrink-0 items-center justify-between">
              <span className="text-sm font-bold text-gold-300">
                着法与信息
                {game && game.branchCount > 0 && (
                  <span className="ml-2 text-xs font-normal text-ink-400">
                    {game.branchCount} 处变例
                  </span>
                )}
              </span>
              <button
                onClick={() => setInfoOpen(false)}
                title="关闭（Esc）"
                className="rounded px-1.5 py-0.5 text-ink-400 transition-colors hover:bg-ink-800 hover:text-ink-200"
              >
                ✕
              </button>
            </div>
            {hasGame ? (
              <>
                <div className="min-h-0 flex-1 overflow-y-auto">
                  <GameInfo />
                  <div className="h-[420px]">
                    <MoveTree />
                  </div>
                </div>
                <CommentPanel />
              </>
            ) : (
              <div className="py-10 text-center text-sm text-ink-400">未打开棋谱</div>
            )}
          </div>
        </div>
      )}

      {recordOpen && <RecordPanel onClose={() => setRecordOpen(false)} />}
      {tiantianOpen && <TiantianDialog onClose={() => setTiantianOpen(false)} />}
      {analysisOpen && <AnalysisPanel onClose={() => setAnalysisOpen(false)} />}
    </div>
  );
}
