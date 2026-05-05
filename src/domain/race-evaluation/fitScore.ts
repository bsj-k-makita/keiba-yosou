import {
  ABILITY_KEYS,
  ABILITY_LABELS,
  type AbilityKey,
  type HorseAbility,
  type WeightSet,
  MAX_WEIGHT,
  MIN_WEIGHT,
} from "./abilityTypes";

/** 補正後重みが大きい順に能力キーを返す（向き解説文など補助表示用） */
export function topAbilityKeysByFinalWeight(weights: WeightSet, take: number): AbilityKey[] {
  return [...ABILITY_KEYS].sort((a, b) => weights[b] - weights[a]).slice(0, take);
}

/** 例: `スピード・持続力` */
export function formatRequiredAbilitiesJa(weights: WeightSet, take: number = 2): string {
  return topAbilityKeysByFinalWeight(weights, take)
    .map((k) => ABILITY_LABELS[k])
    .join("・");
}

/**
 * 重みを「今回の向き（重みの強さ）」として 0〜100 に揃え、馬の能力（0〜100）と同じ目盛りで比較する。
 */
export function weightsToDemand0to100(weights: WeightSet): Record<AbilityKey, number> {
  return {
    speed: ((weights.speed - MIN_WEIGHT) / (MAX_WEIGHT - MIN_WEIGHT)) * 100,
    stamina: ((weights.stamina - MIN_WEIGHT) / (MAX_WEIGHT - MIN_WEIGHT)) * 100,
    kick: ((weights.kick - MIN_WEIGHT) / (MAX_WEIGHT - MIN_WEIGHT)) * 100,
    sustain: ((weights.sustain - MIN_WEIGHT) / (MAX_WEIGHT - MIN_WEIGHT)) * 100,
    power: ((weights.power - MIN_WEIGHT) / (MAX_WEIGHT - MIN_WEIGHT)) * 100,
  };
}

const MAX_L1: number = ABILITY_KEYS.length * 100;

/**
 * fitScore = 1 - (|能力−向き| の合計 / 最大差分)
 * 最大差分は全軸最大乖離（各100）を想定。
 */
export function computeFitScore(
  horse: HorseAbility,
  demand: Record<AbilityKey, number>,
): number {
  let sumAbs = 0;
  for (const k of ABILITY_KEYS) {
    sumAbs += Math.abs(horse[k] - (demand[k] ?? 0));
  }
  const raw = 1 - sumAbs / MAX_L1;
  return Math.max(0, Math.min(1, raw));
}

export type FitLevel = "高" | "中" | "低";

export function fitLevelFromScore(score: number): FitLevel {
  if (score >= 0.72) return "高";
  if (score >= 0.48) return "中";
  return "低";
}

/** 能力5項目の L1 距離（小さいほど同タイプ） */
export function abilityL1Distance(a: HorseAbility, b: HorseAbility): number {
  let d = 0;
  for (const k of ABILITY_KEYS) {
    d += Math.abs(a[k] - b[k]);
  }
  return d;
}

/**
 * 自馬以外で L1 距離が小さい順に返す（カード用「同タイプ」表示）。
 */
export function findL1CloseTypePeers(
  self: HorseAbility,
  all: HorseAbility[],
  take: number,
): HorseAbility[] {
  return all
    .filter((h) => h.horseId !== self.horseId)
    .map((h) => ({ h, d: abilityL1Distance(self, h) }))
    .sort((a, b) => a.d - b.d)
    .slice(0, take)
    .map((row) => row.h);
}
