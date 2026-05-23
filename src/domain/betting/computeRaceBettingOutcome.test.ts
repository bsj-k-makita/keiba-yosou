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
import { runBacktestOnRace } from "./runBacktest";

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
    })) as unknown as RaceResultData["places"];
    const brokenResult: RaceResultData = {
      ...result,
      places: brokenPlaces,
    };
    const outcome = computeRaceBettingOutcome(results, horses, data.condition, brokenResult);
    expect(outcome?.status).toBe("resolved");
  });

  test("着順が horseId/horseName で解決不能でも horseNumber があれば resolved になる", () => {
    const { data, horses, results, result } = loadRacePair("202605020803");
    const brokenResult: RaceResultData = {
      ...result,
      places: [
        { place: 1, horseId: "unknown-1", horseName: "不明A", horseNumber: 21 },
        { place: 2, horseId: "unknown-2", horseName: "不明B", horseNumber: 22 },
        { place: 3, horseId: "unknown-3", horseName: "不明C", horseNumber: 23 },
      ] as unknown as RaceResultData["places"],
    };
    const outcome = computeRaceBettingOutcome(results, horses, data.condition, brokenResult);
    expect(outcome?.status).toBe("resolved");
  });

  test("一覧判定とBT判定は horseNumber フォールバック時も resolved で一致する", () => {
    const { data, horses, results, result } = loadRacePair("202605020803");
    const brokenResult: RaceResultData = {
      ...result,
      places: [
        { place: 1, horseId: "unknown-1", horseName: "不明A", horseNumber: 21 },
        { place: 2, horseId: "unknown-2", horseName: "不明B", horseNumber: 22 },
        { place: 3, horseId: "unknown-3", horseName: "不明C", horseNumber: 23 },
      ] as unknown as RaceResultData["places"],
    };

    const listOutcome = computeRaceBettingOutcome(results, horses, data.condition, brokenResult);
    const bt = runBacktestOnRace({
      raceId: brokenResult.raceId,
      meta: {
        date: data.raceInfo.date,
        venue: data.raceInfo.venue,
        raceNumber: data.raceInfo.raceNumber,
        raceName: data.raceInfo.raceName ?? undefined,
        surface: data.raceInfo.surface,
        distance: data.raceInfo.distance,
      },
      condition: data.condition,
      horses: [...horses],
      places: brokenResult.places,
      payouts: brokenResult.payouts,
    });

    expect(listOutcome?.status).toBe("resolved");
    expect(bt?.result.skippedReason).not.toBe("insufficient_results");
  });

  test("202608030806: 馬連6-8の公式配当が払戻計算と整合する", () => {
    const { data, horses, result } = loadRacePair("202608030806");
    const pipeline = runRaceEvaluationPipeline(horses, data.condition, { probabilityEngine: "ai" });
    expect(pipeline.probabilityEngine).toBe("ai");
    const ctx = buildRaceBettingContextFromPipeline(pipeline, horses, data.condition, 100);
    expect(ctx).not.toBeNull();

    const mainLine = ctx!.evTickets.find((t) => t.ticketType === "MAIN_LINE");
    expect(mainLine).toBeDefined();

    const gateByHorseId = new Map<string, number>();
    for (const h of horses) {
      const gate = (h as { gate?: number }).gate;
      if (gate != null && Number.isFinite(gate)) gateByHorseId.set(h.horseId, Math.round(gate));
    }
    const finishOrder = result.places
      .sort((a, b) => a.place - b.place)
      .map((p) => gateByHorseId.get(p.horseId))
      .filter((n): n is number => n != null);

    const payoutInput = {
      raceId: result.raceId,
      classLevel: ctx!.classLevel,
      finishOrder,
      winOddsByNumber: ctx!.winOddsByNumber,
      officialPayouts: result.payouts,
    };

    const payout = calculateRacePayout(ctx!.evTickets, payoutInput);
    const includes68 = mainLine!.combinations.some((comb) => comb[0] === 6 && comb[1] === 8);
    if (includes68) {
      expect(payout.byType.MAIN_LINE.hitCount).toBe(1);
      expect(payout.byType.MAIN_LINE.payout).toBe(2360);
    } else {
      expect(payout.byType.MAIN_LINE.hitCount).toBe(0);
    }

    const directPayout = calculateRacePayout(
      [{ ticketType: "MAIN_LINE", combinations: [[6, 8]], betAmount: 100 }],
      payoutInput,
    );
    expect(directPayout.byType.MAIN_LINE.hitCount).toBe(1);
    expect(directPayout.byType.MAIN_LINE.payout).toBe(2360);
  });

  test("202604010601: 回収判定は pending にならず resolved になる", () => {
    const { data, horses, results, result } = loadRacePair("202604010601");
    const outcome = computeRaceBettingOutcome(results, horses, data.condition, result);
    expect(outcome).not.toBeNull();
    expect(outcome?.status).toBe("resolved");
  });
});
