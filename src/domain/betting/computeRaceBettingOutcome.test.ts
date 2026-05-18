import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";
import { evaluateRace } from "../race-evaluation/scoreCalculator";
import { ensureFrontendDisplayMarks } from "../../lib/race-display/ensureFrontendDisplayMarks";
import { convertToRaceEvaluationData } from "../../lib/race-data/convertToRaceEvaluationData";
import { raceDataToHorses } from "../../lib/race-data/raceDataToHorses";
import type { RaceResultData } from "../../lib/race-data/raceEvaluationTypes";
import { computeRaceBettingOutcome } from "./computeRaceBettingOutcome";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");

function loadRacePair(raceId: string) {
  const raw = JSON.parse(readFileSync(join(root, "data/races", `${raceId}.json`), "utf8"));
  const result = JSON.parse(
    readFileSync(join(root, "data/results", `${raceId}.json`), "utf8"),
  ) as RaceResultData;
  const data = convertToRaceEvaluationData(raw);
  const horses = raceDataToHorses(data);
  const results = ensureFrontendDisplayMarks(
    evaluateRace(horses, data.condition),
    horses,
    data.condition,
  );
  return { data, horses, results, result };
}

describe("computeRaceBettingOutcome", () => {
  test("202605020803: ◎○1-2着は定型買い目で投資・的中（EV見送りでも）", () => {
    const { data, horses, results, result } = loadRacePair("202605020803");
    const outcome = computeRaceBettingOutcome(results, horses, data.condition, result);
    expect(outcome?.status).toBe("resolved");
    expect(outcome?.totalInvested).toBeGreaterThan(0);
    expect(outcome?.isHit).toBe(true);
    expect(outcome?.totalPayout).toBeGreaterThan(0);
    expect(outcome?.hasFormationHit).toBe(true);
  });
});
