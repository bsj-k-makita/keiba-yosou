import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";
import { evaluateRace } from "../race-evaluation/scoreCalculator";
import { ensureFrontendDisplayMarks } from "../../lib/race-display/ensureFrontendDisplayMarks";
import { convertToRaceEvaluationData } from "../../lib/race-data/convertToRaceEvaluationData";
import { getHorsesFromRaceData } from "../../lib/race-data/raceDataRepository";
import type { RaceResultData } from "../../lib/race-data/raceEvaluationTypes";
import { runRaceEvaluationPipeline } from "../../lib/pipeline/evaluationPipeline";
import { buildRaceBettingContextFromPipeline } from "./buildRaceBettingContext";
import { calculateRacePayout } from "./payoutCalculator";
import { computeRaceBettingOutcome } from "./computeRaceBettingOutcome";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");

function loadRacePair(raceId: string) {
  const raw = JSON.parse(readFileSync(join(root, "data/races", `${raceId}.json`), "utf8"));
  const result = JSON.parse(
    readFileSync(join(root, "data/results", `${raceId}.json`), "utf8"),
  ) as RaceResultData;
  const data = convertToRaceEvaluationData(raw);
  const horses = getHorsesFromRaceData(data);
  const results = ensureFrontendDisplayMarks(
    evaluateRace(horses, data.condition),
    horses,
    data.condition,
  );
  return { data, horses, results, result };
}

describe("computeRaceBettingOutcome", () => {
  test("202605020803: EV推奨ありレースは投資・的中を返す", () => {
    const { data, horses, results, result } = loadRacePair("202605020803");
    const outcome = computeRaceBettingOutcome(results, horses, data.condition, result);
    expect(outcome?.status).toBe("resolved");
    expect(outcome?.totalInvested).toBeGreaterThanOrEqual(0);
    if (outcome!.totalInvested > 0) {
      expect(outcome?.isHit).toBe(outcome!.totalPayout > 0);
    } else {
      expect(outcome?.totalPayout).toBe(0);
      expect(outcome?.recoveryRate).toBe(0);
    }
  });

  test("AIバックフィル済みレースは engine 未指定でも EV推奨券を生成する", () => {
    const { data, horses, result } = loadRacePair("202603010605");
    const pipeline = runRaceEvaluationPipeline(horses, data.condition, { probabilityEngine: "ai" });
    expect(pipeline.probabilityEngine).toBe("ai");
    expect(pipeline.results.some((r) => r.mark === "◎")).toBe(true);

    const withoutEngine = computeRaceBettingOutcome(
      pipeline.results,
      horses,
      data.condition,
      result,
      100,
      { adjustedProbabilities: pipeline.adjustedProbabilities },
    );
    const withEngine = computeRaceBettingOutcome(
      pipeline.results,
      horses,
      data.condition,
      result,
      100,
      {
        adjustedProbabilities: pipeline.adjustedProbabilities,
        probabilityEngine: "ai",
      },
    );
    expect(withoutEngine?.totalInvested).toBe(withEngine?.totalInvested);
    expect(withoutEngine?.totalInvested ?? 0).toBeGreaterThan(0);
  });

  test("着順の horseId が不整合でも horseNumber があれば回収判定できる", () => {
    const { data, horses, results, result } = loadRacePair("202605020803");
    const horseNumberById = new Map<string, number>();
    for (const h of horses) {
      const gate = (h as { gate?: number }).gate;
      if (gate != null && Number.isFinite(gate)) {
        horseNumberById.set(h.horseId, Math.round(gate));
      }
    }
    const brokenPlaces = result.places.slice(0, 3).map((p) => ({
      ...p,
      horseId: `missing-${p.horseId}`,
      horseNumber: horseNumberById.get(p.horseId) ?? undefined,
    }));
    const brokenResult: RaceResultData = {
      ...result,
      places: brokenPlaces,
    };
    const outcome = computeRaceBettingOutcome(results, horses, data.condition, brokenResult);
    expect(outcome?.status).toBe("resolved");
  });

  test("202608030806: 馬連は公式配当6-8のみ的中し、EV推奨に6-8が含まれる", () => {
    const { data, horses, result } = loadRacePair("202608030806");
    const pipeline = runRaceEvaluationPipeline(horses, data.condition, { probabilityEngine: "ai" });
    expect(pipeline.probabilityEngine).toBe("ai");
    const ctx = buildRaceBettingContextFromPipeline(pipeline, horses, data.condition, 100);
    expect(ctx).not.toBeNull();

    const mainLine = ctx!.evTickets.find((t) => t.ticketType === "MAIN_LINE");
    expect(mainLine).toBeDefined();
    expect(mainLine!.combinations.some((comb) => comb[0] === 6 && comb[1] === 8)).toBe(true);

    const gateByHorseId = new Map<string, number>();
    for (const h of horses) {
      const gate = (h as { gate?: number }).gate;
      if (gate != null && Number.isFinite(gate)) gateByHorseId.set(h.horseId, Math.round(gate));
    }
    const finishOrder = result.places
      .sort((a, b) => a.place - b.place)
      .map((p) => gateByHorseId.get(p.horseId))
      .filter((n): n is number => n != null);

    const payout = calculateRacePayout(ctx!.evTickets, {
      raceId: result.raceId,
      classLevel: ctx!.classLevel,
      finishOrder,
      winOddsByNumber: ctx!.winOddsByNumber,
      officialPayouts: result.payouts,
    });
    expect(payout.byType.MAIN_LINE.hitCount).toBe(1);
    expect(payout.byType.MAIN_LINE.payout).toBe(2360);
  });
});
