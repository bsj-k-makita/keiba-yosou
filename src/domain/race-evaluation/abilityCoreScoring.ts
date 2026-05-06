import { ABILITY_KEYS, type HorseAbility, type RaceCondition, type WeightSet } from "./abilityTypes";
import { reproducibilityDelta, riskPenaltyPoints } from "./evaluationSignals";
import { getEffectiveEvaluationSignals } from "./resolveEvaluationSignals";
import { calcHorseScore, meanAbilityScore } from "./weightResolver";
import type { MaxPerfResult } from "./maxPerformance";

/**
 * 5軸平均 × 0.75 + 上位2軸平均 × 0.25（言語定義の「基礎能力」用ブレンド）
 */
export function baseAbilityCore(horse: HorseAbility): number {
  const m = meanAbilityScore(horse);
  const vals = ABILITY_KEYS.map((k) => horse[k]).sort((a, b) => b - a);
  const top2 = (vals[0]! + vals[1]!) / 2;
  return m * 0.75 + top2 * 0.25;
}

/**
 * 再現性・大敗ペナルティ適用後の「基礎能力」表示用スコア（0〜100 想定域に収める）
 */
export function intrinsicAbilityWithAdjustments(horse: HorseAbility): number {
  const base = baseAbilityCore(horse);
  const eff = getEffectiveEvaluationSignals(horse);
  const r = reproducibilityDelta(eff);
  const p = riskPenaltyPoints(eff);
  return base + r - p;
}

/**
 * 条件に依存しない素点。weight は既に正規化済みを想定。
 */
export function conditionScore(horse: HorseAbility, finalWeights: WeightSet): number {
  return calcHorseScore(horse, finalWeights);
}

type MixWeights = {
  base: number;
  condition: number;
  maxPerf: number;
};

const MIX_BY_STRENGTH: Record<RaceCondition["adjustmentStrength"], { withoutMax: MixWeights; withMax: MixWeights }> = {
  weak: {
    withoutMax: { base: 0.45, condition: 0.55, maxPerf: 0 },
    withMax: { base: 0.35, condition: 0.45, maxPerf: 0.20 },
  },
  middle: {
    withoutMax: { base: 0.30, condition: 0.70, maxPerf: 0 },
    withMax: { base: 0.20, condition: 0.65, maxPerf: 0.15 },
  },
  strong: {
    withoutMax: { base: 0.10, condition: 0.90, maxPerf: 0 },
    // strongはユーザーの舞台設定を最優先し、Intrinsic:Condition=10:90を固定する。
    withMax: { base: 0.10, condition: 0.90, maxPerf: 0.00 },
  },
};

/**
 * レース内相対化の前の合成分。
 * 補正強度に応じて intrinsic と条件適性の比率を切り替える。
 */
export function raceAdjustedMix(
  basePortion: number,
  conditionPortion: number,
  strength: RaceCondition["adjustmentStrength"] = "middle",
): number {
  const mix = MIX_BY_STRENGTH[strength].withoutMax;
  return mix.base * basePortion + mix.condition * conditionPortion;
}

/**
 * 相対化の入力。precomputed な intrinsic と conditionScore を受け取る。
 * maxPerf が reliable の場合は強度別の withMax 配合を使い、
 * 非 reliable 時は withoutMax 配合を使う。
 */
export function raceAdjustedInput(
  intrinsicScore: number,
  conditionScoreValue: number,
  maxPerf?: MaxPerfResult,
  classLevelBonus: number = 0,
  strength: RaceCondition["adjustmentStrength"] = "middle",
): number {
  const classMix = classLevelBonus * 0.9;
  const profile = MIX_BY_STRENGTH[strength];
  if (maxPerf?.reliable) {
    const mix = profile.withMax;
    return (
      mix.base * intrinsicScore +
      mix.condition * conditionScoreValue +
      mix.maxPerf * maxPerf.score +
      classMix
    );
  }
  const mix = profile.withoutMax;
  return mix.base * intrinsicScore + mix.condition * conditionScoreValue + classMix;
}
