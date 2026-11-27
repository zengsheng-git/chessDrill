import { useEffect, useState } from "react";
import Board, { type BoardAnnotation } from "../board/Board";
import { posToIccs } from "../../lib/board/notation";
import type { Pos } from "../../lib/board/types";
import type { VideoAnnotation } from "../../lib/video/types";

type Mode = "circle" | "arrow";

/** ICCS("c3") → 棋盘坐标 Pos */
function iccsToPos(iccs: string): Pos {
  return { x: iccs.charCodeAt(0) - 97, y: Number(iccs[1]) };
}

/** 视频标注 → Board 所见即所得标注 */
function toBoardAnnotations(list: VideoAnnotation[]): BoardAnnotation[] {
  return list.map((a) => ({ kind: a.kind, from: iccsToPos(a.from), to: a.to ? iccsToPos(a.to) : null, color: a.color }));
}

function labelOf(a: VideoAnnotation): string {
  const color = a.color === "red" ? "红" : "绿";
  const shape = a.kind === "circle" ? `圈 ${a.from}` : `箭头 ${a.from}→${a.to}`;
  return `${color} ${shape}`;
}

/** 标注编辑浮层: mini 棋盘点选(点 1 下加圈注, 箭头模式点 2 下), 列表可删 */
export default function AnnotationEditor({
  fenAfter,
  move,
  annotations,
  onChange,
  onClose,
}: {
  fenAfter: string;
  /** 当前手的招法与着法(ICCS), 标题展示 + 棋盘走子标记; 预览卡等无走子场景为 null */
  move?: { notation: string; iccs: string } | null;
  annotations: VideoAnnotation[];
  onChange: (list: VideoAnnotation[]) => void;
  onClose: () => void;
}) {
  const [mode, setMode] = useState<Mode>("arrow");
  const [color, setColor] = useState<"red" | "green">("red");
  const [arrowFrom, setArrowFrom] = useState<Pos | null>(null);

  // Esc 只关闭本浮层(外层对话框在 editor 打开期间忽略 Esc)
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

  const onSquareClick = (pos: Pos) => {
    if (mode === "circle") {
      onChange([...annotations, { kind: "circle", from: posToIccs(pos), to: null, color }]);
      return;
    }
    // 箭头模式: 第一次点记起点, 第二次点成箭头
    if (!arrowFrom) {
      setArrowFrom(pos);
      return;
    }
    if (arrowFrom.x === pos.x && arrowFrom.y === pos.y) {
      setArrowFrom(null);
      return;
    }
    onChange([
      ...annotations,
      { kind: "arrow", from: posToIccs(arrowFrom), to: posToIccs(pos), color },
    ]);
    setArrowFrom(null);
  };

  const switchMode = (m: Mode) => {
    setMode(m);
    setArrowFrom(null);
  };

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-ink-950/70"
      onClick={(e) => {
        // 仅点击遮罩空白关闭; 内部(含棋盘点击冒泡)不关闭
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="flex max-h-[90vh] w-[min(460px,calc(100vw-24px))] flex-col gap-2.5 rounded-xl border border-gold-500/40 bg-ink-900 p-3.5 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex shrink-0 items-center justify-between">
          <span className="text-sm font-bold text-gold-300">
            棋盘标注
            {move && <span className="ml-2 text-xs font-medium text-ink-100">· {move.notation}</span>}
          </span>
          <button
            onClick={onClose}
            title="完成并关闭"
            className="rounded px-1.5 py-0.5 text-ink-400 transition-colors hover:bg-ink-800 hover:text-ink-200"
          >
            ✕
          </button>
        </div>

        {/* 工具行: 标注类型 + 颜色 */}
        <div className="flex shrink-0 items-center gap-1.5 text-[11px]">
          <button
            onClick={() => switchMode("circle")}
            className={`rounded-md border px-2.5 py-1.5 transition-colors ${
              mode === "circle"
                ? "border-verm-500 bg-verm-600/15 font-medium text-verm-600"
                : "border-ink-600 bg-ink-800 text-ink-300 hover:bg-ink-850"
            }`}
          >
            ○ 圈注
          </button>
          <button
            onClick={() => switchMode("arrow")}
            className={`rounded-md border px-2.5 py-1.5 transition-colors ${
              mode === "arrow"
                ? "border-verm-500 bg-verm-600/15 font-medium text-verm-600"
                : "border-ink-600 bg-ink-800 text-ink-300 hover:bg-ink-850"
            }`}
          >
            → 箭头
          </button>
          <span className="flex-1" />
          <span className="text-ink-400">颜色</span>
          <button
            onClick={() => setColor("red")}
            title="红：威胁 / 关键"
            className={`h-6 w-6 rounded-full border-2 transition-transform ${
              color === "red" ? "scale-110 border-verm-600" : "border-transparent opacity-50"
            } bg-[#dc2626]`}
          />
          <button
            onClick={() => setColor("green")}
            title="绿：路线 / 说明"
            className={`h-6 w-6 rounded-full border-2 transition-transform ${
              color === "green" ? "scale-110 border-emerald-700" : "border-transparent opacity-50"
            } bg-[#2e9e5b]`}
          />
        </div>

        {/* 点选提示 */}
        <div className="shrink-0 text-[11px] text-ink-400">
          {mode === "circle"
            ? "在棋盘上点一个交点添加圈注"
            : arrowFrom
              ? "再点一个交点作为箭头终点"
              : "在棋盘上点起点（棋子中心）"}
        </div>

        {/* mini 棋盘(该手走完后的局面, 带本手走子标记) */}
        <div className="shrink-0 overflow-hidden rounded-lg border border-ink-700">
          <Board
            fen={fenAfter}
            flipped={false}
            lastMove={move ? { from: iccsToPos(move.iccs.slice(0, 2)), to: iccsToPos(move.iccs.slice(2, 4)) } : null}
            selected={arrowFrom}
            targets={[]}
            annotations={toBoardAnnotations(annotations)}
            interactive
            onSquareClick={onSquareClick}
          />
        </div>

        {/* 标注列表 */}
        <div className="min-h-0 flex-1 overflow-y-auto rounded-lg border border-ink-700">
          {annotations.length === 0 ? (
            <div className="px-3 py-2.5 text-center text-[11px] text-ink-400">还没有标注</div>
          ) : (
            annotations.map((a, i) => (
              <div
                key={i}
                className="flex items-center gap-2 border-b border-ink-700 px-3 py-1.5 text-[12px] last:border-b-0"
              >
                <span
                  className={`h-2 w-2 shrink-0 rounded-full ${a.color === "red" ? "bg-[#dc2626]" : "bg-[#2e9e5b]"}`}
                />
                <span className="min-w-0 flex-1 text-ink-200">{labelOf(a)}</span>
                <button
                  onClick={() => onChange(annotations.filter((_, j) => j !== i))}
                  title="删除此标注"
                  className="shrink-0 rounded px-1 text-ink-400 hover:bg-ink-800 hover:text-verm-400"
                >
                  ✕
                </button>
              </div>
            ))
          )}
        </div>

        <div className="flex shrink-0 gap-2">
          {annotations.length > 0 && (
            <button
              onClick={() => onChange([])}
              className="flex-1 rounded-lg border border-ink-600 bg-ink-800 px-3 py-1.5 text-sm text-ink-200 hover:bg-ink-850"
            >
              清空
            </button>
          )}
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
