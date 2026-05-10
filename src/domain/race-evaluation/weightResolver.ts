import {
  ABILITY_KEYS,
  type HorseAbility,
  type RaceCondition,
  type WeightSet,
  MIN_WEIGHT,
  MAX_WEIGHT,
} from "./abilityTypes";
import {
  ADJUSTMENT_STRENGTH,
  GROUND_ADJUSTMENTS,
  PACE_ADJUSTMENTS,
  TRACK_SPEED_ADJUSTMENTS,
} from "./adjustments";
import { applyVenuePhysicalFactorAdjustments } from "./venuePhysicalFactors";
import { getStrategicBaseWeights } from "./strategicWeights";
import type { PaceSeverityKind } from "./paceSeverity";

function emptyDelta(): WeightSet {
  return { speed: 0, stamina: 0, kick: 0, sustain: 0, power: 0 };
}

function deltaFrom(
  map: Record<string, { adjustment: WeightSet }>,
  key: string,
): WeightSet {
  return map[key]?.adjustment ?? emptyDelta();
}

/**
 * 能力プリセット（abilityPriority）を適用する。
 * 対象能力のウェイトを 1.5 倍にし、合計が 1.0 になるよう再正規化する。
 * "stamina" プリセットは stamina と sustain の両方を 1.5 倍にする
 *（スタミナ/持続重視の意図に合わせたセット適用）。
 */
function applyAbilityPriority(
  weights: WeightSet,
  priority: RaceCondition["abilityPriority"],
): WeightSet {
  if (!priority) return weights;

  const out: WeightSet = { ...weights };
  const BOOST = 1.5;

  if (priority === "stamina") {
    out.stamina = out.stamina * BOOST;
    out.sustain = out.sustain * BOOST;
  } else {
    out[priority] = out[priority] * BOOST;
  }

  return normalizeWeights(out);
}

function applyAbilityFocusDoubling(weights: WeightSet, condition: RaceCondition): WeightSet {
  const focus = condition.abilityFocus;
  if (!focus) return weights;
  let touched = false;
  const out: WeightSet = { ...weights };
  for (const key of ABILITY_KEYS) {
    if (focus[key]) {
      // ユーザーの明示的意思を最終順位に直結させるため、重点項目は 3 倍で押し込む。
      out[key] *= 3;
      touched = true;
    }
  }
  if (!touched) return weights;
  return normalizeWeights(clampWeights(out));
}

export function getBaseWeights(condition: RaceCondition): WeightSet {
  const strategic = getStrategicBaseWeights(condition);
  return applyAbilityPriority({ ...strategic }, condition.abilityPriority);
}

export function applyAdjustments(
  base: WeightSet,
  adjustments: WeightSet[],
  strength: number,
): WeightSet {
  const out: WeightSet = { ...base };
  for (const key of ABILITY_KEYS) {
    let sumDelta = 0;
    for (const adj of adjustments) {
      sumDelta += adj[key];
    }
    out[key] = base[key] + strength * sumDelta;
  }
  return out;
}

export function clampWeights(weights: WeightSet): WeightSet {
  const out = { ...weights };
  for (const key of ABILITY_KEYS) {
    const v = out[key];
    out[key] = Math.min(MAX_WEIGHT, Math.max(MIN_WEIGHT, v));
  }
  return out;
}

export function normalizeWeights(weights: WeightSet): WeightSet {
  let sum = 0;
  for (const key of ABILITY_KEYS) {
    sum += weights[key];
  }
  if (sum <= 0) {
    const uniform = 1 / ABILITY_KEYS.length;
    return {
      speed: uniform,
      stamina: uniform,
      kick: uniform,
      sustain: uniform,
      power: uniform,
    };
  }
  const out: WeightSet = { ...weights };
  for (const key of ABILITY_KEYS) {
    out[key] = out[key] / sum;
  }
  return out;
}

/**
 * 馬場傾向（bias）はデルタ加算＋正規化だと変化が薄れるため、
 * ground / pace / 時計とは別に、正規化後に軸別倍率で効かせる。
 */
const BIAS_MULT_BY_STRENGTH: Record<RaceCondition["adjustmentStrength"], number> = {
  weak: 1.1,
  middle: 1.22,
  strong: 1.34,
};

export function applyBiasMultiplicativeTilt(weights: WeightSet, condition: RaceCondition): WeightSet {
  const bias = condition.bias ?? "flat";
  if (bias === "flat") return weights;

  const m = BIAS_MULT_BY_STRENGTH[condition.adjustmentStrength] ?? 1.22;
  const soften = 1 / Math.sqrt(m);
  const out: WeightSet = { ...weights };

  switch (bias) {
    case "closer_favor":
      out.kick *= m;
      out.sustain *= 1 + (m - 1) * 0.5;
      out.speed *= soften;
      out.power *= soften;
      break;
    case "front_favor":
      out.speed *= m;
      out.sustain *= 1 + (m - 1) * 0.45;
      out.kick *= soften;
      break;
    case "inside_favor":
      out.speed *= 1 + (m - 1) * 0.55;
      out.sustain *= 1 + (m - 1) * 0.35;
      out.kick *= soften;
      break;
    case "outside_favor":
      out.kick *= 1 + (m - 1) * 0.55;
      out.sustain *= 1 + (m - 1) * 0.4;
      out.speed *= soften;
      break;
    default:
      return weights;
  }

  return normalizeWeights(clampWeights(out));
}

export function getFinalWeights(condition: RaceCondition): WeightSet {
  const baseRaw = getBaseWeights(condition);
  const base = applyVenuePhysicalFactorAdjustments(baseRaw, condition);
  const legacyTrackSpeed =
    condition.trackSpeed ??
    (condition.ground === "fast_track" ? "fast" : condition.ground === "slow_track" ? "slow" : "standard");
  const normalizedGround =
    condition.ground === "fast_track" || condition.ground === "slow_track"
      ? "good"
      : condition.ground;
  const adjustments: WeightSet[] = [
    deltaFrom(GROUND_ADJUSTMENTS, normalizedGround),
    deltaFrom(TRACK_SPEED_ADJUSTMENTS, legacyTrackSpeed),
    deltaFrom(PACE_ADJUSTMENTS, condition.pace),
  ];
  const strength = ADJUSTMENT_STRENGTH[condition.adjustmentStrength];
  const merged = applyAdjustments(base, adjustments, strength);
  const clamped = clampWeights(merged);
  const normalized = normalizeWeights(clamped);
  const biasTilted = applyBiasMultiplicativeTilt(normalized, condition);
  return applyAbilityFocusDoubling(biasTilted, condition);
}

/**
 * ペース激化指数に応じて、末脚・先行の能力ウェイトを微調整（脚質連動の動的ウェイト）。
 */
export function amplifyWeightsForPaceSeverity(
  weights: WeightSet,
  horse: HorseAbility,
  severity: PaceSeverityKind,
): WeightSet {
  if (severity === "neutral") return weights;

  const style = horse.runningStyle;
  const out: WeightSet = { ...weights };
  const AMP = 1.2;

  if (severity === "high" && (style === "差し" || style === "追込")) {
    out.kick *= AMP;
    out.sustain *= AMP;
    out.stamina *= AMP;
  } else if (
    severity === "slow" &&
    (style === "逃げ" || style === "先行" || style === "好位")
  ) {
    out.speed *= AMP;
    out.sustain *= AMP;
    out.stamina *= 1.15;
  }

  return normalizeWeights(clampWeights(out));
}

export function getFinalWeightsForHorse(
  condition: RaceCondition,
  horse: HorseAbility,
  severity: PaceSeverityKind,
): WeightSet {
  const base = getFinalWeights(condition);
  return amplifyWeightsForPaceSeverity(base, horse, severity);
}

export function calcHorseScore(horse: HorseAbility, weights: WeightSet): number {
  let score = 0;
  for (const key of ABILITY_KEYS) {
    score += horse[key] * weights[key];
  }
  return score;
}

/** 5 軸の単純平均。「馬そのものの強さ」の土台として条件加重前に使う。 */
export function meanAbilityScore(horse: HorseAbility): number {
  let s = 0;
  for (const key of ABILITY_KEYS) {
    s += horse[key];
  }
  return s / ABILITY_KEYS.length;
}
