import { computeRaceBettingOutcome, type RaceBettingOutcome } from "../../domain/betting/computeRaceBettingOutcome";
import { runRaceEvaluationPipeline } from "../pipeline/evaluationPipeline";
import { DEFAULT_PROBABILITY_ENGINE } from "../pipeline/probabilityEngine";
import { getHorsesFromRaceData, getRaceEvaluationById, getRaceResultById } from "./raceDataRepository";

export async function computeRaceBettingOutcomeById(
  raceId: string,
): Promise<RaceBettingOutcome | null> {
  const evalData = await getRaceEvaluationById(raceId);
  if (evalData == null) return null;

  const horses = getHorsesFromRaceData(evalData);
  const pipeline = runRaceEvaluationPipeline(horses, evalData.condition, {
    probabilityEngine: DEFAULT_PROBABILITY_ENGINE,
  });
  const result = await getRaceResultById(raceId);

  return computeRaceBettingOutcome(
    pipeline.results,
    horses,
    evalData.condition,
    result ?? undefined,
    100,
    {
      adjustedProbabilities: pipeline.adjustedProbabilities,
      isSkippableRace: pipeline.isSkippableRace,
      probabilityEngine: pipeline.probabilityEngine,
      noAiEvRegime: pipeline.aiRaceRegime === "NO_EV_REGIME",
    },
  );
}
