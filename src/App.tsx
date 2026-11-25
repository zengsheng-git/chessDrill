import { useEffect, useState } from "react";
import { useLibrary } from "./stores/libraryStore";
import { useSettings } from "./stores/settingsStore";
import PracticePage from "./components/practice/PracticePage";
import TestPage from "./components/test/TestPage";
import WrongBookPage from "./components/wrong/WrongBookPage";
import ReviewPage from "./components/review/ReviewPage";
import StatsPage from "./components/stats/StatsPage";
import SettingsPage from "./components/settings/SettingsPage";
import VideoPage from "./components/video/VideoPage";

type Tab = "practice" | "test" | "wrong" | "stats" | "settings";
/** 顶层模块: 杀招残局练习 / 棋谱复盘 / 视频工坊, null = 模块选择页 */
type Module = "drill" | "review" | "video";

const TABS: { key: Tab; label: string }[] = [
  { key: "practice", label: "练习" },
  { key: "test", label: "测试" },
  { key: "wrong", label: "错题" },
  { key: "stats", label: "统计" },
  { key: "settings", label: "设置" },
];

export default function App() {
  const [module, setModule] = useState<Module | null>(null);
  const uiScale = useSettings((s) => s.uiScale);

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
        {module === null && <HomeScreen onPick={setModule} />}
        {module === "drill" && <DrillModule onExit={() => setModule(null)} />}
        {module === "review" && <ReviewPage onExit={() => setModule(null)} />}
        {module === "video" && <VideoPage onExit={() => setModule(null)} />}
      </div>
    </div>
  );
}

/** 模块选择页: 先选模块, 再进各自内容 */
function HomeScreen({ onPick }: { onPick: (m: Module) => void }) {
  return (
    <div className="flex h-full flex-col items-center justify-center px-8">
      {/* 应用标识 */}
      <div className="flex flex-col items-center">
        <div
          className="flex h-16 w-16 items-center justify-center rounded-2xl bg-verm-600 text-3xl text-white shadow-lg shadow-verm-600/30"
          style={{ fontFamily: "var(--font-piece)" }}
        >
          棋
        </div>
        <h1
          className="mt-3 text-2xl font-bold tracking-[0.3em] text-ink-100"
          style={{ fontFamily: "var(--font-piece)" }}
        >
          象棋研习
        </h1>
        <p className="mt-1.5 text-[11px] tracking-[0.25em] text-ink-400">刷题练杀 · 复盘研棋</p>
      </div>

      {/* 模块卡片 */}
      <div className="mt-9 w-full space-y-3">
        <button
          onClick={() => onPick("drill")}
          className="group flex w-full items-center gap-3 rounded-xl border border-ink-600 bg-ink-800 p-3.5 text-left transition-all hover:-translate-y-0.5 hover:border-verm-500/60 hover:shadow-lg hover:shadow-verm-600/10 active:scale-[0.98]"
        >
          <span
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-verm-500/25 bg-verm-600/10 text-xl text-verm-600"
            style={{ fontFamily: "var(--font-piece)" }}
          >
            杀
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-[15px] font-semibold text-ink-100">杀招残局练习</span>
            <span className="mt-1.5 flex flex-wrap gap-1">
              {["连将杀", "残局攻防", "测试", "错题本"].map((t) => (
                <span key={t} className="rounded-full bg-ink-850 px-2 py-0.5 text-[10px] text-ink-400">
                  {t}
                </span>
              ))}
            </span>
          </span>
          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-ink-850 text-xs text-ink-400 transition-colors group-hover:bg-verm-600 group-hover:text-white">
            →
          </span>
        </button>

        <button
          onClick={() => onPick("review")}
          className="group flex w-full items-center gap-3 rounded-xl border border-ink-600 bg-ink-800 p-3.5 text-left transition-all hover:-translate-y-0.5 hover:border-gold-500/60 hover:shadow-lg hover:shadow-gold-500/10 active:scale-[0.98]"
        >
          <span
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-gold-500/25 bg-gold-500/10 text-xl text-gold-500"
            style={{ fontFamily: "var(--font-piece)" }}
          >
            谱
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-[15px] font-semibold text-ink-100">棋谱复盘</span>
            <span className="mt-1.5 flex flex-wrap gap-1">
              {["九千棋谱", "复盘台", "录制对局", "软件检测"].map((t) => (
                <span key={t} className="rounded-full bg-ink-850 px-2 py-0.5 text-[10px] text-ink-400">
                  {t}
                </span>
              ))}
            </span>
          </span>
          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-ink-850 text-xs text-ink-400 transition-colors group-hover:bg-gold-500 group-hover:text-white">
            →
          </span>
        </button>

        <button
          onClick={() => onPick("video")}
          className="group flex w-full items-center gap-3 rounded-xl border border-ink-600 bg-ink-800 p-3.5 text-left transition-all hover:-translate-y-0.5 hover:border-emerald-500/60 hover:shadow-lg hover:shadow-emerald-500/10 active:scale-[0.98]"
        >
          <span
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-emerald-500/25 bg-emerald-500/10 text-xl text-emerald-500"
            style={{ fontFamily: "var(--font-piece)" }}
          >
            影
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-[15px] font-semibold text-ink-100">视频工坊</span>
            <span className="mt-1.5 flex flex-wrap gap-1">
              {["竖版视频", "解说配音", "库管理"].map((t) => (
                <span key={t} className="rounded-full bg-ink-850 px-2 py-0.5 text-[10px] text-ink-400">
                  {t}
                </span>
              ))}
            </span>
          </span>
          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-ink-850 text-xs text-ink-400 transition-colors group-hover:bg-emerald-500 group-hover:text-white">
            →
          </span>
        </button>
      </div>

      <p className="mt-7 text-[10px] text-ink-400/60">进入模块后，点左上角 ← 可返回本页</p>
    </div>
  );
}

/** 杀招残局练习模块: 原"杀法练习"完整界面(五 Tab) */
function DrillModule({ onExit }: { onExit: () => void }) {
  const [tab, setTab] = useState<Tab>("practice");
  const loadTikus = useLibrary((s) => s.loadTikus);

  useEffect(() => {
    void loadTikus();
  }, [loadTikus]);

  return (
    <>
      {/* 顶部标题栏 */}
      <header className="flex items-center gap-2 border-b border-ink-700 bg-ink-900 px-3 py-2.5">
        <button
          onClick={onExit}
          title="返回模块选择"
          className="rounded-md px-1.5 py-0.5 text-sm leading-none text-ink-400 transition-colors hover:bg-ink-800 hover:text-ink-200"
        >
          ←
        </button>
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
    </>
  );
}
