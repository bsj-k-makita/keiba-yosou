import { evaluateRace, type HorseAbility, type RaceCondition } from "../../domain/race-evaluation";
import {
  buildRaceEvaluationViewModel,
  type RaceEvaluationViewModel,
} from "../../viewModel/raceEvaluationViewModel";
import { effectiveSoftmaxTemperature, softmaxDistribution } from "./normalization";

export type EvaluationPipelineResult = {
  results: ReturnType<typeof evaluateRace>;
  viewModel: RaceEvaluationViewModel;
  adjustedProbabilities: Map<string, number>;
};

export function runRaceEvaluationPipeline(
  horses: readonly HorseAbility[],
  condition: RaceCondition,
): EvaluationPipelineResult {
  const results = evaluateRace([...horses], condition);
  const temperature = effectiveSoftmaxTemperature(
    condition.softmaxTemperature,
    condition.adjustmentStrength,
  );
  const adjustedProbabilities = softmaxDistribution(
    results.map((row) => ({ horseId: row.horseId, score: row.finalEvaluationScore })),
    temperature,
  );
  const viewModel = buildRaceEvaluationViewModel(horses, results, condition, adjustedProbabilities);
  return {
    results,
    viewModel,
    adjustedProbabilities,
  };
}
