import { describe, expect, test } from "vitest";
import type { HorseAbility } from "../../domain/race-evaluation/abilityTypes";
import {
  buildAiProbabilityMap,
  parseProbabilityEngine,
  raceHasAiEngineReady,
  raceHasAiPredictions,
  resolveAdjustedProbabilities,
} from "./probabilityEngine";

function horse(id: string, ai?: number, ev?: number): HorseAbility {
  return {
    horseId: id,
    horseName: id,
    runningStyle: "先行",
    speed: 50,
    stamina: 50,
    kick: 50,
    sustain: 50,
    power: 50,
    aiPredictedWinRate: ai,
    aiEffectiveEv: ev,
  };
}

describe("probabilityEngine", () => {
  test("parseProbabilityEngine", () => {
    expect(parseProbabilityEngine("ai")).toBe("ai");
    expect(parseProbabilityEngine("ts")).toBe("ts");
    expect(parseProbabilityEngine(null)).toBe("ai");
    expect(parseProbabilityEngine(undefined)).toBe("ai");
  });

  test("raceHasAiPredictions", () => {
    expect(raceHasAiPredictions([horse("a")])).toBe(false);
    expect(raceHasAiPredictions([horse("a", 0.2)])).toBe(true);
  });

  test("raceHasAiEngineReady requires full backfill", () => {
    expect(raceHasAiEngineReady([horse("a", 0.2, 1.1)])).toBe(true);
    expect(raceHasAiEngineReady([horse("a", 0.2)])).toBe(false);
  });

  test("resolveAdjustedProbabilities falls back to ts when ai missing", () => {
    const ts = new Map([["a", 0.5]]);
    const { probabilities, engineUsed } = resolveAdjustedProbabilities(
      [horse("a")],
      ts,
      "ai",
    );
    expect(engineUsed).toBe("ts");
    expect(probabilities.get("a")).toBe(0.5);
  });

  test("resolveAdjustedProbabilities falls back when only partial ai", () => {
    const ts = new Map([
      ["a", 0.5],
      ["b", 0.3],
    ]);
    const { engineUsed } = resolveAdjustedProbabilities(
      [horse("a", 0.42, 1.2), horse("b", 0.1)],
      ts,
      "ai",
    );
    expect(engineUsed).toBe("ts");
  });

  test("resolveAdjustedProbabilities uses ai map when full backfill", () => {
    const ts = new Map([["a", 0.1]]);
    const { probabilities, engineUsed } = resolveAdjustedProbabilities(
      [horse("a", 0.42, 1.05)],
      ts,
      "ai",
    );
    expect(engineUsed).toBe("ai");
    expect(probabilities.get("a")).toBe(0.42);
  });

  test("buildAiProbabilityMap", () => {
    const m = buildAiProbabilityMap([horse("x", 0.3), horse("y", 0.7)]);
    expect(m.get("x")).toBe(0.3);
    expect(m.get("y")).toBe(0.7);
  });
});
