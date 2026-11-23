import { create } from "zustand";
import { persist } from "zustand/middleware";
import { setSoundEnabled } from "../lib/audio";

const SCALE_MIN = 0.7;
const SCALE_MAX = 1.5;
export const SCALE_STEP = 0.1;

interface SettingsState {
  sound: boolean;
  autoNext: boolean;
  /** 界面缩放(摸鱼时 Ctrl+滚轮 可调) */
  uiScale: number;
  toggleSound: () => void;
  toggleAutoNext: () => void;
  setScale: (v: number) => void;
  /** Ctrl+滚轮 逐步缩放 */
  nudgeScale: (dir: 1 | -1) => void;
}

export function clampScale(v: number): number {
  return Math.round(Math.min(SCALE_MAX, Math.max(SCALE_MIN, v)) * 100) / 100;
}

export const useSettings = create<SettingsState>()(
  persist(
    (set, get) => ({
      sound: true,
      autoNext: true,
      uiScale: 1,
      toggleSound: () => {
        set({ sound: !get().sound });
        setSoundEnabled(get().sound);
      },
      toggleAutoNext: () => set({ autoNext: !get().autoNext }),
      setScale: (v) => set({ uiScale: clampScale(v) }),
      nudgeScale: (dir) => set({ uiScale: clampScale(get().uiScale + dir * SCALE_STEP) }),
    }),
    {
      name: "chessdrill-settings",
      onRehydrateStorage: () => (state) => {
        if (state) setSoundEnabled(state.sound);
      },
    },
  ),
);
