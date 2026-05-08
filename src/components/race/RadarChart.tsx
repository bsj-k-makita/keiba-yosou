import type { AbilityKey } from "../../domain/race-evaluation/abilityTypes";
import type { AbilityGradeRow } from "../../domain/race-evaluation/abilityGrades";
import { ABILITY_KEYS, ABILITY_LABELS } from "../../domain/race-evaluation/abilityTypes";

/** viewBox 内の描画領域（周囲にラベル用パディングを付けるため g でオフセット） */
const W = 160;
const CX = 80;
const CY = 80;
const VIEW_PAD = 14;
const VB_SIZE = W + VIEW_PAD * 2;
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

function pathD(orderedKeys: readonly AbilityKey[], getV01: (k: AbilityKey) => number): string {
  const parts = orderedKeys.map((k, i) => {
    const p = pt(getV01(k), i);
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
  /** 生の能力値 0〜100 */
  horse?: Record<AbilityKey, number>;
  /** 等級（S/A+/A/B/C）。指定時は等級段で描画する */
  grades?: AbilityGradeRow;
  /** 既定 1.5〜2x 想定。旧100相当なら 180 前後。 */
  size?: number;
};

const GRADE_TO_RATIO: Record<string, number> = {
  S: 1.0,
  "A+": 0.82,
  A: 0.66,
  B: 0.48,
  C: 0.30,
};

function gradeRatio(grade: string | undefined): number | null {
  if (!grade) return null;
  return GRADE_TO_RATIO[grade] ?? null;
}

/**
 * 能力5項目のみのレーダー（混在オーバーレイをしない）
 */
export function RadarChart({ horse, grades, size = 168 }: Props) {
  const series = horse ?? ({} as Record<AbilityKey, number>);
  const keys = ABILITY_KEYS;
  const rings = [0.25, 0.5, 0.75, 1];
  const value01 = (k: AbilityKey): number => {
    const byGrade = gradeRatio(grades?.[k]);
    if (byGrade != null) return byGrade;
    return clamp01(series[k] ?? 0);
  };
  const points = keys.map((k, i) => ({ key: k, ...pt(value01(k), i) }));
  return (
    <svg
      className="radar"
      viewBox={`0 0 ${VB_SIZE} ${VB_SIZE}`}
      width={size}
      height={size}
      overflow="visible"
      role="img"
      aria-label="5つの能力の相対的な形（0〜100を端までに正規化）"
    >
      <g transform={`translate(${VIEW_PAD},${VIEW_PAD})`}>
      {rings.map((r) => (
        <polygon
          key={r}
          className={`radar__grid${r === 1 ? " radar__grid--outer" : ""}`}
          points={keys.map((_k, i) => {
            const a = -Math.PI / 2 + (2 * Math.PI * i) / 5;
            const x = CX + R_MAX * r * Math.cos(a);
            const y = CY + R_MAX * r * Math.sin(a);
            return `${x},${y}`;
          }).join(" ")}
          fill="none"
        />
      ))}
      {keys.map((k, i) => {
        const a = -Math.PI / 2 + (2 * Math.PI * i) / 5;
        const x2 = CX + R_MAX * Math.cos(a);
        const y2 = CY + R_MAX * Math.sin(a);
        return (
          <line
            key={k}
            className="radar__spoke"
            x1={CX}
            y1={CY}
            x2={x2}
            y2={y2}
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
            fontSize={8}
            fontWeight={600}
          >
            {ABILITY_LABELS[k]}
          </text>
        );
      })}

      <path
        className="radar__area"
        d={pathD(keys, value01)}
        strokeWidth={2.2}
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      {points.map((p) => (
        <circle
          key={p.key}
          className="radar__vertex"
          cx={p.x}
          cy={p.y}
          r={2.4}
          strokeWidth={1.1}
        />
      ))}
      </g>
    </svg>
  );
}
