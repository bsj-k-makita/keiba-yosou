import type { HorseAbility, HorseScoreResult } from "./abilityTypes";

/**
 * 第4層: オッズの歪み（割安感）検知。
 *
 * 「第1層（能力）が高いが、近走は展開不適合で惨敗し、オッズが割安（期待値が高い）」
 * になっている馬を特定する。論文ベースの ER>1 シグナルの実装版。
 *
 * - flag: 強い歪みが検出された（buyLabel の ANA 厳密化に使用）
 * - score01: 0〜1。歪みの強さ。
 * - probabilityBoost: 0〜0.45。viewModel が確率を引き上げる係数（multiplicative 範囲）。
 *   effectiveEv / kellyFraction の補正に使用。
 */
export type OddsDistortionResult = {
  flag: boolean;
  score01: number;
  probabilityBoost: number;
  reasons: string[];
};

const NEUTRAL_RESULT: OddsDistortionResult = {
  flag: false,
  score01: 0,
  probabilityBoost: 0,
  reasons: [],
};

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function oddsOf(horse: HorseAbility): number | null {
  const fromInvestment = horse.investment?.actualOdds;
  if (fromInvestment != null && Number.isFinite(fromInvestment) && fromInvestment > 1) {
    return fromInvestment;
  }
  const fromSignal = horse.signals?.winOdds;
  if (fromSignal != null && Number.isFinite(fromSignal) && fromSignal > 1) {
    return fromSignal;
  }
  return null;
}

function intrinsicPercentile(
  result: HorseScoreResult,
  fieldResults: readonly HorseScoreResult[],
): number {
  if (fieldResults.length === 0) return 0.5;
  const sorted = [...fieldResults]
    .map((r) => r.intrinsicAbilityScore)
    .sort((a, b) => a - b);
  let below = 0;
  for (const v of sorted) {
    if (v < result.intrinsicAbilityScore) below += 1;
  }
  return below / sorted.length;
}

function recentPaceMismatchSignal(horse: HorseAbility): number {
  let signal = 0;
  if (horse.bias_mismatch === true) signal += 0.5;
  if (horse.pace_mismatch === true) signal += 0.5;
  if (horse.was_bias_disadvantaged === true) signal += 0.4;
  const last = horse.pastRuns?.[0];
  if (last != null) {
    const margin = last.marginToWinnerSec ?? 0;
    const place = last.place ?? 0;
    const kickRank = last.final3fRank ?? 99;
    if (margin >= 1.5 && kickRank <= 3) signal += 0.4;
    if (place >= 8 && kickRank <= 3) signal += 0.3;
  }
  return clamp(signal, 0, 1);
}

/**
 * 1 馬あたりの「オッズの歪み」を検知する。
 *
 * 必要な3条件:
 *  A) 第1層（能力）が高い: intrinsicAbilityScore が field 70 percentile 以上
 *  B) 近走で展開不適合の惨敗 or バイアス/ペース不一致の痕跡（recentPaceMismatchSignal >= 0.4）
 *  C) オッズが割安: estimatedFairProb × odds >= 1.4 （= 期待値ベースで +40% 以上）
 *
 * すべて満たすと flag = true。strength は条件のスムーズな積。
 *
 * `baselineProbability` は後続の softmax/normalize で計算した確率を渡す。
 * 確率が無い preview ステージでは 0 を渡してよい（その場合は flag のみ参照される）。
 */
export function detectOddsDistortion(
  horse: HorseAbility,
  result: HorseScoreResult,
  fieldResults: readonly HorseScoreResult[],
  baselineProbability: number,
): OddsDistortionResult {
  const odds = oddsOf(horse);
  if (odds == null) return NEUTRAL_RESULT;

  const ability01 = intrinsicPercentile(result, fieldResults);
  const mismatch01 = recentPaceMismatchSignal(horse);
  const evRatio = baselineProbability > 0 ? baselineProbability * odds : odds / 30;
  const cheap01 = clamp((evRatio - 1.4) / 0.6, 0, 1);

  const reasons: string[] = [];
  if (ability01 >= 0.7) reasons.push(`能力上位${Math.round(ability01 * 100)}%`);
  if (mismatch01 >= 0.4) reasons.push("近走の展開不適合");
  if (evRatio >= 1.4) reasons.push(`割安オッズ(EV比 ${evRatio.toFixed(2)})`);

  const score01 = clamp(
    ((ability01 - 0.5) * 2) * 0.4 + mismatch01 * 0.3 + cheap01 * 0.3,
    0,
    1,
  );

  const flag = ability01 >= 0.7 && mismatch01 >= 0.4 && cheap01 > 0;
  // 確率ブースト: 最大 +45%（kellyFractionFrom の上限 0.4 を超えない範囲で効く）
  const probabilityBoost = round2(clamp(score01 * 0.45, 0, 0.45));

  return {
    flag,
    score01: round2(score01),
    probabilityBoost,
    reasons,
  };
}
