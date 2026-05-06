import type { InvestmentValueRank } from "./abilityTypes";

/**
 * `scripts/lib/investmentSignals.mjs` の toValueRank と同じ帯。
 * 実質期待値（(P×O)−マージン）そのもので閾値を切る。
 *
 * S: 10以上 / A: 8〜10未満 / B: 3〜8未満 / C: 1〜3未満 / D: 1未満
 */
export function valueRankFromEffectiveEv(effectiveEv: number): InvestmentValueRank {
  const ev = Number.isFinite(effectiveEv) ? effectiveEv : 0;
  if (ev >= 10) return "S";
  if (ev >= 8) return "A";
  if (ev >= 3) return "B";
  if (ev >= 1) return "C";
  return "D";
}
