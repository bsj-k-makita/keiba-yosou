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
  BIAS_ADJUSTMENTS,
  GROUND_ADJUSTMENTS,
  PACE_ADJUSTMENTS,
  TRACK_SPEED_ADJUSTMENTS,
} from "./adjustments";
import { BASE_COURSE_WEIGHTS, DEFAULT_VENUE_KEY } from "./courseWeights";
import { applyVenuePhysicalFactorAdjustments } from "./venuePhysicalFactors";

function emptyDelta(): WeightSet {
  return { speed: 0, stamina: 0, kick: 0, sustain: 0, power: 0 };
}

function deltaFrom(
  map: Record<string, { adjustment: WeightSet }>,
  key: string,
): WeightSet {
  return map[key]?.adjustment ?? emptyDelta();
}

export function getBaseWeights(condition: RaceCondition): WeightSet {
  const venueKey = condition.courseKey ?? condition.venue;
  const base = BASE_COURSE_WEIGHTS[venueKey] ?? BASE_COURSE_WEIGHTS[DEFAULT_VENUE_KEY];
  if (!base) {
    throw new Error(`No base weights for venue: ${venueKey}`);
  }
  return { ...base };
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
    deltaFrom(BIAS_ADJUSTMENTS, condition.bias),
    deltaFrom(PACE_ADJUSTMENTS, condition.pace),
  ];
  const strength = ADJUSTMENT_STRENGTH[condition.adjustmentStrength];
  const merged = applyAdjustments(base, adjustments, strength);
  const clamped = clampWeights(merged);
  return normalizeWeights(clamped);
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
