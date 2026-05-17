import { describe, expect, it } from "vitest";
import type { HorseAbility, HorseScoreResult, RaceCondition } from "../../domain/race-evaluation/abilityTypes";
import { BUY_LABELS } from "../../domain/race-evaluation/lingoConstants";
import { ensureFrontendDisplayMarks } from "./ensureFrontendDisplayMarks";

const condition: RaceCondition = {
  venue: "東京",
  surface: "芝",
  ground: "good",
  trackSpeed: "standard",
  bias: "flat",
  pace: "middle",
  adjustmentStrength: "middle",
};

function horse(id: string): HorseAbility {
  return {
    horseId: id,
    horseName: id,
    runningStyle: "先行",
    speed: 50,
    stamina: 50,
    kick: 50,
    sustain: 50,
    power: 50,
  };
}

function row(id: string, rank: number, buyLabel: string = BUY_LABELS.GROUP): HorseScoreResult {
  return {
    horseId: id,
    horseName: id,
    mark: "",
    buyLabel,
    adjustedScore: 100 - rank,
    finalEvaluationScore: 100 - rank,
    scoreDiff: 0,
    adjustedRank: rank,
    finalRank: rank,
    baseRank: rank,
  } as unknown as HorseScoreResult;
}

describe("ensureFrontendDisplayMarks", () => {
  it("fills ◎○▲☆△ even when all rows were DISMISS with empty marks", () => {
    const results = [1, 2, 3, 4, 5, 6].map((n) => row(String(n), n, BUY_LABELS.DISMISS));
    const out = ensureFrontendDisplayMarks(results, results.map((r) => horse(r.horseId)), condition);
    expect(out.some((r) => r.mark === "◎")).toBe(true);
    expect(out.some((r) => r.mark === "○")).toBe(true);
    expect(out.some((r) => r.mark === "▲")).toBe(true);
    expect(out.some((r) => r.mark === "☆")).toBe(true);
    expect(out.some((r) => r.mark === "△")).toBe(true);
  });
});
