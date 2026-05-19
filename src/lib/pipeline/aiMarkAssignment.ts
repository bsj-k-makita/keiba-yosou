import type { HorseAbility, HorseScoreResult } from "../../domain/race-evaluation/abilityTypes";
import { sortResultsForPredictionTable } from "../../domain/race-evaluation/markHitAnalysis";

/** 方針B: ai_effective_ev 降順で付与する印（7頭固定） */
export const AI_MARK_SLOTS: readonly HorseScoreResult["mark"][] = [
  "◎",
  "○",
  "▲",
  "☆",
  "△",
  "△",
  "△",
];

function aiEffectiveEvOf(horse: HorseAbility | undefined): number {
  const ev = horse?.aiEffectiveEv;
  return ev != null && Number.isFinite(ev) ? ev : Number.NEGATIVE_INFINITY;
}

function aiWinRateOf(horse: HorseAbility | undefined): number {
  const p = horse?.aiPredictedWinRate;
  return p != null && Number.isFinite(p) ? p : 0;
}

/**
 * 全出走馬に ai_predicted_win_rate と ai_effective_ev が揃っているか。
 * 1頭でも欠損なら AI モードは使わず TS にフォールバックする。
 */
export function raceHasFullAiBackfill(horses: readonly HorseAbility[]): boolean {
  if (horses.length === 0) return false;
  return horses.every((h) => {
    const rate = h.aiPredictedWinRate;
    const ev = h.aiEffectiveEv;
    return (
      rate != null &&
      Number.isFinite(rate) &&
      rate >= 0 &&
      ev != null &&
      Number.isFinite(ev)
    );
  });
}

/** 予測勝率％横のラベル（TS / AI） */
export function probabilityWinRateSuffix(engine: "ts" | "ai"): string {
  return engine === "ai" ? "（AI Calibrated）" : "（softmax）";
}

/**
 * 方針B: ai_effective_ev 降順で ◎○▲☆ と △ を機械的に再割当（TS 印は破棄）。
 */
export function applyAiMarksByEffectiveEv(
  results: readonly HorseScoreResult[],
  horses: readonly HorseAbility[],
): HorseScoreResult[] {
  const horseById = new Map(horses.map((h) => [h.horseId, h] as const));
  const copy = results.map((r) => ({ ...r, mark: "" as HorseScoreResult["mark"] }));

  const ranked = [...copy].sort((a, b) => {
    const ha = horseById.get(a.horseId);
    const hb = horseById.get(b.horseId);
    const evDiff = aiEffectiveEvOf(hb) - aiEffectiveEvOf(ha);
    if (evDiff !== 0) return evDiff;
    const pDiff = aiWinRateOf(hb) - aiWinRateOf(ha);
    if (pDiff !== 0) return pDiff;
    return b.finalEvaluationScore - a.finalEvaluationScore;
  });

  for (let i = 0; i < ranked.length; i += 1) {
    const row = ranked[i]!;
    row.mark = i < AI_MARK_SLOTS.length ? AI_MARK_SLOTS[i]! : "";
  }

  return copy;
}

/** 出馬表の並び（◎→○→▲→☆→△…、印なしは枠順） */
export function sortResultsForAiDisplay(
  results: readonly HorseScoreResult[],
  gateOrderHorseIds: readonly string[],
): HorseScoreResult[] {
  return sortResultsForPredictionTable(results, gateOrderHorseIds);
}

/** @deprecated sortResultsForAiDisplay を使用 */
export function sortResultsByAiEffectiveEv(
  results: readonly HorseScoreResult[],
  _horses: readonly HorseAbility[],
  gateOrderHorseIds: readonly string[] = [],
): HorseScoreResult[] {
  return sortResultsForAiDisplay(results, gateOrderHorseIds);
}
