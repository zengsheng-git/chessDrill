import { create } from "zustand";
import { persist } from "zustand/middleware";

export type DrillResult = "win" | "lose";

interface QRecord {
  /** 最近一次结果 */
  r: DrillResult;
  /** 最近练习时间戳 */
  t: number;
}

export interface TestRecord {
  tiku: string;
  score: number;
  total: number;
  at: number;
}

interface ProgressState {
  /** 题库 -> 题目序号 -> 记录 */
  byTiku: Record<string, Record<number, QRecord>>;
  /** 错题本: 题库 -> 题目序号列表(按加入顺序) */
  wrongBook: Record<string, number[]>;
  testHistory: TestRecord[];
  drillsTotal: number;
  winsTotal: number;

  recordResult: (tiku: string, index: number, r: DrillResult) => void;
  removeFromWrong: (tiku: string, index: number) => void;
  addTestRecord: (rec: TestRecord) => void;
  clearWrongBook: (tiku: string) => void;
  resetTiku: (tiku: string) => void;
}

export const useProgress = create<ProgressState>()(
  persist(
    (set, get) => ({
      byTiku: {},
      wrongBook: {},
      testHistory: [],
      drillsTotal: 0,
      winsTotal: 0,

      recordResult: (tiku, index, r) => {
        const state = get();
        const tikuRec = { ...(state.byTiku[tiku] ?? {}) };
        tikuRec[index] = { r, t: Date.now() };

        const wrong = [...(state.wrongBook[tiku] ?? [])];
        const wrongSet = new Set(wrong);
        if (r === "lose") {
          if (!wrongSet.has(index)) wrong.push(index);
        } else if (wrongSet.has(index)) {
          // 答对自动移出错题本
          const i = wrong.indexOf(index);
          wrong.splice(i, 1);
        }

        set({
          byTiku: { ...state.byTiku, [tiku]: tikuRec },
          wrongBook: { ...state.wrongBook, [tiku]: wrong },
          drillsTotal: state.drillsTotal + 1,
          winsTotal: state.winsTotal + (r === "win" ? 1 : 0),
        });
      },

      removeFromWrong: (tiku, index) => {
        const state = get();
        const wrong = [...(state.wrongBook[tiku] ?? [])];
        const i = wrong.indexOf(index);
        if (i >= 0) wrong.splice(i, 1);
        set({ wrongBook: { ...state.wrongBook, [tiku]: wrong } });
      },

      addTestRecord: (rec) => {
        set({ testHistory: [rec, ...get().testHistory].slice(0, 100) });
      },

      clearWrongBook: (tiku) => {
        set({ wrongBook: { ...get().wrongBook, [tiku]: [] } });
      },

      resetTiku: (tiku) => {
        const state = get();
        const byTiku = { ...state.byTiku };
        delete byTiku[tiku];
        set({ byTiku, wrongBook: { ...state.wrongBook, [tiku]: [] } });
      },
    }),
    { name: "chessdrill-progress" },
  ),
);

/// 统计某题库的进度
export function tikuStats(byTiku: ProgressState["byTiku"], tiku: string, total: number) {
  const rec = byTiku[tiku] ?? {};
  let done = 0;
  let wins = 0;
  for (const k of Object.keys(rec)) {
    const i = Number(k);
    if (i >= 0 && i < total) {
      done += 1;
      if (rec[i]!.r === "win") wins += 1;
    }
  }
  return { done, wins, wrong: 0 };
}
