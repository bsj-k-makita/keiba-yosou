import type { AbilityKey } from "../../domain/race-evaluation/abilityTypes";
import { ABILITY_KEYS, ABILITY_LABELS } from "../../domain/race-evaluation/abilityTypes";

const W = 160;
const CX = 80;
const CY = 80;
const R_MAX = 52;
/** 外周の軸ラベル用（多角形グリッドより外側） */
const R_LAB = 68;

function clamp01(n: number): number {
  return Math.max(0, Math.min(1, n / 100));
}

function pt(value01: number, i: number): { x: number; y: number } {
  const t = R_MAX * value01;
  const a = -Math.PI / 2 + (2 * Math.PI * i) / 5;
  return { x: CX + t * Math.cos(a), y: CY + t * Math.sin(a) };
}

function pathD(orderedKeys: readonly AbilityKey[], getV: (k: AbilityKey) => number): string {
  const parts = orderedKeys.map((k, i) => {
    const p = pt(clamp01(getV(k)), i);
    return i === 0 ? `M ${p.x} ${p.y}` : `L ${p.x} ${p.y}`;
  });
  return parts.join(" ") + " Z";
}

function labelPos(i: number): { x: number; y: number; textAnchor: "start" | "middle" | "end" } {
  const a = -Math.PI / 2 + (2 * Math.PI * i) / 5;
  const x = CX + R_LAB * Math.cos(a);
  const y = CY + R_LAB * Math.sin(a);
  const cos = Math.cos(a);
  let textAnchor: "start" | "middle" | "end" = "middle";
  if (cos > 0.25) textAnchor = "start";
  if (cos < -0.25) textAnchor = "end";
  return { x, y, textAnchor };
}

type Props = {
  horse: Record<AbilityKey, number>;
  /** 既定 1.5〜2x 想定。旧100相当なら 180 前後。 */
  size?: number;
};

/**
 * 能力5項目のみのレーダー（混在オーバーレイをしない）
 */
export function RadarChart({ horse, size = 192 }: Props) {
  const keys = ABILITY_KEYS;
  const rings = [0.25, 0.5, 0.75, 1];
  const points = keys.map((k, i) => ({ key: k, ...pt(clamp01(horse[k] ?? 0), i) }));
  return (
    <svg
      className="radar"
      viewBox={`0 0 ${W} ${W}`}
      width={size}
      height={size}
      role="img"
      aria-label="5つの能力の相対的な形（0〜100を端までに正規化）"
    >
      {rings.map((r) => (
        <polygon
          key={r}
          className="radar__grid"
          points={keys.map((_k, i) => {
            const a = -Math.PI / 2 + (2 * Math.PI * i) / 5;
            const x = CX + R_MAX * r * Math.cos(a);
            const y = CY + R_MAX * r * Math.sin(a);
            return `${x},${y}`;
          }).join(" ")}
          fill="none"
          stroke={r === 1 ? "#b7b7bd" : "#d8d8de"}
          strokeWidth={r === 1 ? 1 : 0.75}
        />
      ))}
      {keys.map((k, i) => {
        const a = -Math.PI / 2 + (2 * Math.PI * i) / 5;
        const x2 = CX + R_MAX * Math.cos(a);
        const y2 = CY + R_MAX * Math.sin(a);
        return (
          <line
            key={k}
            x1={CX}
            y1={CY}
            x2={x2}
            y2={y2}
            stroke="#d2d2d7"
            strokeWidth={0.8}
          />
        );
      })}

      {keys.map((k, i) => {
        const { x, y, textAnchor } = labelPos(i);
        return (
          <text
            key={k}
            x={x}
            y={y + 0.1}
            textAnchor={textAnchor}
            className="radar__axlab"
            fill="#4a4a4f"
            fontSize={8}
            fontWeight={600}
          >
            {ABILITY_LABELS[k]}
          </text>
        );
      })}

      <path
        d={pathD(keys, (k) => horse[k] ?? 0)}
        fill="rgba(0,113,227,0.18)"
        stroke="#0071e3"
        strokeWidth={2.2}
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      {points.map((p) => (
        <circle
          key={p.key}
          cx={p.x}
          cy={p.y}
          r={2.4}
          fill="#0071e3"
          stroke="#ffffff"
          strokeWidth={1.1}
        />
      ))}
    </svg>
  );
}
