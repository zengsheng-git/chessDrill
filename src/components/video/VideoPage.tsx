import { useEffect, useState } from "react";
import { convertFileSrc } from "@tauri-apps/api/core";
import ConfirmDialog from "../common/ConfirmDialog";
import VideoExportDialog from "./VideoExportDialog";
import ScreenshotDialog from "./ScreenshotDialog";
import { sourceFromQuestion } from "../../lib/video/build";
import {
  deleteVideo,
  listVideos,
  listenVideoDone,
  revealVideo,
  saveVideoAs,
} from "../../lib/video/api";
import type { VideoMetaDto } from "../../lib/video/types";

const BTN =
  "rounded-md border border-ink-600 bg-ink-900 px-1.5 py-1 text-[11px] text-ink-200 hover:bg-ink-850 disabled:opacity-40";

function fmtDuration(secs: number): string {
  const m = Math.floor(secs / 60);
  const s = Math.round(secs % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function fmtSize(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

function fmtDate(ms: number): string {
  const d = new Date(ms);
  const pad = (n: number) => n.toString().padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** 视频工坊: 生成成品的查看与管理(播放/另存/删除) */
export default function VideoPage({ onExit }: { onExit: () => void }) {
  const [videos, setVideos] = useState<VideoMetaDto[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [playing, setPlaying] = useState<VideoMetaDto | null>(null);
  const [removing, setRemoving] = useState<VideoMetaDto | null>(null);
  const [saving, setSaving] = useState(false);
  const [snipOpen, setSnipOpen] = useState(false);
  /** 截图确认后的导出目标: 打开导出对话框(引擎求解参考线) */
  const [snipExport, setSnipExport] = useState<{ fen: string; title: string } | null>(null);

  const refresh = () => {
    listVideos()
      .then((list) => {
        setVideos(list);
        setError(null);
      })
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
  };

  useEffect(() => {
    refresh();
    // 停留本页期间有新视频生成完成时自动刷新
    const off = listenVideoDone(() => refresh());
    return () => {
      void off.then((f) => f());
    };
  }, []);

  const saveAs = (v: VideoMetaDto) => {
    setSaving(true);
    const name = `${v.title || v.id}.mp4`.replace(/[\\/:*?"<>|]/g, " ");
    saveVideoAs(v.video_path, name)
      .catch(() => undefined) // 取消保存不打断
      .finally(() => setSaving(false));
  };

  const remove = (v: VideoMetaDto) => {
    deleteVideo(v.id)
      .then(() => {
        if (playing?.id === v.id) setPlaying(null);
        setRemoving(null);
        refresh();
      })
      .catch((e) => {
        setRemoving(null);
        setError(e instanceof Error ? e.message : String(e));
      });
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* 顶部工具行 */}
      <div className="flex shrink-0 items-center gap-1.5 border-b border-ink-700 bg-ink-900 px-2 py-1.5">
        <button
          onClick={onExit}
          title="返回模块选择"
          className="rounded-md px-1.5 py-1 text-sm leading-none text-ink-400 transition-colors hover:bg-ink-800 hover:text-ink-200"
        >
          ←
        </button>
        <span className="text-[11px] font-semibold tracking-wider text-ink-300">
          视频工坊
          {videos && <span className="ml-1 font-normal text-ink-400">共 {videos.length} 个</span>}
        </span>
        <span className="flex-1" />
        <button onClick={() => setSnipOpen(true)} className={BTN} title="截图识别局面生成解说视频">
          截图识别
        </button>
        <button onClick={refresh} className={BTN} title="重新扫描视频库">
          刷新
        </button>
        <button
          onClick={() => videos && void revealVideo(videos[0]!.video_path)}
          disabled={!videos || videos.length === 0}
          className={BTN}
          title="在资源管理器中定位视频目录"
        >
          目录
        </button>
      </div>

      {error && (
        <div className="shrink-0 border-b border-verm-600/40 bg-verm-600/10 px-3 py-1 text-[11px] text-verm-600">
          {error}
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-y-auto p-2">
        {videos === null && (
          <div className="flex h-full items-center justify-center text-sm text-ink-400">
            <span className="animate-pulse">正在读取视频库…</span>
          </div>
        )}

        {videos !== null && videos.length === 0 && (
          <div className="flex h-full flex-col items-center justify-center gap-2 text-center">
            <div className="text-sm text-gold-500">还没有生成过视频</div>
            <div className="text-[11px] leading-5 text-ink-400">
              去「杀招残局练习」点 <span className="text-ink-300">导视频</span>
              <br />
              在「棋谱复盘」工具栏点 <span className="text-ink-300">视频</span>
              <br />
              或点本页 <span className="text-ink-300">截图识别</span> 从任意棋局截图生成
            </div>
          </div>
        )}

        {videos !== null && videos.length > 0 && (
          <div className="flex flex-col gap-2">
            {videos.map((v) => (
              <div
                key={v.id}
                onClick={() => setPlaying(v)}
                className="group flex cursor-pointer items-stretch gap-2.5 rounded-xl border border-ink-600 bg-ink-800 p-2 transition-all hover:border-gold-500/50 hover:bg-ink-850 active:scale-[0.99]"
              >
                <div className="h-[104px] w-[58px] shrink-0 overflow-hidden rounded-lg bg-ink-850">
                  <img
                    src={convertFileSrc(v.cover_path)}
                    alt=""
                    loading="lazy"
                    className="h-full w-full object-cover"
                  />
                </div>
                <div className="flex min-w-0 flex-1 flex-col justify-between py-0.5">
                  <div className="min-w-0">
                    <div className="truncate text-[13px] font-medium text-ink-100">{v.title}</div>
                    {v.subtitle && <div className="mt-0.5 truncate text-[10px] text-ink-400">{v.subtitle}</div>}
                  </div>
                  <div className="text-[10px] leading-4 text-ink-400">
                    <div>
                      {v.move_count} 手 · {fmtDuration(v.duration_secs)} · {fmtSize(v.size_bytes)}
                    </div>
                    <div>{fmtDate(v.created_ms)}</div>
                  </div>
                </div>
                <div className="flex shrink-0 flex-col justify-center gap-1">
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setPlaying(v);
                    }}
                    className="rounded-md bg-verm-600 px-2 py-1 text-[11px] font-medium text-white hover:opacity-90"
                  >
                    播放
                  </button>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setRemoving(v);
                    }}
                    title="删除(移入回收站)"
                    className="rounded-md border border-ink-600 px-2 py-1 text-[11px] text-ink-400 hover:border-verm-500/60 hover:text-verm-400"
                  >
                    删除
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* 播放浮层 */}
      {playing && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-ink-950/70"
          onClick={() => setPlaying(null)}
        >
          <div
            className="flex max-h-[86vh] w-[min(430px,calc(100vw-24px))] flex-col gap-3 rounded-xl border border-gold-500/40 bg-ink-900 p-4 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex shrink-0 items-center justify-between">
              <span className="min-w-0 truncate text-sm font-bold text-gold-300">{playing.title}</span>
              <button
                onClick={() => setPlaying(null)}
                title="关闭"
                className="rounded px-1.5 py-0.5 text-ink-400 transition-colors hover:bg-ink-800 hover:text-ink-200"
              >
                ✕
              </button>
            </div>
            <video
              src={convertFileSrc(playing.video_path)}
              controls
              autoPlay
              className="max-h-[52vh] w-full rounded-lg border border-ink-700"
            />
            <div className="shrink-0 text-[10px] leading-4 text-ink-400">
              {playing.move_count} 手 · {fmtDuration(playing.duration_secs)} · {fmtSize(playing.size_bytes)} ·{" "}
              {fmtDate(playing.created_ms)}
              {playing.elapsed_secs > 0 && (
                <div>生成耗时 {fmtDuration(playing.elapsed_secs)}</div>
              )}
            </div>
            <div className="flex shrink-0 gap-2">
              <button
                onClick={() => void revealVideo(playing.video_path)}
                className={BTN}
              >
                打开文件夹
              </button>
              <button onClick={() => saveAs(playing)} disabled={saving} className={BTN}>
                {saving ? "保存中…" : "另存为…"}
              </button>
              <span className="flex-1" />
              <button
                onClick={() => setRemoving(playing)}
                className="rounded-md border border-verm-500/50 bg-ink-800 px-2 py-1 text-[11px] text-verm-400 hover:border-verm-500 hover:bg-verm-500/10"
              >
                删除
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 删除确认 */}
      {removing && (
        <ConfirmDialog
          title="删除视频"
          message={`确定删除「${removing.title}」吗？`}
          hint="整个产物目录（视频/封面/解说词）将移入系统回收站，可在回收站恢复。"
          confirmText="删除"
          onConfirm={() => remove(removing)}
          onCancel={() => setRemoving(null)}
        />
      )}

      {/* 截图识别 → 确认局面后交给导出对话框 */}
      {snipOpen && (
        <ScreenshotDialog
          onClose={() => setSnipOpen(false)}
          onExport={(fen, title) => {
            setSnipOpen(false);
            setSnipExport({ fen, title });
          }}
        />
      )}
      {snipExport && (
        <VideoExportDialog
          loadSource={() =>
            sourceFromQuestion({ fen: snipExport.fen, title: snipExport.title, subtitle: "" })
          }
          onClose={() => setSnipExport(null)}
        />
      )}
    </div>
  );
}
