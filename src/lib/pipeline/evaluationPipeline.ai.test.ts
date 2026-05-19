import { describe, expect, it } from "vitest";
import type { HorseAbility, RaceCondition } from "../../domain/race-evaluation/abilityTypes";
import { runRaceEvaluationPipeline } from "./evaluationPipeline";

const condition: RaceCondition = {
  venue: "東京",
  surface: "芝",
  ground: "good",
  bias: "flat",
  pace: "middle",
  adjustmentStrength: "middle",
};

function horse(id: string, ev: number, score: number): HorseAbility & { gate: number; frameNumber: number } {
  return {
    horseId: id,
    horseName: id,
    runningStyle: "先行",
    speed: score,
    stamina: score,
    kick: score,
    sustain: score,
    power: score,
    gate: Number(id.replace(/\D/g, "")) || 1,
    frameNumber: 1,
    aiPredictedWinRate: 0.1,
    aiEffectiveEv: ev,
  };
}

describe("runRaceEvaluationPipeline AI mode", () => {
  it("reassigns ◎ to highest ai_effective_ev and disables skippable", () => {
    const horses = [horse("1", 0.3, 40), horse("2", 1.6, 95), horse("3", 0.8, 70)];
    const pipeline = runRaceEvaluationPipeline(horses, condition, { probabilityEngine: "ai" });
    expect(pipeline.probabilityEngine).toBe("ai");
    expect(pipeline.results.find((r) => r.mark === "◎")?.horseId).toBe("2");
    expect(pipeline.isSkippableRace).toBe(false);
  });
});
