import { ABILITY_KEYS, type HorseAbility, type WeightSet } from "./abilityTypes";
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

// データなしフォールバック: 基礎45% + 条件55%（条件感度を高めるため条件寄りに）
const RACE_ADJ_BASE = 0.45;
const RACE_ADJ_COND = 0.55;
// MAX性能あり: 基礎35% + 条件45% + MAX20%
const RACE_ADJ_BASE_MAX = 0.35;
const RACE_ADJ_COND_MAX = 0.45;
const RACE_ADJ_MAXPERF = 0.20;

/**
 * レース内相対化の前の合成分（フォールバック: 基礎 60% ＋ 今回条件 40%）
 */
export function raceAdjustedMix(
  basePortion: number,
  conditionPortion: number,
): number {
  return RACE_ADJ_BASE * basePortion + RACE_ADJ_COND * conditionPortion;
}

/**
 * 相対化の入力。precomputed な intrinsic と conditionScore を受け取る。
 * maxPerf が reliable のとき: 基礎50% + 条件30% + MAX20%
 * それ以外: 基礎60% + 条件40%（従来と同等）
 */
export function raceAdjustedInput(
  intrinsicScore: number,
  conditionScoreValue: number,
  maxPerf?: MaxPerfResult,
  classLevelBonus: number = 0,
): number {
  const classMix = classLevelBonus * 0.9;
  if (maxPerf?.reliable) {
    return (
      RACE_ADJ_BASE_MAX * intrinsicScore +
      RACE_ADJ_COND_MAX * conditionScoreValue +
      RACE_ADJ_MAXPERF * maxPerf.score +
      classMix
    );
  }
  return RACE_ADJ_BASE * intrinsicScore + RACE_ADJ_COND * conditionScoreValue + classMix;
}
