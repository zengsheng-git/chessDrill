import { useEffect, useRef, useState } from "react";
import { recognizeImage, type Recognition } from "../../lib/video/api";

const BTN =
  "rounded-md border border-ink-600 bg-ink-800 px-3 py-1.5 text-sm text-ink-200 transition-colors hover:border-gold-500/60 hover:bg-ink-700 hover:text-gold-300 disabled:cursor-not-allowed disabled:opacity-35 disabled:hover:border-ink-600 disabled:hover:bg-ink-800 disabled:hover:text-ink-200";
const INPUT =
  "w-full rounded-lg border border-ink-600 bg-ink-850 px-2 py-1.5 text-xs text-ink-200 outline-none focus:border-gold-500/60";

type Phase = "pick" | "working" | "result";

/** 截图识别解说: 粘贴/上传象棋截图 → 识别局面 → 确认先行方 → 交给视频导出流程 */
export default function ScreenshotDialog({
  onClose,
  onExport,
}: {
  onClose: () => void;
  /** 确认后回调: 用户选定行棋方后的 FEN 与标题 */
  onExport: (fen: string, title: string) => void;
}) {
  const [phase, setPhase] = useState<Phase>("pick");
  const [error, setError] = useState<string | null>(null);
  const [rec, setRec] = useState<Recognition | null>(null);
  const [side, setSide] = useState<"red" | "black">("red");
  const [title, setTitle] = useState("象棋局面解说");
  const [dragging, setDragging] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const recognize = (bytes: Uint8Array) => {
    setError(null);
    setRec(null);
    setPhase("working");
    recognizeImage(bytes)
      .then((r) => {
        setRec(r);
        setSide("red");
        setPhase("result");
      })
      .catch((e) => {
        setError(e instanceof Error ? e.message : String(e));
        setPhase("pick");
      });
  };

  const readBlob = (blob: Blob) => {
    void blob
      .arrayBuffer()
      .then((buf) => recognize(new Uint8Array(buf)))
      .catch(() => setError("读取图片失败"));
  };

  // 剪贴板粘贴图片(对话框存活期间)
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      for (const item of e.clipboardData?.items ?? []) {
        if (item.type.startsWith("image/")) {
          const file = item.getAsFile();
          if (file) {
            e.preventDefault();
            readBlob(file);
            return;
          }
        }
      }
    };
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  }, []);

  // Esc 关闭
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

  const startExport = () => {
    if (!rec) return;
    // 识别 FEN 固定红方先行, 按用户选择改行棋方字段
    const parts = rec.fen.split(" ");
    parts[1] = side === "black" ? "b" : "w";
    onExport(parts.join(" "), title.trim() || "象棋局面解说");
  };

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-ink-950/70"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      onDragOver={(e) => {
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragging(false);
        const file = e.dataTransfer.files?.[0];
        if (file && file.type.startsWith("image/")) readBlob(file);
      }}
    >
      <div
        className={`flex max-h-[86vh] w-[min(460px,calc(100vw-24px))] flex-col gap-2.5 rounded-xl border bg-ink-900 p-3.5 shadow-2xl transition-colors ${
          dragging ? "border-gold-500" : "border-gold-500/40"
        }`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex shrink-0 items-center justify-between">
          <span className="text-sm font-bold text-gold-300">截图识别 · 解说视频</span>
          <button
            onClick={onClose}
            title="关闭（Esc）"
            className="rounded px-1.5 py-0.5 text-ink-400 transition-colors hover:bg-ink-800 hover:text-ink-200"
          >
            ✕
          </button>
        </div>

        {error && (
          <div className="shrink-0 rounded-lg border border-verm-600/40 bg-verm-600/10 px-3 py-2 text-xs text-verm-600">
            {error}
          </div>
        )}

        <div className="min-h-0 flex-1 overflow-y-auto pr-0.5">
          {phase === "pick" && (
            <div className="flex flex-col gap-2.5 py-4 text-xs">
              <div className="text-center text-[11px] leading-5 text-ink-400">
                用截图工具(微信截图 / Win+Shift+S)截下棋盘
                <br />
                然后 <span className="text-ink-200">Ctrl+V 粘贴</span> 到这里，或拖拽 / 选择图片
              </div>
              <button onClick={() => fileRef.current?.click()} className={`${BTN} mx-auto`}>
                选择图片…
              </button>
              <input
                ref={fileRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) readBlob(file);
                  e.target.value = "";
                }}
              />
            </div>
          )}

          {phase === "working" && (
            <div className="py-10 text-center text-sm text-ink-400">
              <span className="animate-pulse">正在识别局面…</span>
            </div>
          )}

          {phase === "result" && rec && (
            <div className="flex flex-col gap-2.5 text-xs">
              {rec.preview_base64 && (
                <img
                  src={`data:image/png;base64,${rec.preview_base64}`}
                  alt="识别区域预览"
                  className="mx-auto max-h-[36vh] rounded-lg border border-ink-600"
                />
              )}
              <div className="text-[11px] text-ink-400">
                识别到 <span className="text-ink-200">{rec.pieces_count}</span> 枚棋子
                {!rec.legal && <span className="ml-1 text-verm-600">布局未通过合法性校验</span>}
              </div>
              {rec.issues.map((s) => (
                <div key={s} className="rounded-lg border border-gold-500/40 bg-gold-500/10 px-2.5 py-1.5 text-[11px] text-gold-300">
                  {s}
                </div>
              ))}

              <label className="flex flex-col gap-1">
                <span className="text-ink-300">行棋方</span>
                <select
                  value={side}
                  onChange={(e) => setSide(e.target.value as "red" | "black")}
                  className={INPUT}
                >
                  <option value="red">红方先行</option>
                  <option value="black">黑方先行</option>
                </select>
              </label>

              <label className="flex flex-col gap-1">
                <span className="text-ink-300">标题（画面顶部）</span>
                <input value={title} onChange={(e) => setTitle(e.target.value)} className={INPUT} maxLength={40} />
              </label>

              <div className="text-[10px] leading-4 text-ink-400">
                确认后将由引擎求解参考线并打开导出对话框，可继续编辑解说词与标注。
              </div>
            </div>
          )}
        </div>

        <div className="flex shrink-0 gap-2">
          {phase === "result" ? (
            <>
              <button onClick={() => setPhase("pick")} className={`${BTN} flex-1`}>
                重选截图
              </button>
              <button
                onClick={startExport}
                className="flex-[2] rounded-lg bg-gold-500 px-4 py-1.5 text-sm font-medium text-white hover:opacity-90"
              >
                生成解说视频
              </button>
            </>
          ) : (
            <button onClick={onClose} className={`${BTN} flex-1`}>
              取消
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
