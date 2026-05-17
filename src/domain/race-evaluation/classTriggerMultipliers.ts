import type { HorseAbility, RaceCondition } from "./abilityTypes";
import { computeLapShapeFit } from "./lapShapeFit";
import { resolveClassTier } from "./raceClassLevel";
import {
  hasOpenClassStepCredibility,
  isGradedOpenTier,
} from "./resolveEffectiveRaceClass";

const LAP_SHAPE_WEAK_THRESHOLD = 1.5;
const NO_STEP_CREDIBILITY_MULT = 0.85;
const STEP_CREDIBILITY_MULT = 1.06;

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

/**
 * 重賞・OP 向け：intrinsicAbilityScore にトリガー型乗算を適用（第2層・相対化前）。
 */
export function applyClassTriggerToIntrinsic(
  horse: HorseAbility,
  intrinsic: number,
  condition: RaceCondition,
  effectivePace: string,
): number {
  const tier = resolveClassTier(condition);
  if (!isGradedOpenTier(tier)) return intrinsic;

  let score = intrinsic;

  if (hasOpenClassStepCredibility(horse, tier)) {
    score *= STEP_CREDIBILITY_MULT;
  } else {
    score *= NO_STEP_CREDIBILITY_MULT;
  }

  const dist = condition.distance ?? 0;
  const turf = condition.surface !== "ダート";

  if (condition.trackSpeed === "fast" && turf && dist >= 1400 && dist <= 1800) {
    const lapFit = computeLapShapeFit(horse, condition);
    const shapeScore = lapFit.reliable ? lapFit.score : 0;
    if (shapeScore < LAP_SHAPE_WEAK_THRESHOLD) {
      score *= 0.8;
    }
  }

  if (effectivePace === "high" || effectivePace === "many_front_runners") {
    const kickAmp = 1 + clamp(horse.kick, 0, 100) * 0.002;
    score *= kickAmp;
  }

  if (effectivePace === "slow" || effectivePace === "no_front_runner") {
    const sustainAmp = 1 + clamp((horse.stamina + horse.sustain) / 2, 0, 100) * 0.0015;
    score *= sustainAmp;
  }

  return round1(score);
}
