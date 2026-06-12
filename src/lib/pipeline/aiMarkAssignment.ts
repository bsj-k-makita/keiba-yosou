import type {
  HorseAbility,
  HorseScoreResult,
  RaceCondition,
} from "../../domain/race-evaluation/abilityTypes";
import { ANCHOR_MIN_PREDICTED_WIN_RATE } from "../../domain/race-evaluation/investmentEvConstants";
import { BUY_LABELS } from "../../domain/race-evaluation/lingoConstants";
import { sortResultsForPredictionTable } from "../../domain/race-evaluation/markHitAnalysis";
import { resolveEffectiveRaceClass } from "../../domain/race-evaluation/resolveEffectiveRaceClass";

/** 印ロジック改定時に increment（localStorage スナップショットの無効化用） */
export const AI_MARK_LOGIC_VERSION = 2;

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

/** enrich の TS 単勝予測勝率（predicted_win_rate） */
export function tsWinRateOf(horse: HorseAbility | undefined): number {
  const p = horse?.investment?.predictedWinRate;
  return p != null && Number.isFinite(p) ? p : 0;
}

/** enrich の TS 期待値（final_expected_value） */
export function tsExpectedValueOf(horse: HorseAbility | undefined): number {
  const ev = horse?.investment?.finalExpectedValue;
  return ev != null && Number.isFinite(ev) ? ev : Number.NEGATIVE_INFINITY;
}

/** ◎候補の勝率フィルタ: AI勝率8%以上 vs TS勝率8%以上×TS期待値トップ */
export type AnchorHonmeiWinRateRule = "ai" | "ts";

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
function rankByAiEffectiveEv(
  copy: HorseScoreResult[],
  horseById: Map<string, HorseAbility>,
  isG1Race: boolean,
): HorseScoreResult[] {
  return [...copy].sort((a, b) => {
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
}

function pickAnchorHonmei(
  rankedByAiEv: readonly HorseScoreResult[],
  horseById: Map<string, HorseAbility>,
  anchorWinRateRule: AnchorHonmeiWinRateRule,
): HorseScoreResult | undefined {
  if (anchorWinRateRule === "ai") {
    return (
      rankedByAiEv.find((row) => {
        const horse = horseById.get(row.horseId);
        return aiWinRateOf(horse) >= ANCHOR_MIN_PREDICTED_WIN_RATE;
      }) ?? rankedByAiEv[0]
    );
  }

  const tsRanked = [...rankedByAiEv].sort((a, b) => {
    const ha = horseById.get(a.horseId);
    const hb = horseById.get(b.horseId);
    const evDiff = tsExpectedValueOf(hb) - tsExpectedValueOf(ha);
    if (evDiff !== 0) return evDiff;
    const pDiff = tsWinRateOf(hb) - tsWinRateOf(ha);
    if (pDiff !== 0) return pDiff;
    return b.finalEvaluationScore - a.finalEvaluationScore;
  });
  return (
    tsRanked.find((row) => {
      const horse = horseById.get(row.horseId);
      return tsWinRateOf(horse) >= ANCHOR_MIN_PREDICTED_WIN_RATE;
    }) ?? tsRanked[0]
  );
}

export function applyAiMarksByEffectiveEv(
  results: readonly HorseScoreResult[],
  horses: readonly HorseAbility[],
  condition?: RaceCondition,
  anchorWinRateRule: AnchorHonmeiWinRateRule = "ai",
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

  const ranked = rankByAiEffectiveEv(copy, horseById, isG1Race);
  const markCandidates = ranked.filter((row) => {
    const horse = horseById.get(row.horseId) as (HorseAbility & { score?: { isDismissal?: boolean } }) | undefined;
    const isDismissalByScore = horse?.score?.isDismissal === true;
    return !isDismissalByScore && row.buyLabel !== BUY_LABELS.DISMISS;
  });
  const anchor = pickAnchorHonmei(markCandidates, horseById, anchorWinRateRule);
  if (anchor != null) {
    anchor.mark = "◎";
  }
  let slotIndex = 1;
  for (const row of markCandidates) {
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
