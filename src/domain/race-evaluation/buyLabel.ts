import { BUY_LABELS } from "./lingoConstants";
import type { HorseAbility, HorseScoreResult } from "./abilityTypes";
import { shouldBlockHondeCandidate } from "./evaluationSignals";
import { getEffectiveEvaluationSignals } from "./resolveEvaluationSignals";

/**
 * 補正後順位と補正差分から買い判断。複合消し候補は先に上書き済みの result を想定。
 */
export function assignBuyLabels(
  results: HorseScoreResult[],
  dismissIds: Set<string>,
  horses: readonly HorseAbility[],
): void {
  const byId = new Map(horses.map((h) => [h.horseId, h] as const));
  for (const r of results) {
    if (dismissIds.has(r.horseId)) {
      r.buyLabel = BUY_LABELS.DISMISS;
      continue;
    }
    const rank = r.finalRank ?? r.adjustedRank ?? 99;
    const d = r.scoreDiff;

    if (rank === 1) {
      r.buyLabel = BUY_LABELS.FAVORITE;
    } else if (rank === 2) {
      r.buyLabel = BUY_LABELS.RIVAL;
    } else if (rank === 3) {
      r.buyLabel = BUY_LABELS.TAN;
    } else if (rank <= 5) {
      r.buyLabel = d >= 3 ? BUY_LABELS.ANA : BUY_LABELS.GROUP;
    } else {
      r.buyLabel = BUY_LABELS.DISMISS;
    }
  }
  for (const r of results) {
    if (r.buyLabel === BUY_LABELS.DISMISS) continue;
    const h = byId.get(r.horseId);
    if (h && shouldBlockHondeCandidate(getEffectiveEvaluationSignals(h)) && r.buyLabel === BUY_LABELS.FAVORITE) {
      r.buyLabel = BUY_LABELS.GROUP;
    }
  }
}
