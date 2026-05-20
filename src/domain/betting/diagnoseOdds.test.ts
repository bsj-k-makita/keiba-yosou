import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
import { collectBacktestRaceInputs } from "./runFullBacktest";
import { runBacktestOnRace } from "./runBacktest";
import { convertToRaceEvaluationData } from "../../lib/race-data/convertToRaceEvaluationData";
import { getHorsesFromRaceData } from "../../lib/race-data/raceDataRepository";
import { getEffectiveEvaluationSignals } from "../race-evaluation/resolveEvaluationSignals";
import { buildRaceBettingContextFromPipeline } from "./buildRaceBettingContext";
import { countEvRecommendationPoints } from "./bettingRules";
import { runRaceEvaluationPipeline } from "../../lib/pipeline/evaluationPipeline";

describe("May 10/17 EV tickets", () => {
  test("market_win_odds flows into evaluationSignals and EV generation", () => {
    const raw = JSON.parse(
      readFileSync("src/data/races/202604010609.json", "utf8"),
    );
    const data = convertToRaceEvaluationData(raw);
    const horses = getHorsesFromRaceData(data);
    const withOdds = horses.filter((h) => (getEffectiveEvaluationSignals(h)?.winOdds ?? 0) > 0);
    expect(withOdds.length).toBeGreaterThan(0);

    const input = collectBacktestRaceInputs().find((i) => i.raceId === "202604010609");
    expect(input).toBeDefined();
    const pipeline = runRaceEvaluationPipeline(input!.horses, input!.condition, {
      probabilityEngine: "ai",
    });
    const ctx = buildRaceBettingContextFromPipeline(pipeline, input!.horses, input!.condition);
    expect(countEvRecommendationPoints(ctx!.evTickets)).toBeGreaterThan(0);

    const out = runBacktestOnRace(input!, { probabilityEngine: "ai" });
    expect(out!.result.totalInvested).toBeGreaterThan(0);
  });

  test("2026-05-17 has non-skip races with EV investment", () => {
    const inputs = collectBacktestRaceInputs().filter((i) => i.meta.date === "2026-05-17");
    let investedRaces = 0;
    let hitRaces = 0;
    for (const input of inputs) {
      const out = runBacktestOnRace(input, { probabilityEngine: "ai" });
      if (!out) continue;
      if (out.result.totalInvested > 0) investedRaces += 1;
      if (out.result.totalPayout > 0) hitRaces += 1;
    }
    expect(investedRaces).toBeGreaterThan(0);
    expect(hitRaces).toBeGreaterThan(0);
  });
});
