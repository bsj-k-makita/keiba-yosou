/**
 * レース内の相対評価：補正後スコア（条件・適性・能力の合成）を、
 * そのレースで最大のスコアを 100 点とした **比例** の 0〜100 点（整数）にする。
 * 力差が大きいと 90 点と 30 点のように開き、近い能力なら近い点数になる。
 */
export function adjustedScoreToPoints100(
  adjustedScore: number,
  maxAdjustedScoreInRace: number,
): number | null {
  if (!Number.isFinite(adjustedScore) || maxAdjustedScoreInRace <= 0) return null;
  return Math.max(0, Math.min(100, Math.round((adjustedScore / maxAdjustedScoreInRace) * 100)));
}
