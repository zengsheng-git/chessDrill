import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { isTauriEnv } from "../../lib/ipc";
import { toPgn } from "../../lib/pgn/writer";
import { buildTiantianGame, type TiantianGame } from "../../lib/record/tiantian";
import { useGameStore } from "../../stores/gameStore";
import { useLibraryStore } from "../../stores/gameLibraryStore";

const BTN =
  "rounded-md border border-ink-600 bg-ink-800 px-3 py-1.5 text-sm text-ink-200 transition-colors hover:border-gold-500/60 hover:bg-ink-700 hover:text-gold-300 disabled:cursor-not-allowed disabled:opacity-35 disabled:hover:border-ink-600 disabled:hover:bg-ink-800 disabled:hover:text-ink-200";

type Phase = "input" | "fetching" | "ready" | "error";

export default function TiantianDialog({ onClose }: { onClose: () => void }) {
  const [link, setLink] = useState("");
  const [phase, setPhase] = useState<Phase>("input");
  const [error, setError] = useState<string | null>(null);
  const [fetched, setFetched] = useState<TiantianGame | null>(null);
  const [savedPath, setSavedPath] = useState<string | null>(null);

  const closable = phase !== "fetching";

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && closable) {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [closable, onClose]);

  // 保存成功提示数秒后自动消失
  useEffect(() => {
    if (!savedPath) return;
    const t = window.setTimeout(() => setSavedPath(null), 5000);
    return () => window.clearTimeout(t);
  }, [savedPath]);

  const fetchQipu = async () => {
    const url = link.trim();
    if (!url || phase === "fetching") return;
    setPhase("fetching");
    setError(null);
    setFetched(null);
    setSavedPath(null);
    try {
      if (!isTauriEnv()) throw new Error("导入功能仅支持桌面端使用");
      const qipu = await invoke<{ title: string; movelist: string }>("fetch_tiantian_qipu", {
        link: url,
      });
      try {
        setFetched(buildTiantianGame(qipu));
        setPhase("ready");
      } catch (e) {
        // 着法串非法多为非标准开局（残局等分享）
        throw new Error(
          `${e instanceof Error ? e.message : String(e)}——该分享不是标准开局对局，暂不支持导入`,
        );
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setPhase("error");
    }
  };

  const importToGame = () => {
    if (!fetched) return;
    const { game } = fetched;
    useGameStore.setState({
      game,
      fileName: game.info.title ?? "天天象棋对局",
      filePath: null,
      path: [],
      loading: false,
      error: null,
    });
    onClose();
  };

  const saveToLibrary = async () => {
    if (!fetched) return;
    try {
      const content = toPgn(fetched.game, fetched.game.startFen);
      const raw = (fetched.game.info.title ?? "天天象棋对局")
        .replace(/[\\/:*?"<>|]/g, " ")
        .trim();
      const root = useLibraryStore.getState().root;
      const path = await invoke<string>("save_pgn", {
        fileName: `${raw}.pgn`,
        content,
        initialDir: root,
      });
      void useLibraryStore.getState().revealTo(path);
      setSavedPath(path);
    } catch {
      // 用户取消保存等，不打断面板
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-ink-950/70"
      onClick={() => closable && onClose()}
    >
      <div
        className="flex max-h-[80vh] w-[min(460px,calc(100vw-24px))] flex-col rounded-xl border border-gold-500/40 bg-ink-900 p-4 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-center justify-between">
          <span className="text-sm font-bold text-gold-300">导入天天象棋棋谱</span>
          {closable && (
            <button
              onClick={onClose}
              title="关闭（Esc）"
              className="rounded px-1.5 py-0.5 text-ink-400 transition-colors hover:bg-ink-800 hover:text-ink-200"
            >
              ✕
            </button>
          )}
        </div>

        {phase === "ready" && fetched ? (
          <>
            <div className="rounded-md border border-gold-500/30 bg-ink-800 px-3 py-2.5">
              <p className="break-all text-sm font-medium text-ink-100">
                {fetched.game.info.title}
              </p>
              <p className="mt-1 text-xs text-ink-400">
                红方 {fetched.red} · 黑方 {fetched.black} · 结果{" "}
                {fetched.game.info.result} · {fetched.game.moveCount} 着
              </p>
            </div>

            <div className="mt-3 flex items-center gap-2">
              <span
                className="min-w-0 flex-1 truncate text-xs text-gold-300"
                title={savedPath ?? undefined}
              >
                {savedPath ? `已保存到 ${savedPath}` : ""}
              </span>
              <button
                onClick={() => {
                  setPhase("input");
                  setFetched(null);
                }}
                className={BTN}
                title="重新粘贴另一个分享链接"
              >
                换一个链接
              </button>
              <button onClick={() => void saveToLibrary()} className={BTN} title="弹出另存为对话框，默认定位棋谱库目录">
                保存到棋谱库
              </button>
              <button
                onClick={importToGame}
                className={`${BTN} border-gold-500/50 text-gold-300`}
                title="载入主界面复盘"
              >
                导入复盘台
              </button>
            </div>
          </>
        ) : (
          <>
            {error && (
              <div className="mb-2 break-all rounded-md border border-verm-500/50 bg-verm-500/10 px-3 py-2 text-sm leading-relaxed text-verm-400">
                {error}
              </div>
            )}

            <textarea
              value={link}
              onChange={(e) => setLink(e.target.value)}
              rows={4}
              placeholder="粘贴天天象棋分享链接（https://speed.gamecenter.qq.com/…）"
              className="w-full resize-none rounded-md border border-ink-600 bg-ink-800 px-2.5 py-2 text-sm text-ink-200 outline-none placeholder:text-ink-400/70 focus:border-gold-500/60"
            />
            <p className="mt-1.5 text-xs leading-relaxed text-ink-400">
              手机天天象棋里分享对局到 QQ「我的电脑」，电脑 QQ 上右键复制链接后粘贴到这里。
              拉谱服务由爱棋谱·秀棋谱提供。
            </p>

            <div className="mt-3 flex justify-end">
              <button
                onClick={() => void fetchQipu()}
                disabled={!link.trim() || phase === "fetching"}
                className={`${BTN} border-gold-500/50 text-gold-300`}
                title="请求拉谱服务还原棋谱"
              >
                {phase === "fetching" ? "正在拉取…" : "获取棋谱"}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
