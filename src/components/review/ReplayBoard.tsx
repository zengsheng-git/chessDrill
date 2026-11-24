import { useMemo } from "react";
import { parseFen } from "../../lib/board/fen";
import { pieceColor, pieceGlyph, type Pos } from "../../lib/board/types";

const CELL = 62;
const PAD = 46;
const WIDTH = PAD * 2 + CELL * 8;
const HEIGHT = PAD * 2 + CELL * 9;
const R = 26;

const RED_FILE_NUMS = ["九", "八", "七", "六", "五", "四", "三", "二", "一"];

interface BoardProps {
  fen: string;
  flipped: boolean;
  lastMove: { from: Pos; to: Pos } | null;
  previewMove?: { from: Pos; to: Pos } | null;
  /** 多分支候选: 全部以绿色箭头标注(与练习提示箭头同款), 箭头中段带编号徽标 */
  branchOptions?: { from: Pos; to: Pos }[];
  /** 点击棋盘格子(仅 branchOptions 非空时启用, 唯一匹配的落点才生效) */
  onSquareClick?: (pos: Pos) => void;
  /** 悬停棋盘格子(用于候选落点预览), 移出传 null */
  onSquareHover?: (pos: Pos | null) => void;
}

function cornerPath(
  cx: number,
  cy: number,
  gap: number,
  len: number,
  sides: { left: boolean; right: boolean },
): string {
  const parts: string[] = [];
  if (sides.left) {
    parts.push(`M ${cx - gap - len} ${cy - gap} L ${cx - gap} ${cy - gap} L ${cx - gap} ${cy - gap + len}`);
    parts.push(`M ${cx - gap - len} ${cy + gap} L ${cx - gap} ${cy + gap} L ${cx - gap} ${cy + gap - len}`);
  }
  if (sides.right) {
    parts.push(`M ${cx + gap + len} ${cy - gap} L ${cx + gap} ${cy - gap} L ${cx + gap} ${cy - gap + len}`);
    parts.push(`M ${cx + gap + len} ${cy + gap} L ${cx + gap} ${cy + gap} L ${cx + gap} ${cy + gap - len}`);
  }
  return parts.join(" ");
}

export default function ReplayBoard({
  fen,
  flipped,
  lastMove,
  previewMove,
  branchOptions,
  onSquareClick,
  onSquareHover,
}: BoardProps) {
  const { board } = useMemo(() => parseFen(fen), [fen]);

  const px = (x: number) => PAD + (flipped ? 8 - x : x) * CELL;
  const py = (y: number) => PAD + (flipped ? y : 9 - y) * CELL;

  // 候选箭头: 手绘杆+三角头(与练习提示箭头同款), 箭尖直达落点中心
  const drawArrow = (from: Pos, to: Pos, key: string) => {
    const x1 = px(from.x);
    const y1 = py(from.y);
    const x2 = px(to.x);
    const y2 = py(to.y);
    const dx = x2 - x1;
    const dy = y2 - y1;
    const dist = Math.hypot(dx, dy);
    if (dist < CELL / 2) return null;
    const ux = dx / dist;
    const uy = dy / dist;
    const vx = -uy;
    const vy = ux;
    // 箭尾从起点中心外移让开棋子, 箭尖盖在落点棋子上
    const tailX = x1 + ux * 12;
    const tailY = y1 + uy * 12;
    const headLen = 22;
    const headHalf = 12;
    const baseX = x2 - ux * headLen;
    const baseY = y2 - uy * headLen;
    const shaftX = x2 - ux * (headLen - 2);
    const shaftY = y2 - uy * (headLen - 2);
    return (
      <g key={key} opacity="0.9">
        <line
          x1={tailX}
          y1={tailY}
          x2={shaftX}
          y2={shaftY}
          stroke="#2e9e5b"
          strokeWidth="8"
          strokeLinecap="round"
        />
        <polygon
          points={`${x2},${y2} ${baseX + vx * headHalf},${baseY + vy * headHalf} ${baseX - vx * headHalf},${baseY - vy * headHalf}`}
          fill="#2e9e5b"
        />
      </g>
    );
  };

  const marks: { x: number; y: number }[] = [];
  for (const [mx, my] of [
    [1, 2], [7, 2], [1, 7], [7, 7],
    [0, 3], [2, 3], [4, 3], [6, 3], [8, 3],
    [0, 6], [2, 6], [4, 6], [6, 6], [8, 6],
  ]) {
    marks.push({ x: mx, y: my });
  }

  return (
    <svg
      viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
      className="h-auto max-h-full w-full"
      role="img"
      aria-label="象棋棋盘"
    >
      <defs>
        <linearGradient id="wood" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#f0d8a8" />
          <stop offset="55%" stopColor="#e6c68c" />
          <stop offset="100%" stopColor="#dcb877" />
        </linearGradient>
        <radialGradient id="pieceFace" cx="0.38" cy="0.32" r="0.85">
          <stop offset="0%" stopColor="#faf0d8" />
          <stop offset="70%" stopColor="#f1e2bd" />
          <stop offset="100%" stopColor="#e2cb98" />
        </radialGradient>
        <filter id="pieceShadow" x="-30%" y="-30%" width="160%" height="160%">
          <feDropShadow dx="0" dy="2.5" stdDeviation="2.5" floodColor="#3a2a12" floodOpacity="0.38" />
        </filter>
      </defs>

      <rect x="10" y="10" width={WIDTH - 20} height={HEIGHT - 20} rx="14" fill="url(#wood)" />
      <rect
        x={PAD - 7}
        y={PAD - 7}
        width={8 * CELL + 14}
        height={9 * CELL + 14}
        fill="none"
        stroke="#8a5a20"
        strokeWidth="3"
        rx="3"
      />

      {Array.from({ length: 10 }, (_, r) => (
        <line
          key={`h${r}`}
          x1={PAD}
          y1={PAD + r * CELL}
          x2={PAD + 8 * CELL}
          y2={PAD + r * CELL}
          stroke="#7a5426"
          strokeWidth="1.4"
        />
      ))}
      {Array.from({ length: 9 }, (_, c) =>
        c === 0 || c === 8 ? (
          <line
            key={`v${c}`}
            x1={PAD + c * CELL}
            y1={PAD}
            x2={PAD + c * CELL}
            y2={PAD + 9 * CELL}
            stroke="#7a5426"
            strokeWidth="1.4"
          />
        ) : (
          <g key={`v${c}`}>
            <line x1={PAD + c * CELL} y1={PAD} x2={PAD + c * CELL} y2={PAD + 4 * CELL} stroke="#7a5426" strokeWidth="1.4" />
            <line x1={PAD + c * CELL} y1={PAD + 5 * CELL} x2={PAD + c * CELL} y2={PAD + 9 * CELL} stroke="#7a5426" strokeWidth="1.4" />
          </g>
        ),
      )}

      <g stroke="#7a5426" strokeWidth="1.2">
        <line x1={px(3)} y1={py(0)} x2={px(5)} y2={py(2)} />
        <line x1={px(5)} y1={py(0)} x2={px(3)} y2={py(2)} />
        <line x1={px(3)} y1={py(7)} x2={px(5)} y2={py(9)} />
        <line x1={px(5)} y1={py(7)} x2={px(3)} y2={py(9)} />
      </g>

      {marks.map((m) => (
        <path
          key={`m${m.x}-${m.y}`}
          d={cornerPath(px(m.x), py(m.y), 5, 7, { left: m.x > 0, right: m.x < 8 })}
          fill="none"
          stroke="#7a5426"
          strokeWidth="1.2"
        />
      ))}

      <text
        x={PAD + 2 * CELL}
        y={PAD + 4.5 * CELL}
        fontSize="30"
        fill="#9a7434"
        opacity="0.75"
        textAnchor="middle"
        dominantBaseline="central"
        letterSpacing="14"
        style={{ fontFamily: "var(--font-piece)" }}
      >
        楚 河
      </text>
      <text
        x={PAD + 6 * CELL}
        y={PAD + 4.5 * CELL}
        fontSize="30"
        fill="#9a7434"
        opacity="0.75"
        textAnchor="middle"
        dominantBaseline="central"
        letterSpacing="14"
        style={{ fontFamily: "var(--font-piece)" }}
      >
        汉 界
      </text>

      {Array.from({ length: 9 }, (_, d) => {
        const x = flipped ? 8 - d : d;
        return (
          <text
            key={`bt${d}`}
            x={px(x)}
            y={PAD - 20}
            fontSize="15"
            fill="#6b4a1e"
            textAnchor="middle"
            dominantBaseline="central"
          >
            {flipped ? RED_FILE_NUMS[x] : x + 1}
          </text>
        );
      })}
      {Array.from({ length: 9 }, (_, d) => {
        const x = flipped ? 8 - d : d;
        return (
          <text
            key={`bb${d}`}
            x={px(x)}
            y={PAD + 9 * CELL + 22}
            fontSize="15"
            fill="#6b4a1e"
            textAnchor="middle"
            dominantBaseline="central"
            style={{ fontFamily: "var(--font-piece)" }}
          >
            {flipped ? x + 1 : RED_FILE_NUMS[x]}
          </text>
        );
      })}

      {/* 最后一步: 起点四角括号标记(与练习模块一致) */}
      {lastMove && (
        <path
          d={cornerPath(px(lastMove.from.x), py(lastMove.from.y), 17, 9, { left: true, right: true })}
          fill="none"
          stroke="#2e9e5b"
          strokeWidth="2.5"
          strokeLinecap="round"
          opacity="0.95"
        />
      )}

      {board.map((piece, i) => {
        if (!piece) return null;
        const x = i % 9;
        const y = Math.floor(i / 9);
        const red = pieceColor(piece) === "red";
        const isTo = lastMove && lastMove.to.x === x && lastMove.to.y === y;
        return (
          <g key={i} transform={`translate(${px(x)},${py(y)})`}>
            {/* 落子棋子: 绿色细圆环(与练习模块一致) */}
            {isTo && (
              <circle r={R + 3} fill="none" stroke="#2e9e5b" strokeWidth="2.5" />
            )}
            <circle r={R} fill="url(#pieceFace)" stroke={red ? "#a03020" : "#3a3a3a"} strokeWidth="1.6" filter="url(#pieceShadow)" />
            <circle r={R - 5} fill="none" stroke={red ? "#c2402a" : "#4a4a4a"} strokeWidth="1.2" opacity="0.7" />
            <text
              y="1"
              fontSize="30"
              fontWeight="700"
              fill={red ? "#b02818" : "#26221c"}
              textAnchor="middle"
              dominantBaseline="central"
              style={{ fontFamily: "var(--font-piece)" }}
            >
              {pieceGlyph(piece)}
            </text>
          </g>
        );
      })}

      {/* 分支候选: 全部绿色箭头(与练习提示箭头同款) */}
      {(branchOptions ?? []).map((opt, i) => drawArrow(opt.from, opt.to, `b${i}`))}

      {/* 编号徽标: 画在箭头中段(45% 处), 同落点的多支箭头徽标互不遮挡 */}
      {(branchOptions ?? []).map((opt, i) => {
        if (i >= 9) return null;
        const x1 = px(opt.from.x);
        const y1 = py(opt.from.y);
        const x2 = px(opt.to.x);
        const y2 = py(opt.to.y);
        if (Math.hypot(x2 - x1, y2 - y1) < CELL / 2) return null;
        const mx = x1 + (x2 - x1) * 0.45;
        const my = y1 + (y2 - y1) * 0.45;
        return (
          <g key={`bn${i}`} pointerEvents="none">
            <circle cx={mx} cy={my} r="11" fill="#2e9e5b" stroke="#ffffff" strokeWidth="1.5" opacity="0.95" />
            <text
              x={mx}
              y={my + 0.5}
              fontSize="12"
              fontWeight="700"
              fill="#ffffff"
              textAnchor="middle"
              dominantBaseline="central"
            >
              {i + 1}
            </text>
          </g>
        );
      })}

      {previewMove && (
        <>
          <circle
            cx={px(previewMove.from.x)}
            cy={py(previewMove.from.y)}
            r={R - 2}
            fill="none"
            stroke="#0e7490"
            strokeWidth="2.5"
            strokeDasharray="5 4"
            opacity="0.9"
          />
          <circle
            cx={px(previewMove.to.x)}
            cy={py(previewMove.to.y)}
            r={R}
            fill="#22d3ee"
            fillOpacity="0.35"
            stroke="#0e7490"
            strokeWidth="2.5"
            strokeDasharray="5 4"
          />
        </>
      )}

      {/* 分支选择热区: 点击落点走子, 悬停预览(置于最上层保证可命中) */}
      {branchOptions && branchOptions.length > 0 && onSquareClick && (
        <>
          {Array.from({ length: 90 }, (_, i) => {
            const x = i % 9;
            const y = Math.floor(i / 9);
            return (
              <circle
                key={`c${i}`}
                cx={px(x)}
                cy={py(y)}
                r={CELL / 2}
                fill="transparent"
                style={{ cursor: "pointer" }}
                onClick={() => onSquareClick({ x, y })}
                onMouseEnter={() => onSquareHover?.({ x, y })}
                onMouseLeave={() => onSquareHover?.(null)}
              />
            );
          })}
        </>
      )}
    </svg>
  );
}
