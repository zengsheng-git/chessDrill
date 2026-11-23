import { useEffect, useState } from "react";
import { useLibrary } from "./stores/libraryStore";
import { useSettings } from "./stores/settingsStore";
import PracticePage from "./components/practice/PracticePage";
import TestPage from "./components/test/TestPage";
import WrongBookPage from "./components/wrong/WrongBookPage";
import StatsPage from "./components/stats/StatsPage";
import SettingsPage from "./components/settings/SettingsPage";

type Tab = "practice" | "test" | "wrong" | "stats" | "settings";

const TABS: { key: Tab; label: string }[] = [
  { key: "practice", label: "练习" },
  { key: "test", label: "测试" },
  { key: "wrong", label: "错题" },
  { key: "stats", label: "统计" },
  { key: "settings", label: "设置" },
];

export default function App() {
  const [tab, setTab] = useState<Tab>("practice");
  const loadTikus = useLibrary((s) => s.loadTikus);
  const uiScale = useSettings((s) => s.uiScale);

  useEffect(() => {
    void loadTikus();
  }, [loadTikus]);

  // Ctrl+滚轮 缩放界面(摸鱼友好: 窗口不动, 内容可放大缩小)
  useEffect(() => {
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey) return;
      e.preventDefault();
      useSettings.getState().nudgeScale(e.deltaY < 0 ? 1 : -1);
    };
    window.addEventListener("wheel", onWheel, { passive: false });
    return () => window.removeEventListener("wheel", onWheel);
  }, []);

  return (
    <div className="flex h-full justify-center bg-ink-950">
      <div
        className="flex h-full w-full max-w-[470px] flex-col overflow-hidden bg-ink-900 shadow-2xl"
        style={{ zoom: uiScale }}
      >
        {/* 顶部标题栏 */}
        <header className="flex items-center gap-2 border-b border-ink-700 bg-ink-900 px-4 py-2.5">
          <span className="text-base font-bold tracking-widest text-verm-600" style={{ fontFamily: "var(--font-piece)" }}>
            杀法练习
          </span>
          <span className="text-xs text-ink-400">{TABS.find((t) => t.key === tab)?.label}</span>
        </header>

        {/* 内容区 */}
        <main className="min-h-0 flex-1 overflow-hidden">
          {tab === "practice" && <PracticePage />}
          {tab === "test" && <TestPage />}
          {tab === "wrong" && <WrongBookPage />}
          {tab === "stats" && <StatsPage />}
          {tab === "settings" && <SettingsPage />}
        </main>

        {/* 底部 tab 导航(手机样式) */}
        <nav className="grid shrink-0 grid-cols-5 border-t border-ink-700 bg-ink-900">
          {TABS.map((t) => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`py-2.5 text-center text-[13px] transition-colors ${
                tab === t.key
                  ? "font-semibold text-verm-600"
                  : "text-ink-400 hover:text-ink-200"
              }`}
            >
              <span className={`mx-auto mb-0.5 block h-0.5 w-6 rounded-full ${tab === t.key ? "bg-verm-500" : "bg-transparent"}`} />
              {t.label}
            </button>
          ))}
        </nav>
      </div>
    </div>
  );
}
