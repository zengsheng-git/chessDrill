import { useEffect } from "react";
import type { BranchConfig, BranchPointInfo } from "../../lib/video/types";

const DEFAULT_LEN = 2; // 演示手数缺省值

/** 变招勾选浮层: 每个分歧点勾选备选进视频(按变招线真实走子), 并可选演示手数; 解说词在逐手表格里自定义 */
export default function BranchPicker({
  branchPoints,
  config,
  onChange,
  onClose,
}: {
  branchPoints: BranchPointInfo[];
  config: BranchConfig;
  onChange: (config: BranchConfig) => void;
  onClose: () => void;
}) {
  // Esc 关闭(优先于外层对话框)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onClose]);

  const toggle = (moveIndex: number, iccs: string) => {
    const cur = config.picks[moveIndex] ?? [];
    const next = cur.includes(iccs) ? cur.filter((s) => s !== iccs) : [...cur, iccs];
    onChange({ ...config, picks: { ...config.picks, [moveIndex]: next } });
  };

  const setLineLen = (moveIndex: number, len: number) => {
    onChange({ ...config, lineLens: { ...config.lineLens, [moveIndex]: len } });
  };

  const lenOf = (moveIndex: number, altLineLen: number) => {
    const v = config.lineLens[moveIndex];
    if (v === undefined) return Math.min(DEFAULT_LEN, altLineLen);
    return v === 0 ? altLineLen : Math.min(v, altLineLen);
  };

  const totalPicked = Object.values(config.picks).reduce((n, list) => n + list.length, 0);

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-ink-950/70"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="flex max-h-[86vh] w-[min(460px,calc(100vw-24px))] flex-col gap-2.5 rounded-xl border border-gold-500/40 bg-ink-900 p-3.5 shadow-2xl">
        <div className="flex shrink-0 items-center justify-between">
          <span className="text-sm font-bold text-gold-300">
            变招选择
            <span className="ml-2 text-xs font-normal text-ink-400">
              已选 {totalPicked} 个 · 先预览再逐个真实走子
            </span>
          </span>
          <button
            onClick={onClose}
            title="完成并关闭（Esc）"
            className="rounded px-1.5 py-0.5 text-ink-400 transition-colors hover:bg-ink-800 hover:text-ink-200"
          >
            ✕
          </button>
        </div>

        <div className="shrink-0 text-[11px] text-ink-400">
          勾选后到逐手解说词表格里自定义各变招的解说词（留空用自动模板）
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto rounded-lg border border-ink-600">
          {branchPoints.map((bp) => {
            const picked = config.picks[bp.moveIndex] ?? [];
            const maxLine = Math.max(...bp.alternatives.map((a) => a.line.length), 1);
            const len = lenOf(bp.moveIndex, maxLine);
            return (
              <div key={bp.moveIndex} className="border-b border-ink-700 px-3 py-2 last:border-b-0">
                <div className="mb-1.5 flex items-center justify-between gap-2 text-[11px]">
                  <span className="min-w-0 truncate text-ink-300">
                    第 {bp.moveIndex + 1} 手之前 · 主线 <span className="text-gold-300">{bp.mainline.notation}</span>
                    <span className="ml-1.5 text-ink-400">另有 {bp.alternatives.length} 个变招</span>
                  </span>
                  <span className="shrink-0 text-ink-400">
                    走{" "}
                    <select
                      value={config.lineLens[bp.moveIndex] ?? Math.min(DEFAULT_LEN, maxLine)}
                      onChange={(e) => setLineLen(bp.moveIndex, Number(e.target.value))}
                      className="rounded border border-ink-600 bg-ink-850 px-1 py-0.5 text-[11px] text-ink-200 outline-none"
                    >
                      {[1, 2, 3, 4].map((n) => (
                        <option key={n} value={n} disabled={n > maxLine}>
                          {Math.min(n, maxLine)} 手
                        </option>
                      ))}
                      <option value={0}>全部</option>
                    </select>
                  </span>
                </div>
                <div className="flex flex-col gap-1">
                  {bp.alternatives.map((alt) => {
                    const checked = picked.includes(alt.iccs);
                    const preview = alt.line.slice(0, len).map((m) => m.notation).join(" → ");
                    return (
                      <label
                        key={alt.iccs}
                        className="flex cursor-pointer items-center gap-2 rounded-md border border-ink-700 bg-ink-850 px-2 py-1.5 text-[12px] transition-colors hover:border-ink-600"
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => toggle(bp.moveIndex, alt.iccs)}
                          className="accent-emerald-600"
                        />
                        <span className={`min-w-0 flex-1 truncate ${checked ? "text-ink-100" : "text-ink-300"}`}>
                          {preview}
                        </span>
                        <span className="shrink-0 text-[10px] text-ink-400">{alt.line.length} 手</span>
                      </label>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>

        <div className="flex shrink-0 gap-2">
          <button
            onClick={() => onChange({ picks: {}, lineLens: {}, altComments: {}, previewComments: {} })}
            className="flex-1 rounded-lg border border-ink-600 bg-ink-800 px-3 py-1.5 text-sm text-ink-200 hover:bg-ink-850"
          >
            全不选
          </button>
          <button
            onClick={onClose}
            className="flex-[2] rounded-lg bg-gold-500 px-4 py-1.5 text-sm font-medium text-white hover:opacity-90"
          >
            完成
          </button>
        </div>
      </div>
    </div>
  );
}
