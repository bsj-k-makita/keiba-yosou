import { computeRaceBettingOutcome, type RaceBettingOutcome } from "../../domain/betting/computeRaceBettingOutcome";
import { runRaceEvaluationPipeline } from "../pipeline/evaluationPipeline";
import { getHorsesFromRaceData, getRaceEvaluationById, getRaceResultById } from "./raceDataRepository";

export async function computeRaceBettingOutcomeById(
  raceId: string,
): Promise<RaceBettingOutcome | null> {
  const evalData = await getRaceEvaluationById(raceId);
  if (evalData == null) return null;

  const horses = getHorsesFromRaceData(evalData);
  const { results } = runRaceEvaluationPipeline(horses, evalData.condition);
  const result = await getRaceResultById(raceId);

  return computeRaceBettingOutcome(results, horses, evalData.condition, result ?? undefined);
}
