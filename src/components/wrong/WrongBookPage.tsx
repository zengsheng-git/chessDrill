import { useEffect, useMemo, useRef, useState } from "react";
import DrillPanel from "../drill/DrillPanel";
import { useLibrary } from "../../stores/libraryStore";
import { useQuiz } from "../../stores/quizStore";
import { useProgress } from "../../stores/progressStore";

export default function WrongBookPage() {
  const { loaded, loadQuestions } = useLibrary();
  const wrongBook = useProgress((s) => s.wrongBook);
  const clearWrongBook = useProgress((s) => s.clearWrongBook);
  const quiz = useQuiz();

  const [tikuName, setTikuName] = useState<string | null>(null);
  const started = useRef(false);

  const groups = useMemo(() => {
    return Object.entries(wrongBook)
      .filter(([, list]) => list.length > 0)
      .map(([name, list]) => ({ name, list }));
  }, [wrongBook]);

  // 默认进入第一个有错题的题库
  useEffect(() => {
    if (!started.current && groups.length > 0) {
      started.current = true;
      void enterTiku(groups[0]!.name);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groups]);

  async function enterTiku(name: string) {
    setTikuName(name);
    const questions = await loadQuestions(name);
    const list = wrongBook[name] ?? [];
    if (list.length === 0) return;
    const idx = list[0]!;
    useQuiz.getState().loadQuestion("wrong", name, idx, questions[idx]!);
  }

  const list = tikuName ? (wrongBook[tikuName] ?? []) : [];
  const questions = tikuName ? loaded[tikuName] : undefined;
  const cursor = list.findIndex((i) => i === quiz.questionIndex);

  function goNextWrong() {
    if (!tikuName || !questions || list.length === 0) return;
    const pos = cursor >= 0 ? (cursor + 1) % list.length : 0;
    const idx = list[pos]!;
    useQuiz.getState().loadQuestion("wrong", tikuName, idx, questions[idx]!);
  }

  function goPrevWrong() {
    if (!tikuName || !questions || list.length === 0) return;
    const pos = cursor >= 0 ? (cursor - 1 + list.length) % list.length : list.length - 1;
    const idx = list[pos]!;
    useQuiz.getState().loadQuestion("wrong", tikuName, idx, questions[idx]!);
  }

  function removeFromWrong() {
    if (!tikuName) return;
    const idx = quiz.questionIndex;
    useProgress.getState().removeFromWrong(tikuName, idx);
    const rest = list.filter((i) => i !== idx);
    if (rest.length === 0) {
      useQuiz.getState().closeQuestion();
      return;
    }
    const nextIdx = rest[0]!;
    void loadQuestions(tikuName).then((qs) => {
      useQuiz.getState().loadQuestion("wrong", tikuName, nextIdx, qs[nextIdx]!);
    });
  }

  return (
    <div className="flex h-full flex-col">
      {/* 顶部工具行: 错题库下拉 + 清空 */}
      <div className="flex shrink-0 items-center gap-2 border-b border-ink-700 bg-ink-900 px-3 py-2">
        <select
          value={tikuName ?? ""}
          onChange={(e) => void enterTiku(e.target.value)}
          className="min-w-0 flex-1 rounded-lg border border-ink-600 bg-ink-850 px-2 py-1.5 text-xs text-ink-200 outline-none disabled:opacity-60"
          disabled={groups.length === 0}
        >
          {groups.length === 0 ? (
            <option>暂无错题</option>
          ) : (
            groups.map((g) => (
              <option key={g.name} value={g.name}>
                {g.name}（{g.list.length} 题）
              </option>
            ))
          )}
        </select>
        {tikuName && list.length > 0 && (
          <button
            onClick={() => {
              if (confirm(`清空「${tikuName}」的全部错题记录？`)) {
                clearWrongBook(tikuName);
                setTikuName(null);
                useQuiz.getState().closeQuestion();
              }
            }}
            className="shrink-0 rounded-lg bg-ink-700 px-2 py-1.5 text-xs text-ink-300 hover:bg-ink-600"
          >
            清空
          </button>
        )}
      </div>

      {/* 做题区 */}
      <div className="min-h-0 flex-1">
        {tikuName && questions && quiz.question ? (
          <DrillPanel
            headerLeft={
              <span>
                错题本 · 剩 {list.length} 题
              </span>
            }
            onNext={goNextWrong}
            nextDisabled={list.length <= 1}
            nextLabel="下一错题"
            onPrev={goPrevWrong}
            prevDisabled={list.length <= 1}
            showReveal
            showUndo
            extraAction={{ label: "移出", onClick: removeFromWrong }}
            footerHint="答对一次自动移出错题本"
          />
        ) : (
          <div className="flex h-full flex-col items-center justify-center gap-1 text-sm text-ink-400">
            <span>{groups.length === 0 ? "错题本是空的" : "选择题库开始重刷错题"}</span>
            <span className="text-xs">答错的题会自动收进这里</span>
          </div>
        )}
      </div>
    </div>
  );
}
