import { evaluateRace, type HorseAbility, type RaceCondition, type HorseScoreResult } from "../../domain/race-evaluation";
import { ensureFrontendDisplayMarks } from "../race-display/ensureFrontendDisplayMarks";
import {
  buildRaceEvaluationViewModel,
  type RaceEvaluationViewModel,
} from "../../viewModel/raceEvaluationViewModel";
import { effectiveSoftmaxTemperature, softmaxDistribution } from "./normalization";
import {
  type ProbabilityEngine,
  resolveAdjustedProbabilities,
} from "./probabilityEngine";

export type EvaluationPipelineOptions = {
  probabilityEngine?: ProbabilityEngine;
};

export type EvaluationPipelineResult = {
  results: HorseScoreResult[];
  viewModel: RaceEvaluationViewModel;
  adjustedProbabilities: Map<string, number>;
  /** 実際に勝率表示・馬券 EV に使ったエンジン（ai 要求時データ無しなら ts） */
  probabilityEngine: ProbabilityEngine;
  /** 数学的1位と表示◎が不一致のとき true（馬券生成をスキップ） */
  isSkippableRace: boolean;
  mathFirstHorseId?: string;
  displayFavoriteHorseId?: string;
};

function mathFirstByFinalRank(results: readonly HorseScoreResult[]): HorseScoreResult | undefined {
  return [...results].sort((a, b) => {
    const ra = a.finalRank ?? 99;
    const rb = b.finalRank ?? 99;
    if (ra !== rb) return ra - rb;
    return b.finalEvaluationScore - a.finalEvaluationScore;
  })[0];
}

export function runRaceEvaluationPipeline(
  horses: readonly HorseAbility[],
  condition: RaceCondition,
  options?: EvaluationPipelineOptions,
): EvaluationPipelineResult {
  const raw = evaluateRace([...horses], condition);
  const results = ensureFrontendDisplayMarks(raw, horses, condition);
  const temperature = effectiveSoftmaxTemperature(
    condition.softmaxTemperature,
    condition.adjustmentStrength,
  );
  const tsProbabilities = softmaxDistribution(
    results.map((row) => ({ horseId: row.horseId, score: row.finalEvaluationScore })),
    temperature,
  );

  const requestedEngine = options?.probabilityEngine ?? "ts";
  const { probabilities: adjustedProbabilities, engineUsed: probabilityEngine } =
    resolveAdjustedProbabilities(horses, tsProbabilities, requestedEngine);

  const mathFirst = mathFirstByFinalRank(results);
  const displayFavorite = results.find((r) => r.mark === "◎");
  const isSkippableRace =
    mathFirst != null &&
    displayFavorite != null &&
    mathFirst.horseId !== displayFavorite.horseId;

  const viewModel = buildRaceEvaluationViewModel(
    horses,
    results,
    condition,
    adjustedProbabilities,
    { probabilityEngine },
  );
  return {
    results,
    viewModel,
    adjustedProbabilities,
    probabilityEngine,
    isSkippableRace,
    mathFirstHorseId: mathFirst?.horseId,
    displayFavoriteHorseId: displayFavorite?.horseId,
  };
}
