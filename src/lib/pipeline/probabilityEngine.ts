import type { HorseAbility } from "../../domain/race-evaluation/abilityTypes";
import { raceHasFullAiBackfill } from "./aiMarkAssignment";

export {
  raceHasFullAiBackfill,
  applyAiMarksByEffectiveEv,
  sortResultsForAiDisplay,
  sortResultsByAiEffectiveEv,
  AI_MARK_SLOTS,
  probabilityWinRateSuffix,
} from "./aiMarkAssignment";

export {
  resolveAiRaceRegime,
  clearMarksOnResults,
  NO_EV_REGIME_BANNER_TEXT,
  type AiRaceRegime,
} from "./aiEvRegime";

/** 勝率ソース: TS Softmax or Python ML バックフィル（ai_* JSON） */
export type ProbabilityEngine = "ts" | "ai";

/** レース詳細の既定エンジン（URL 未指定時） */
export const DEFAULT_PROBABILITY_ENGINE: ProbabilityEngine = "ai";

export function parseProbabilityEngine(raw: string | null | undefined): ProbabilityEngine {
  if (raw === "ts") return "ts";
  if (raw === "ai") return "ai";
  return DEFAULT_PROBABILITY_ENGINE;
}

export function probabilityEngineLabel(engine: ProbabilityEngine): string {
  return engine === "ai" ? "Python AI" : "TS 評価";
}

/** 1頭でも ai_* があれば true（後方互換・一覧用） */
export function raceHasAiPredictions(horses: readonly HorseAbility[]): boolean {
  return horses.some(
    (h) =>
      h.aiPredictedWinRate != null &&
      Number.isFinite(h.aiPredictedWinRate) &&
      h.aiPredictedWinRate >= 0,
  );
}

/** AI 完全連動モードに必要なフルバックフィル（全頭 ai_predicted_win_rate + ai_effective_ev） */
export function raceHasAiEngineReady(horses: readonly HorseAbility[]): boolean {
  return raceHasFullAiBackfill(horses);
}

/** JSON の ai_predicted_win_rate を horseId キーで返す（レース内正規化済み想定） */
export function buildAiProbabilityMap(horses: readonly HorseAbility[]): Map<string, number> {
  const map = new Map<string, number>();
  for (const h of horses) {
    const rate = h.aiPredictedWinRate;
    if (rate == null || !Number.isFinite(rate) || rate < 0) continue;
    map.set(h.horseId, rate);
  }
  return map;
}

export type ResolvedProbabilities = {
  probabilities: Map<string, number>;
  engineUsed: ProbabilityEngine;
};

/**
 * 表示・馬券 EV 用の勝率 Map。
 * engine=ai かつ ai_* が無い馬のみいる場合は TS にフォールバック。
 */
export function resolveAdjustedProbabilities(
  horses: readonly HorseAbility[],
  tsProbabilities: ReadonlyMap<string, number>,
  requestedEngine: ProbabilityEngine,
): ResolvedProbabilities {
  if (requestedEngine === "ai" && raceHasFullAiBackfill(horses)) {
    const aiMap = buildAiProbabilityMap(horses);
    if (aiMap.size === horses.length) {
      return { probabilities: aiMap, engineUsed: "ai" };
    }
  }
  return {
    probabilities: new Map(tsProbabilities),
    engineUsed: "ts",
  };
}
