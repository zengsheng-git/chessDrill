import { Fragment, useEffect, useState } from "react";
import { convertFileSrc } from "@tauri-apps/api/core";
import AnnotationEditor from "./AnnotationEditor";
import BranchPicker from "./BranchPicker";
import { VOICES } from "../../lib/video/types";
import type { BranchConfig, VideoAnnotation, VideoOutcome, VideoProgress, VideoSourceLoader } from "../../lib/video/types";
import {
  generateVideo,
  listenVideoDone,
  listenVideoError,
  listenVideoProgress,
  revealVideo,
  saveVideoAs,
  stopVideoGeneration,
} from "../../lib/video/api";

type Phase = "loading" | "edit" | "working" | "done";
type VoiceMode = "off" | "auto" | "custom";

const BTN =
  "rounded-md border border-ink-600 bg-ink-800 px-3 py-1.5 text-sm text-ink-200 transition-colors hover:border-gold-500/60 hover:bg-ink-700 hover:text-gold-300 disabled:cursor-not-allowed disabled:opacity-35 disabled:hover:border-ink-600 disabled:hover:bg-ink-800 disabled:hover:text-ink-200";
const INPUT =
  "w-full rounded-lg border border-ink-600 bg-ink-850 px-2 py-1.5 text-xs text-ink-200 outline-none focus:border-gold-500/60";

function fmtSize(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

export default function VideoExportDialog({
  loadSource,
  onClose,
}: {
  loadSource: VideoSourceLoader;
  onClose: () => void;
}) {
  const [phase, setPhase] = useState<Phase>("loading");
  const [loadError, setLoadError] = useState<string | null>(null);
  const [source, setSource] = useState<Awaited<ReturnType<VideoSourceLoader>> | null>(null);

  // 导出参数
  const [title, setTitle] = useState("");
  const [subtitle, setSubtitle] = useState("");
  const [voiceMode, setVoiceMode] = useState<VoiceMode>("auto");
  const [narrations, setNarrations] = useState<string[]>([]);
  const [annotations, setAnnotations] = useState<VideoAnnotation[][]>([]);
  /** 当前标注编辑目标: altIccs/k 为空 = 主线手, 否则 = 变招线第 k 手 */
  const [editingTarget, setEditingTarget] = useState<{
    moveIdx: number;
    altIccs: string | null;
    k: number;
  } | null>(null);
  /** 变招逐手标注: key = `${moveIdx}:${altIccs}:${k}` */
  const [branchAnnotations, setBranchAnnotations] = useState<Record<string, VideoAnnotation[]>>({});
  /** 变招配置: 勾选 + 演示手数 + 自定义解说词 */
  const [branchConfig, setBranchConfig] = useState<BranchConfig>({
    picks: {},
    lineLens: {},
    altComments: {},
    previewComments: {},
  });
  const [branchPickerOpen, setBranchPickerOpen] = useState(false);
  const [introText, setIntroText] = useState("");
  const [outroText, setOutroText] = useState("");
  const [voice, setVoice] = useState<string>(VOICES[0].value);
  const [rate, setRate] = useState(0);

  // 生成状态
  const [progress, setProgress] = useState<VideoProgress | null>(null);
  const [outcome, setOutcome] = useState<VideoOutcome | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const closable = phase === "edit" || phase === "loading" || phase === "done";

  // 打开时拉取走子数据并初始化表单
  useEffect(() => {
    let alive = true;
    loadSource()
      .then((src) => {
        if (!alive) return;
        setSource(src);
        setTitle(src.title);
        setSubtitle(src.subtitle);
        setNarrations(src.moves.map((m) => `${m.side === "red" ? "红方" : "黑方"}${m.notation}`));
        setAnnotations(src.moves.map(() => []));
        setIntroText(`${src.title}，我们一起来看这局棋。`);
        setOutroText(src.endsMate ? "绝杀，本局结束，感谢观看。" : "本局演示结束，感谢观看。");
        setPhase("edit");
      })
      .catch((e) => {
        if (!alive) return;
        setLoadError(e instanceof Error ? e.message : String(e));
        setPhase("edit");
      });
    return () => {
      alive = false;
    };
  }, [loadSource]);

  // video://* 事件(对话框存活期间)
  useEffect(() => {
    const offs: Promise<() => void>[] = [
      listenVideoProgress((p) => setProgress(p)),
      listenVideoDone((o) => {
        setOutcome(o);
        setPhase("done");
      }),
      listenVideoError((msg) => {
        if (msg === "已取消") {
          // 用户主动取消: 静默回编辑态
          setPhase("edit");
          setProgress(null);
          return;
        }
        setError(msg);
        setPhase("edit");
      }),
    ];
    return () => {
      for (const off of offs) void off.then((f) => f());
    };
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // 标注编辑浮层打开期间, Esc 由浮层自己处理(捕获阶段)
      if (editingTarget !== null) return;
      if (e.key === "Escape" && closable) {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [closable, onClose, editingTarget]);

  const start = () => {
    if (!source) return;
    setError(null);
    setOutcome(null);
    setProgress({ stage: "prepare", current: 0, total: 0, message: "正在启动..." });
    setPhase("working");
    const auto =
      voiceMode === "off"
        ? []
        : voiceMode === "auto"
          ? source.moves.map((m) => `${m.side === "red" ? "红方" : "黑方"}${m.notation}`)
          : narrations;
    void generateVideo({
      title: title.trim() || source.title,
      subtitle: subtitle.trim(),
      moves: source.moves.map((m, i) => {
        const bp = source.branchPoints.find((p) => p.moveIndex === i);
        const picked = bp ? (branchConfig.picks[i] ?? []) : [];
        const maxLine = bp ? Math.max(...bp.alternatives.map((a) => a.line.length), 1) : 1;
        const rawLen = branchConfig.lineLens[i];
        const len = rawLen === undefined ? Math.min(2, maxLine) : rawLen === 0 ? maxLine : Math.min(rawLen, maxLine);
        const branches =
          bp && picked.length > 0
            ? bp.alternatives
                .filter((a) => picked.includes(a.iccs))
                .map((a) => ({
                  moves: a.line.slice(0, len),
                  comments: a.line.slice(0, len).map((_, k) => branchConfig.altComments[`${i}:${a.iccs}:${k}`] ?? ""),
                  annotations: a.line.slice(0, len).map((_, k) => branchAnnotations[`${i}:${a.iccs}:${k}`] ?? []),
                }))
            : [];
        return {
          ...m,
          annotations: annotations[i] ?? [],
          branches,
          branch_preview_comment: branches.length > 0 ? (branchConfig.previewComments[i] ?? "") : "",
        };
      }),
      narration: auto,
      intro_narration: voiceMode === "off" ? "" : introText.trim(),
      outro_narration: voiceMode === "off" ? "" : outroText.trim(),
      voice,
      rate,
      voice_enabled: voiceMode !== "off",
      ends_mate: source.endsMate,
    }).catch((e) => {
      // 启动失败(如单任务占用/ffmpeg 缺失): 回编辑态提示
      setError(e instanceof Error ? e.message : String(e));
      setPhase("edit");
    });
  };

  const cancel = () => {
    void stopVideoGeneration();
  };

  const saveAs = () => {
    if (!outcome) return;
    setSaving(true);
    const name = `${title.trim() || "象棋视频"}.mp4`.replace(/[\\/:*?"<>|]/g, " ");
    saveVideoAs(outcome.video_path, name)
      .catch(() => undefined) // 取消保存不打断
      .finally(() => setSaving(false));
  };

  const total = source?.moves.length ?? 0;
  const percent =
    progress && progress.total > 0
      ? Math.min(100, Math.round((progress.current / progress.total) * 100))
      : 0;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-ink-950/70"
      onClick={(e) => {
        // 仅点击遮罩空白关闭; 子浮层(标注/变招勾选)内部的点击不冒泡误关
        if (e.target === e.currentTarget && closable) onClose();
      }}
    >
      <div
        className="flex max-h-[86vh] w-[min(460px,calc(100vw-24px))] flex-col rounded-xl border border-gold-500/40 bg-ink-900 p-4 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex shrink-0 items-center justify-between">
          <span className="text-sm font-bold text-gold-300">导出竖版视频</span>
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

        <div className="min-h-0 flex-1 overflow-y-auto pr-0.5">
          {phase === "loading" && (
            <div className="py-10 text-center text-sm text-ink-400">
              <span className="animate-pulse">正在推演走子序列…</span>
            </div>
          )}

          {loadError && phase !== "working" && phase !== "done" && (
            <div className="mb-3 rounded-lg border border-verm-600/40 bg-verm-600/10 px-3 py-2 text-xs text-verm-600">
              {loadError}
            </div>
          )}

          {error && phase === "edit" && (
            <div className="mb-3 rounded-lg border border-verm-600/40 bg-verm-600/10 px-3 py-2 text-xs text-verm-600">
              {error}
            </div>
          )}

          {/* ---------- 编辑态 ---------- */}
          {phase === "edit" && source && !loadError && (
            <div className="flex flex-col gap-3 text-xs">
              <div className="flex items-center justify-between gap-2 text-ink-400">
                <span>
                  共 {total} 手
                  {source.branchPoints.length > 0 && (
                    <span className="ml-1 text-ink-400">· {source.branchPoints.length} 处变招</span>
                  )}
                  <span className="ml-1">· 竖版 1080×1920</span>
                </span>
                <span className="flex shrink-0 items-center gap-1">
                  {source.branchPoints.length > 0 && (
                    <button
                      onClick={() => setBranchPickerOpen(true)}
                      title="选择哪些变招进视频(演示时先预览再逐个真实走子), 可自定义解说词"
                      className={`rounded border px-1.5 py-0.5 text-[10px] transition-colors ${
                        Object.values(branchConfig.picks).some((l) => l.length > 0)
                          ? "border-emerald-600/60 bg-emerald-600/10 text-emerald-700"
                          : "border-ink-600 bg-ink-850 text-ink-300 hover:bg-ink-800"
                      }`}
                    >
                      ⑂ 变招
                      {Object.values(branchConfig.picks).some((l) => l.length > 0)
                        ? ` ${Object.values(branchConfig.picks).reduce((n, l) => n + l.length, 0)}`
                        : ""}
                    </button>
                  )}
                  <button
                    onClick={() => setEditingTarget({ moveIdx: 0, altIccs: null, k: -1 })}
                    title="在第 1 手开始添加棋盘标注（圈注/箭头）"
                    className={`shrink-0 rounded border px-1.5 py-0.5 text-[10px] transition-colors ${
                      annotations.some((a) => a.length > 0)
                        ? "border-emerald-600/60 bg-emerald-600/10 text-emerald-700"
                        : "border-ink-600 bg-ink-850 text-ink-300 hover:bg-ink-800"
                    }`}
                  >
                    📌 棋盘标注{annotations.some((a) => a.length > 0) ? ` ${annotations.flat().length}` : ""}
                  </button>
                </span>
              </div>

              <label className="flex flex-col gap-1">
                <span className="text-ink-300">标题（画面顶部）</span>
                <input value={title} onChange={(e) => setTitle(e.target.value)} className={INPUT} maxLength={40} />
              </label>

              <label className="flex flex-col gap-1">
                <span className="text-ink-300">副标题（可选）</span>
                <input
                  value={subtitle}
                  onChange={(e) => setSubtitle(e.target.value)}
                  placeholder="如：红：张三 · 黑：李四"
                  className={INPUT}
                  maxLength={40}
                />
              </label>

              <div className="grid grid-cols-2 gap-2">
                <label className="flex flex-col gap-1">
                  <span className="text-ink-300">配音</span>
                  <select
                    value={voiceMode}
                    onChange={(e) => setVoiceMode(e.target.value as VoiceMode)}
                    className={INPUT}
                  >
                    <option value="auto">自动解说</option>
                    <option value="custom">自定义解说词</option>
                    <option value="off">无配音</option>
                  </select>
                </label>
                <label className="flex flex-col gap-1">
                  <span className="text-ink-300">音色</span>
                  <select
                    value={voice}
                    onChange={(e) => setVoice(e.target.value)}
                    disabled={voiceMode === "off"}
                    className={`${INPUT} disabled:opacity-40`}
                  >
                    {VOICES.map((v) => (
                      <option key={v.value} value={v.value}>
                        {v.label}
                      </option>
                    ))}
                  </select>
                </label>
              </div>

              {voiceMode !== "off" && (
                <>
                  <label className="flex flex-col gap-1">
                    <span className="text-ink-300">
                      语速 <span className="text-ink-400">{rate === 0 ? "正常" : `${rate > 0 ? "+" : ""}${rate}%`}</span>
                    </span>
                    <input
                      type="range"
                      min={-50}
                      max={100}
                      step={10}
                      value={rate}
                      onChange={(e) => setRate(Number(e.target.value))}
                      className="accent-gold-500"
                    />
                  </label>

                  <label className="flex flex-col gap-1">
                    <span className="text-ink-300">开场白</span>
                    <textarea
                      value={introText}
                      onChange={(e) => setIntroText(e.target.value)}
                      rows={2}
                      className={`${INPUT} resize-none leading-5`}
                      maxLength={200}
                    />
                  </label>

                  {(voiceMode === "custom" ||
                    annotations.some((a) => a.length > 0) ||
                    Object.values(branchConfig.altComments).some((v) => v) ||
                    Object.values(branchConfig.previewComments).some((v) => v)) && (
                    <div className="flex flex-col gap-1">
                      <span className="text-ink-300">
                        {voiceMode === "custom" ? "逐手解说词（留空则该手不配音）＋ 标注/变招" : "标注 / 变招解说词（按手）"}
                      </span>
                      <div className="max-h-52 overflow-y-auto rounded-lg border border-ink-600">
                        {source.moves.map((m, i) => {
                          const bp = source.branchPoints.find((p) => p.moveIndex === i);
                          const pickedAlts =
                            bp && (branchConfig.picks[i]?.length ?? 0) > 0
                              ? bp.alternatives.filter((a) => branchConfig.picks[i]!.includes(a.iccs))
                              : [];
                          const maxLine = bp ? Math.max(...bp.alternatives.map((a) => a.line.length), 1) : 1;
                          const rawLen = branchConfig.lineLens[i];
                          const branchLen =
                            rawLen === undefined ? Math.min(2, maxLine) : rawLen === 0 ? maxLine : Math.min(rawLen, maxLine);
                          const hasBranchInputs =
                            pickedAlts.length > 0 &&
                            (voiceMode === "custom" ||
                              branchConfig.previewComments[i] ||
                              pickedAlts.some((a) =>
                                a.line.slice(0, branchLen).some((_, k) => branchConfig.altComments[`${i}:${a.iccs}:${k}`] || (branchAnnotations[`${i}:${a.iccs}:${k}`]?.length ?? 0) > 0),
                              ));
                          return (
                            <Fragment key={i}>
                              {/* 变招解说词/标注行: 视频顺序为 预览→变招→主线, 所以排在主线行之前 */}
                              {hasBranchInputs && (
                                <>
                                  <div className="flex items-center gap-1.5 border-b border-ink-700 bg-ink-850/60 px-1.5 py-1 pl-7">
                                    <span className="w-16 shrink-0 truncate text-[10px] text-emerald-700" title="变招预览卡解说词">
                                      ⑂ 预览
                                    </span>
                                    <input
                                      value={branchConfig.previewComments[i] ?? ""}
                                      onChange={(e) =>
                                        setBranchConfig((cfg) => ({
                                          ...cfg,
                                          previewComments: { ...cfg.previewComments, [i]: e.target.value },
                                        }))
                                      }
                                      placeholder="预览解说词（留空用自动模板）"
                                      maxLength={120}
                                      className="min-w-0 flex-1 rounded border border-ink-700 bg-ink-850 px-1.5 py-1 text-[11px] text-ink-200 outline-none focus:border-gold-500/60"
                                    />
                                  </div>
                                  {pickedAlts.map((a) =>
                                    a.line.slice(0, branchLen).map((mv, k) => (
                                      <div
                                        key={`${i}:${a.iccs}:${k}`}
                                        className="flex items-center gap-1.5 border-b border-ink-700 bg-ink-850/60 px-1.5 py-1 pl-7 last:border-b-0"
                                      >
                                        <span
                                          className="w-16 shrink-0 truncate text-[10px] text-emerald-700"
                                          title={`变招线第 ${k + 1} 手`}
                                        >
                                          ⑂ {k + 1}/{a.line.slice(0, branchLen).length} {mv.notation}
                                        </span>
                                        <input
                                          value={branchConfig.altComments[`${i}:${a.iccs}:${k}`] ?? ""}
                                          onChange={(e) =>
                                            setBranchConfig((cfg) => ({
                                              ...cfg,
                                              altComments: {
                                                ...cfg.altComments,
                                                [`${i}:${a.iccs}:${k}`]: e.target.value,
                                              },
                                            }))
                                          }
                                          placeholder={
                                            k === 0
                                              ? "首手解说词（留空用自动：先看变招…）"
                                              : k === a.line.slice(0, branchLen).length - 1
                                                ? "末手解说词（留空用自动：最后走…）"
                                                : "解说词（留空用自动：接着走…）"
                                          }
                                          maxLength={120}
                                          className="min-w-0 flex-1 rounded border border-ink-700 bg-ink-850 px-1.5 py-1 text-[11px] text-ink-200 outline-none focus:border-gold-500/60"
                                        />
                                        <button
                                          onClick={() =>
                                            setEditingTarget({ moveIdx: i, altIccs: a.iccs, k })
                                          }
                                          title={`变招第 ${k + 1} 手棋盘标注`}
                                          className={`shrink-0 rounded px-1 text-[11px] transition-colors ${
                                            (branchAnnotations[`${i}:${a.iccs}:${k}`]?.length ?? 0) > 0
                                              ? "font-medium text-emerald-600"
                                              : "text-ink-400 hover:text-ink-200"
                                          }`}
                                        >
                                          📌
                                          {(branchAnnotations[`${i}:${a.iccs}:${k}`]?.length ?? 0) > 0
                                            ? branchAnnotations[`${i}:${a.iccs}:${k}`]!.length
                                            : ""}
                                        </button>
                                      </div>
                                    )),
                                  )}
                                </>
                              )}

                              {/* 主线走子行(变招演示之后) */}
                              <div className="flex items-center gap-1.5 border-b border-ink-700 px-1.5 py-1">
                                <span className="w-10 shrink-0 text-right text-[10px] text-ink-400">{i + 1}</span>
                                <span className="w-20 shrink-0 truncate text-[11px] text-ink-300" title={`${m.side === "red" ? "红" : "黑"} ${m.notation}`}>
                                  {m.notation}
                                </span>
                                {voiceMode === "custom" ? (
                                  <input
                                    value={narrations[i] ?? ""}
                                    onChange={(e) =>
                                      setNarrations((arr) => arr.map((v, j) => (j === i ? e.target.value : v)))
                                    }
                                    className="min-w-0 flex-1 rounded border border-ink-700 bg-ink-850 px-1.5 py-1 text-[11px] text-ink-200 outline-none focus:border-gold-500/60"
                                    maxLength={120}
                                  />
                                ) : (
                                  <span className="min-w-0 flex-1 text-center text-[10px] text-ink-400">自动解说</span>
                                )}
                                <button
                                  onClick={() => setEditingTarget({ moveIdx: i, altIccs: null, k: -1 })}
                                  title={`第 ${i + 1} 手棋盘标注`}
                                  className={`shrink-0 rounded px-1 text-[11px] transition-colors ${
                                    (annotations[i]?.length ?? 0) > 0
                                      ? "font-medium text-emerald-600"
                                      : "text-ink-400 hover:text-ink-200"
                                  }`}
                                >
                                  📌{(annotations[i]?.length ?? 0) > 0 ? annotations[i]!.length : ""}
                                </button>
                              </div>
                            </Fragment>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  <label className="flex flex-col gap-1">
                    <span className="text-ink-300">结束语</span>
                    <textarea
                      value={outroText}
                      onChange={(e) => setOutroText(e.target.value)}
                      rows={2}
                      className={`${INPUT} resize-none leading-5`}
                      maxLength={200}
                    />
                  </label>

                  <div className="text-[10px] leading-4 text-ink-400">
                    配音由微软 Edge 朗读接口在线合成（免费，需联网），单段失败自动静音不影响出片。
                  </div>
                </>
              )}
            </div>
          )}

          {/* ---------- 生成中 ---------- */}
          {phase === "working" && (
            <div className="flex flex-col gap-3 py-4 text-xs">
              <div className="h-2 overflow-hidden rounded-full bg-ink-700">
                <div
                  className="h-full bg-gold-500 transition-all"
                  style={{ width: `${Math.max(4, percent)}%` }}
                />
              </div>
              <div className="text-center text-ink-300">
                {progress ? progress.message : "正在启动..."}
              </div>
              {progress && progress.total > 0 && (
                <div className="text-center text-[10px] text-ink-400">
                  {progress.current} / {progress.total} · 生成中请勿关闭
                </div>
              )}
              <button onClick={cancel} className={`${BTN} mx-auto`}>
                取消生成
              </button>
            </div>
          )}

          {/* ---------- 完成预览 ---------- */}
          {phase === "done" && outcome && (
            <div className="flex flex-col gap-3 text-xs">
              <video
                src={convertFileSrc(outcome.video_path)}
                controls
                autoPlay
                className="w-full rounded-lg border border-ink-700"
              />
              <div className="text-ink-400">
                共 {outcome.move_count} 手 · 视频时长 {Math.round(outcome.duration_secs)} 秒 · 生成耗时{" "}
                <span className="font-medium text-emerald-700">{Math.round(outcome.elapsed_secs)} 秒</span> ·{" "}
                {fmtSize(outcome.size_bytes)}
              </div>
              <div className="flex gap-2">
                <button
                  onClick={() => void revealVideo(outcome.dir)}
                  className={`${BTN} flex-1`}
                >
                  打开文件夹
                </button>
                <button onClick={saveAs} disabled={saving} className={`${BTN} flex-1`}>
                  {saving ? "保存中…" : "另存为…"}
                </button>
                <button onClick={onClose} className={`${BTN} flex-1`}>
                  关闭
                </button>
              </div>
            </div>
          )}
        </div>

        {/* 底部操作行(仅编辑态) */}
        {phase === "edit" && source && !loadError && (
          <div className="mt-3 flex shrink-0 gap-2">
            <button onClick={onClose} className={`${BTN} flex-1`}>
              取消
            </button>
            <button
              onClick={start}
              className="flex-[2] rounded-lg bg-gold-500 px-4 py-1.5 text-sm font-medium text-white hover:opacity-90"
            >
              开始导出（约 {Math.max(1, Math.round(total * (voiceMode === "off" ? 0.5 : 1.2) + 8))} 秒）
            </button>
          </div>
        )}
      </div>

      {/* 标注编辑浮层(主线手 / 变招手通用) */}
      {editingTarget !== null &&
        source &&
        (editingTarget.altIccs === null ? (
          <AnnotationEditor
            fenAfter={source.moves[editingTarget.moveIdx]!.fen_after}
            annotations={annotations[editingTarget.moveIdx] ?? []}
            onChange={(list) =>
              setAnnotations((arr) => arr.map((v, j) => (j === editingTarget.moveIdx ? list : v)))
            }
            onClose={() => setEditingTarget(null)}
          />
        ) : (
          (() => {
            const key = `${editingTarget.moveIdx}:${editingTarget.altIccs}:${editingTarget.k}`;
            const alt = source.branchPoints
              .find((p) => p.moveIndex === editingTarget.moveIdx)
              ?.alternatives.find((a) => a.iccs === editingTarget.altIccs);
            const fenAfter = alt?.line[editingTarget.k]?.fen_after;
            if (!fenAfter) return null;
            return (
              <AnnotationEditor
                fenAfter={fenAfter}
                annotations={branchAnnotations[key] ?? []}
                onChange={(list) =>
                  setBranchAnnotations((map) => ({ ...map, [key]: list }))
                }
                onClose={() => setEditingTarget(null)}
              />
            );
          })()
        ))}

      {/* 变招勾选浮层(仅复盘棋谱来源) */}
      {branchPickerOpen && source && (
        <BranchPicker
          branchPoints={source.branchPoints}
          config={branchConfig}
          onChange={setBranchConfig}
          onClose={() => setBranchPickerOpen(false)}
        />
      )}
    </div>
  );
}
