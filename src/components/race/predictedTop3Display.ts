import type { InvestmentCommentInput } from "../../domain/race-evaluation";

/**
 * enrich が JSON に書く `predicted_probability`（0〜1）。
 * 単勝確率（能力ソフトマックス＋脚質バイアス後の pWin）から `0.1 + pWin×2.2` をクリップした参考値。
 * アプリの「点数」（evaluateRace の adjustedScore）は別パイプラインのため必ずしも連動しない。
 */
export function formatPredictedTop3Percent(inv: InvestmentCommentInput | undefined | null): string {
  const p = inv?.predictedProbability;
  if (p != null && Number.isFinite(p)) return `${(p * 100).toFixed(1)}%`;
  return "—";
}

export function predictedTop3Probability(inv: InvestmentCommentInput | undefined | null): number | null {
  const p = inv?.predictedProbability;
  if (p != null && Number.isFinite(p)) return p;
  return null;
}
