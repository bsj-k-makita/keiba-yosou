import type {
  HorseAbility,
  HorseScoreResult,
  RaceCondition,
} from "../../domain/race-evaluation/abilityTypes";
import { ANCHOR_MIN_PREDICTED_WIN_RATE } from "../../domain/race-evaluation/investmentEvConstants";
import { sortResultsForPredictionTable } from "../../domain/race-evaluation/markHitAnalysis";
import { resolveEffectiveRaceClass } from "../../domain/race-evaluation/resolveEffectiveRaceClass";

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

/** G1時は EV に能力軸をブレンドする（調整用） */
export const G1_HYBRID_FINAL_EVAL_WEIGHT = 0.1;

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
  condition?: RaceCondition,
): HorseScoreResult[] {
  const horseById = new Map(horses.map((h) => [h.horseId, h] as const));
  const copy = results.map((r) => ({ ...r, mark: "" as HorseScoreResult["mark"] }));
  const isG1Race =
    condition != null &&
    resolveEffectiveRaceClass({
      raceName: condition.raceName,
      raceGrade: condition.raceGrade,
      netkeibaGradeType: condition.netkeibaGradeType,
    }) === "G1_CLASS";

  const ranked = [...copy].sort((a, b) => {
    const ha = horseById.get(a.horseId);
    const hb = horseById.get(b.horseId);
    const scoreA = isG1Race
      ? aiEffectiveEvOf(ha) + (a.finalEvaluationScore / 100) * G1_HYBRID_FINAL_EVAL_WEIGHT
      : aiEffectiveEvOf(ha);
    const scoreB = isG1Race
      ? aiEffectiveEvOf(hb) + (b.finalEvaluationScore / 100) * G1_HYBRID_FINAL_EVAL_WEIGHT
      : aiEffectiveEvOf(hb);
    const scoreDiff = scoreB - scoreA;
    if (scoreDiff !== 0) return scoreDiff;
    const pDiff = aiWinRateOf(hb) - aiWinRateOf(ha);
    if (pDiff !== 0) return pDiff;
    return b.finalEvaluationScore - a.finalEvaluationScore;
  });

  // 勝率8%未満は◎候補から除外し、相手印にのみ割り当てる。
  const anchor = ranked.find((row) => {
    const horse = horseById.get(row.horseId);
    return aiWinRateOf(horse) >= ANCHOR_MIN_PREDICTED_WIN_RATE;
  }) ?? ranked[0];
  if (anchor != null) {
    anchor.mark = "◎";
  }
  let slotIndex = 1; // ○から埋める（◎は floor 通過馬のみ）
  for (const row of ranked) {
    if (anchor != null && row.horseId === anchor.horseId) continue;
    row.mark = slotIndex < AI_MARK_SLOTS.length ? AI_MARK_SLOTS[slotIndex]! : "";
    slotIndex += 1;
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
