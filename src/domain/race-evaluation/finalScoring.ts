import { PACE_FIT, type PaceFitToken } from "./lingoConstants";

/** 展開適合（◎〜×）の加点。能力5軸は変更しない。 */
const PACE_BONUS: Record<PaceFitToken, number> = {
  [PACE_FIT.PERFECT]: 5,
  [PACE_FIT.FIT]: 2,
  [PACE_FIT.MAYBE]: 0,
  [PACE_FIT.BAD]: -5,
};

/**
 * 前残り×スロー×追込の合成ペナルティ（トークンは × のまま、点数のみ一段深くする）。
 */
export const PACE_FIT_EXTREME_BAD_BONUS = -10;

const REL_MIN = 30;
const REL_MAX = 90;
const Z_SCALE = 12;
const STD_FLOOR = 1.5;
const REL_STRONG_MIN = 0;
const REL_STRONG_MAX = 100;

export type RelativeScoreMode = "normalized" | "preserve_absolute" | "absolute_delta";

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

function mean(nums: number[]): number {
  if (nums.length === 0) return 0;
  return nums.reduce((a, b) => a + b, 0) / nums.length;
}

function stddev(nums: number[], m: number): number {
  if (nums.length <= 1) return 0;
  const v = nums.reduce((s, x) => s + (x - m) ** 2, 0) / (nums.length - 1);
  return Math.sqrt(v);
}

/**
 * 同一レース内の `raceAdjustedInput` を z-score 正規化（50±8σ、35〜85）、
 * 分散が小さいときは min-max（同レンジ）にフォールバック。
 */
export function computeRaceRelativeScores(
  rows: readonly { horseId: string; raceAdjustedInput: number }[],
  mode: RelativeScoreMode = "normalized",
): Map<string, number> {
  const out = new Map<string, number>();
  if (rows.length === 0) return out;
  const values = rows.map((r) => r.raceAdjustedInput);
  if (mode === "preserve_absolute") {
    const min = Math.min(...values);
    const max = Math.max(...values);
    const span = max - min;
    for (const { horseId, raceAdjustedInput: x } of rows) {
      const t = span < 1e-9 ? 0.5 : (x - min) / span;
      const rel = REL_STRONG_MIN + t * (REL_STRONG_MAX - REL_STRONG_MIN);
      out.set(horseId, round1(rel));
    }
    return out;
  }
  if (mode === "absolute_delta") {
    const pivot = mean(values);
    const ABSOLUTE_SCALE = 6.0;
    for (const { horseId, raceAdjustedInput: x } of rows) {
      const rel = Math.max(REL_STRONG_MIN, Math.min(REL_STRONG_MAX, 50 + (x - pivot) * ABSOLUTE_SCALE));
      out.set(horseId, round1(rel));
    }
    return out;
  }
  const m = mean(values);
  const s = stddev(values, m);

  if (s < 1e-9) {
    for (const { horseId } of rows) {
      out.set(horseId, 50);
    }
    return out;
  }

  if (s < STD_FLOOR) {
    const min = Math.min(...values);
    const max = Math.max(...values);
    const span = max - min;
    for (const { horseId, raceAdjustedInput: x } of rows) {
      const t = span < 1e-9 ? 0.5 : (x - min) / span;
      const rel = REL_MIN + t * (REL_MAX - REL_MIN);
      out.set(horseId, round1(rel));
    }
    return out;
  }

  for (const { horseId, raceAdjustedInput: x } of rows) {
    const z = (x - m) / s;
    const rel = Math.max(REL_MIN, Math.min(REL_MAX, 50 + z * Z_SCALE));
    out.set(horseId, round1(rel));
  }
  return out;
}

export function paceFitToBonus(token: PaceFitToken): number {
  return PACE_BONUS[token] ?? 0;
}

/**
 * 相対＋展開＋ラップ形状一致＋分散ペナルティ。
 * 仕様上のレンジ外もあり得るため、表示用に穏当にクランプ。
 * lapShapeFitBonus: reliable でない場合は 0 を渡す。
 * variancePenalty: 判定不能の場合は 0 を渡す。
 */
export function combineFinalEvaluationScore(
  relative: number,
  paceBonus: number,
  lapShapeFitBonus: number = 0,
  distanceFitBonus: number = 0,
  classLevelBonus: number = 0,
  variancePenalty: number = 0,
  contextualBonus: number = 0,
  conditionImpactBonus: number = 0,
): number {
  return round1(
    Math.max(
      0,
      Math.min(
        100,
        relative +
          paceBonus +
          lapShapeFitBonus +
          distanceFitBonus +
          classLevelBonus +
          conditionImpactBonus +
          contextualBonus -
          variancePenalty,
      ),
    ),
  );
}
