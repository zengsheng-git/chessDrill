import { create } from "zustand";
import { listTiku, readTiku, type TikuMeta } from "../lib/ipc";
import type { Question } from "../lib/tiku";

interface LibraryState {
  tikus: TikuMeta[];
  tikusError: string | null;
  /** 已加载的题目集缓存 */
  loaded: Record<string, Question[]>;
  loading: string | null;

  loadTikus: () => Promise<void>;
  loadQuestions: (name: string) => Promise<Question[]>;
}

export const useLibrary = create<LibraryState>()((set, get) => ({
  tikus: [],
  tikusError: null,
  loaded: {},
  loading: null,

  loadTikus: async () => {
    try {
      const tikus = await listTiku();
      set({ tikus, tikusError: tikus.length ? null : "未找到内置题库" });
    } catch (e) {
      set({ tikusError: String(e) });
    }
  },

  loadQuestions: async (name) => {
    const cached = get().loaded[name];
    if (cached) return cached;
    set({ loading: name });
    try {
      const dtos = await readTiku(name);
      const questions: Question[] = dtos.map((d) => ({
        fen: d.fen,
        title: d.title,
        flipped: d.flipped,
      }));
      set({ loaded: { ...get().loaded, [name]: questions }, loading: null });
      return questions;
    } catch (e) {
      set({ loading: null });
      throw e;
    }
  },
}));
