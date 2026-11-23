import { useEffect, useRef, useState } from "react";
import DrillPanel from "../drill/DrillPanel";
import { useLibrary } from "../../stores/libraryStore";
import { useQuiz } from "../../stores/quizStore";
import { useProgress } from "../../stores/progressStore";
import { useSettings } from "../../stores/settingsStore";

export default function PracticePage() {
  const { tikus, tikusError, loaded, loadQuestions } = useLibrary();
  const quiz = useQuiz();
  const byTiku = useProgress((s) => s.byTiku);
  const autoNext = useSettings((s) => s.autoNext);

  const [tikuName, setTikuName] = useState<string | null>(null);
  const [randomMode, setRandomMode] = useState(false);
  const started = useRef(false);

  // 默认选中第一个题库
  useEffect(() => {
    if (!started.current && tikus.length > 0) {
      started.current = true;
      void selectTiku(tikus[0]!.name);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tikus]);

  async function selectTiku(name: string) {
    setTikuName(name);
    const questions = await loadQuestions(name);
    const rec = byTiku[name] ?? {};
    const first = questions.findIndex((_, i) => !rec[i]);
    const index = randomMode
      ? pickRandom(questions.length, rec)
      : first >= 0
        ? first
        : 0;
    useQuiz.getState().loadQuestion("practice", name, index, questions[index]!);
  }

  function pickRandom(len: number, rec: Record<number, unknown>): number {
    const undone: number[] = [];
    for (let i = 0; i < len; i++) if (!rec[i]) undone.push(i);
    const pool = undone.length > 0 ? undone : Array.from({ length: len }, (_, i) => i);
    return pool[Math.floor(Math.random() * pool.length)]!;
  }

  const questions = tikuName ? loaded[tikuName] : undefined;

  function goNext() {
    if (!tikuName || !questions) return;
    const rec = byTiku[tikuName] ?? {};
    const next = randomMode
      ? pickRandom(questions.length, rec)
      : (useQuiz.getState().questionIndex + 1) % questions.length;
    useQuiz.getState().loadQuestion("practice", tikuName, next, questions[next]!);
  }

  function goPrev() {
    if (!tikuName || !questions) return;
    const prev =
      (useQuiz.getState().questionIndex - 1 + questions.length) % questions.length;
    useQuiz.getState().loadQuestion("practice", tikuName, prev, questions[prev]!);
  }

  // 自动下一题(答对后延时跳转)
  useEffect(() => {
    if (!autoNext || quiz.phase !== "won" || quiz.mode !== "practice") return;
    const timer = setTimeout(() => goNext(), 1500);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [quiz.phase, autoNext]);

  // 当选题库进度(派生值, byTiku 变化即重渲染)
  const total = tikuName ? (loaded[tikuName]?.length ?? 0) : 0;
  const rec = tikuName ? (byTiku[tikuName] ?? {}) : {};
  let done = 0;
  for (let i = 0; i < total; i++) if (rec[i]) done += 1;
  const progress = { done, total };

  return (
    <div className="flex h-full flex-col">
      {/* 顶部工具行: 题库下拉 + 模式 + 进度 */}
      <div className="flex shrink-0 items-center gap-2 border-b border-ink-700 bg-ink-900 px-3 py-2">
        <select
          value={tikuName ?? ""}
          onChange={(e) => void selectTiku(e.target.value)}
          className="min-w-0 flex-1 rounded-lg border border-ink-600 bg-ink-850 px-2 py-1.5 text-xs text-ink-200 outline-none"
        >
          {tikusError && tikus.length === 0 && <option>题库加载失败</option>}
          {tikus.map((t) => (
            <option key={t.name} value={t.name}>
              {t.name}
            </option>
          ))}
        </select>
        <button
          onClick={() => setRandomMode((v) => !v)}
          className={`shrink-0 rounded-lg px-2 py-1.5 text-xs transition-colors ${
            randomMode ? "bg-verm-600 text-white" : "bg-ink-700 text-ink-300 hover:bg-ink-600"
          }`}
        >
          {randomMode ? "随机" : "顺序"}
        </button>
        <span className="shrink-0 text-[11px] text-ink-400">
          {progress.done}/{progress.total}
        </span>
      </div>
      {tikuName && (
        <div className="h-0.5 shrink-0 bg-ink-700">
          <div
            className="h-full bg-gold-500 transition-all"
            style={{ width: `${progress.total > 0 ? (progress.done / progress.total) * 100 : 0}%` }}
          />
        </div>
      )}


      {/* 做题区 */}
      <div className="min-h-0 flex-1">
        {quiz.phase === "idle" ? (
          <div className="flex h-full items-center justify-center text-sm text-ink-400">正在加载题库…</div>
        ) : (
          <DrillPanel
            headerLeft={<span className="truncate">{tikuName}</span>}
            onNext={goNext}
            onPrev={goPrev}
            showReveal
            showUndo
            footerHint="点击棋子选中走子 · 执红将杀过关 · 守和题撑满 60 回合过关"
          />
        )}
      </div>
    </div>
  );
}
