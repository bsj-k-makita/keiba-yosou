import { evaluateRace } from "../../domain/race-evaluation";
import { computeRaceBettingOutcome, type RaceBettingOutcome } from "../../domain/betting/computeRaceBettingOutcome";
import { ensureFrontendDisplayMarks } from "../race-display/ensureFrontendDisplayMarks";
import { getHorsesFromRaceData, getRaceEvaluationById, getRaceResultById } from "./raceDataRepository";

export async function computeRaceBettingOutcomeById(
  raceId: string,
): Promise<RaceBettingOutcome | null> {
  const evalData = await getRaceEvaluationById(raceId);
  if (evalData == null) return null;

  const horses = getHorsesFromRaceData(evalData);
  const results = ensureFrontendDisplayMarks(
    evaluateRace(horses, evalData.condition),
    horses,
    evalData.condition,
  );
  const result = await getRaceResultById(raceId);

  return computeRaceBettingOutcome(results, horses, evalData.condition, result ?? undefined);
}
