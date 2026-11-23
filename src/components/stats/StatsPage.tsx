import { useMemo } from "react";
import { useLibrary } from "../../stores/libraryStore";
import { useProgress } from "../../stores/progressStore";

function fmtTime(at: number): string {
  const d = new Date(at);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

export default function StatsPage() {
  const { tikus, loaded } = useLibrary();
  const { byTiku, wrongBook, testHistory, drillsTotal, winsTotal } = useProgress();

  const acc = drillsTotal > 0 ? Math.round((winsTotal / drillsTotal) * 100) : 0;
  const wrongTotal = Object.values(wrongBook).reduce((n, l) => n + l.length, 0);

  const rows = useMemo(() => {
    return tikus
      .map((t) => {
        const total = loaded[t.name]?.length ?? t.count;
        const rec = byTiku[t.name] ?? {};
        let done = 0;
        let wins = 0;
        for (let i = 0; i < total; i++) {
          if (rec[i]) {
            done += 1;
            if (rec[i]!.r === "win") wins += 1;
          }
        }
        const pct = total > 0 ? Math.round((done / total) * 100) : 0;
        const acc = done > 0 ? Math.round((wins / done) * 100) : 0;
        return { name: t.name, total, done, pct, acc };
      })
      .filter((r) => r.done > 0);
  }, [tikus, loaded, byTiku]);

  return (
    <div className="h-full overflow-y-auto px-3 py-3">
      {/* 总览 */}
      <div className="grid grid-cols-2 gap-2">
        {[
          { label: "累计练习", value: `${drillsTotal} 题` },
          { label: "总正确率", value: `${acc}%` },
          { label: "错题待重刷", value: `${wrongTotal} 题` },
          { label: "模拟测试", value: `${testHistory.length} 次` },
        ].map((c) => (
          <div key={c.label} className="rounded-xl border border-ink-700 bg-ink-900 p-3">
            <div className="text-[11px] text-ink-400">{c.label}</div>
            <div className="mt-0.5 text-xl font-bold text-verm-600">{c.value}</div>
          </div>
        ))}
      </div>

      {/* 题库进度 */}
      <h3 className="mt-5 text-xs font-medium text-ink-400">题库进度</h3>
      <div className="mt-2 space-y-2">
        {rows.length === 0 && (
          <div className="rounded-xl border border-ink-700 bg-ink-900 px-4 py-5 text-center text-xs text-ink-400">
            开始练习后这里会显示各题库进度
          </div>
        )}
        {rows.map((r) => (
          <div key={r.name} className="rounded-xl border border-ink-700 bg-ink-900 px-3 py-2.5">
            <div className="flex items-center justify-between text-xs">
              <span className="min-w-0 truncate text-ink-200">{r.name}</span>
              <span className="ml-2 shrink-0 text-ink-400">
                {r.done}/{r.total} · 对 {r.acc}%
              </span>
            </div>
            <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-ink-700">
              <div className="h-full bg-gold-500" style={{ width: `${r.pct}%` }} />
            </div>
          </div>
        ))}
      </div>

      {/* 测试历史 */}
      <h3 className="mt-5 text-xs font-medium text-ink-400">模拟测试成绩</h3>
      <div className="mt-2 space-y-1.5">
        {testHistory.length === 0 ? (
          <div className="rounded-xl border border-ink-700 bg-ink-900 px-4 py-5 text-center text-xs text-ink-400">
            还没有测试记录
          </div>
        ) : (
          testHistory.slice(0, 20).map((t, i) => (
            <div
              key={i}
              className="flex items-center justify-between rounded-xl border border-ink-700 bg-ink-900 px-3 py-2 text-xs"
            >
              <div className="min-w-0">
                <div className="truncate text-ink-200">{t.tiku}</div>
                <div className="text-[11px] text-ink-400">{fmtTime(t.at)}</div>
              </div>
              <div className="ml-2 shrink-0 text-right">
                <span className="font-semibold text-verm-600">
                  {t.score}/{t.total}
                </span>
                <span className="ml-1 text-ink-400">
                  {t.total > 0 ? Math.round((t.score / t.total) * 100) : 0}%
                </span>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
