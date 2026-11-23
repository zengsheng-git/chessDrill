import { useEffect, useRef, useState } from "react";
import DrillPanel from "../drill/DrillPanel";
import { useLibrary } from "../../stores/libraryStore";
import { useQuiz } from "../../stores/quizStore";
import { useProgress } from "../../stores/progressStore";

interface Session {
  tikuName: string;
  indexes: number[];
  cursor: number;
  results: ("win" | "lose")[];
  startedAt: number;
}

function shuffle(n: number, k: number): number[] {
  const arr = Array.from({ length: n }, (_, i) => i);
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j]!, arr[i]!];
  }
  return arr.slice(0, Math.min(k, n));
}

export default function TestPage() {
  const { tikus, loaded, loadQuestions } = useLibrary();
  const quizPhase = useQuiz((s) => s.phase);
  const quizMode = useQuiz((s) => s.mode);
  const addTestRecord = useProgress((s) => s.addTestRecord);

  const [session, setSession] = useState<Session | null>(null);
  const recorded = useRef<Set<number>>(new Set());

  async function startTest(name: string, count: number) {
    const qs = await loadQuestions(name);
    const indexes = shuffle(qs.length, count);
    if (indexes.length === 0) return;
    recorded.current = new Set();
    setSession({
      tikuName: name,
      indexes,
      cursor: 0,
      results: [],
      startedAt: Date.now(),
    });
    useQuiz.getState().loadQuestion("test", name, indexes[0]!, qs[indexes[0]!]!);
  }

  // 每题结算后记录成绩
  const lastSettled = useRef<string>("");
  useEffect(() => {
    if (!session || !quizPhase || quizMode !== "test") return;
    if (quizPhase !== "won" && quizPhase !== "lost") return;
    const key = `${session.cursor}:${quizPhase}`;
    if (lastSettled.current === key) return;
    if (recorded.current.has(session.cursor)) return;
    lastSettled.current = key;
    recorded.current.add(session.cursor);
    setSession((sess) =>
      sess
        ? {
            ...sess,
            results: [...sess.results, quizPhase === "won" ? "win" : "lose"],
          }
        : sess,
    );
  }, [quizPhase, quizMode, session]);

  function nextQuestion() {
    if (!session) return;
    const questions = loaded[session.tikuName];
    if (!questions) return;
    const nextCursor = session.cursor + 1;
    if (nextCursor >= session.indexes.length) {
      // 交卷出分
      const score = session.results.filter((r) => r === "win").length;
      const total = session.indexes.length;
      addTestRecord({ tiku: session.tikuName, score, total, at: Date.now() });
      setSession({ ...session, cursor: nextCursor });
      return;
    }
    const idx = session.indexes[nextCursor]!;
    setSession({ ...session, cursor: nextCursor });
    useQuiz.getState().loadQuestion("test", session.tikuName, idx, questions[idx]!);
  }

  function retryQuestion() {
    if (!session) return;
    const questions = loaded[session.tikuName];
    if (!questions) return;
    const idx = session.indexes[session.cursor]!;
    recorded.current.delete(session.cursor);
    setSession((sess) =>
      sess ? { ...sess, results: sess.results.slice(0, sess.cursor) } : sess,
    );
    lastSettled.current = "";
    useQuiz.getState().loadQuestion("test", session.tikuName, idx, questions[idx]!);
  }

  // 结果页
  if (session && session.cursor >= session.indexes.length) {
    const score = session.results.filter((r) => r === "win").length;
    const total = session.indexes.length;
    const pct = total > 0 ? Math.round((score / total) * 100) : 0;
    const durationMin = Math.max(1, Math.round((Date.now() - session.startedAt) / 60000));
    return (
      <div className="flex h-full items-center justify-center">
        <div className="w-96 rounded-xl border border-ink-700 bg-ink-900 p-8 text-center shadow-xl">
          <div className="text-sm text-ink-400">测试完成 · {session.tikuName}</div>
          <div className="mt-4 text-5xl font-bold text-verm-600">
            {score}
            <span className="text-2xl text-ink-400"> / {total}</span>
          </div>
          <div className="mt-2 text-sm text-ink-300">
            正确率 {pct}% · 用时约 {durationMin} 分钟
          </div>
          <div className="mt-3 text-xs text-ink-400">答错的题已自动收进错题本</div>
          <div className="mt-6 flex justify-center gap-3">
            <button
              onClick={() => setSession(null)}
              className="rounded-lg border border-ink-600 px-5 py-2 text-ink-200 hover:bg-ink-850"
            >
              返回
            </button>
            <button
              onClick={() => void startTest(session.tikuName, total)}
              className="rounded-lg bg-verm-600 px-5 py-2 font-medium text-white hover:opacity-90"
            >
              再测一次
            </button>
          </div>
        </div>
      </div>
    );
  }

  // 进行中
  if (session) {
    return (
      <DrillPanel
        headerLeft={
          <span className="font-medium text-verm-600">
            测试 {session.tikuName}
            <span className="ml-2 font-normal text-ink-400">
              {Math.min(session.cursor + 1, session.indexes.length)}/{session.indexes.length}
            </span>
          </span>
        }
        onNext={nextQuestion}
        nextLabel={session.cursor + 1 >= session.indexes.length ? "交卷" : "下一题"}
        showReveal={false}
        showUndo={false}
        showHint={false}
        extraAction={{ label: "重做本题", onClick: retryQuestion }}
        footerHint="测试不提供悔棋与答案，答完自动计分"
      />
    );
  }

  // 开始配置页
  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-ink-700 bg-ink-900 px-3 py-2 text-xs text-ink-400">
        从题库随机抽题作答，做完出分，错题自动进错题本
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        <div className="space-y-2">
          {tikus.map((t) => (
            <button
              key={t.name}
              onClick={() => void startTest(t.name, 10)}
              className="w-full rounded-xl border border-ink-700 bg-ink-900 px-4 py-3 text-left transition-colors hover:border-verm-500 hover:bg-ink-850"
            >
              <span className="text-sm text-ink-200">{t.name}</span>
              <span className="ml-2 text-xs text-ink-400">{t.count} 题 · 抽 10 题</span>
            </button>
          ))}
          {tikus.length === 0 && (
            <div className="rounded-xl border border-ink-700 bg-ink-900 px-4 py-6 text-center text-sm text-verm-600">
              题库加载失败或为空
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
