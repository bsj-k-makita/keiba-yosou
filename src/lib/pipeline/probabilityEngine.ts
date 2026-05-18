import type { HorseAbility } from "../../domain/race-evaluation/abilityTypes";

/** 勝率ソース: TS Softmax（既定） or Python ML バックフィル（ai_* JSON） */
export type ProbabilityEngine = "ts" | "ai";

export function parseProbabilityEngine(raw: string | null | undefined): ProbabilityEngine {
  return raw === "ai" ? "ai" : "ts";
}

export function probabilityEngineLabel(engine: ProbabilityEngine): string {
  return engine === "ai" ? "Python AI" : "TS 評価";
}

export function raceHasAiPredictions(horses: readonly HorseAbility[]): boolean {
  return horses.some(
    (h) =>
      h.aiPredictedWinRate != null &&
      Number.isFinite(h.aiPredictedWinRate) &&
      h.aiPredictedWinRate >= 0,
  );
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
  if (requestedEngine === "ai" && raceHasAiPredictions(horses)) {
    const aiMap = buildAiProbabilityMap(horses);
    if (aiMap.size > 0) {
      return { probabilities: aiMap, engineUsed: "ai" };
    }
  }
  return {
    probabilities: new Map(tsProbabilities),
    engineUsed: "ts",
  };
}
