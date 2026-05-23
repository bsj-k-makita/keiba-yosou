import { describe, expect, it } from "vitest";
import type { HorseAbility, HorseScoreResult, RaceCondition } from "../../domain/race-evaluation/abilityTypes";
import { AI_MARK_LOGIC_VERSION } from "./aiMarkAssignment";
import { applyAiMarksWithFreeze } from "./applyAiMarksWithFreeze";

const condition: RaceCondition = {
  venue: "京都",
  surface: "芝",
  ground: "good",
  bias: "flat",
  pace: "middle",
  adjustmentStrength: "middle",
};

function row(id: string, score: number): HorseScoreResult {
  return {
    horseId: id,
    horseName: id,
    mark: "",
    finalEvaluationScore: score,
    finalRank: 1,
    adjustedRank: 1,
    baseRank: 1,
    adjustedScore: score,
    baseScore: score,
    scoreDiff: 0,
    varianceScore: 0,
    roleHint: "軸",
    pastRunInsight: "",
    fitLevel: "中",
    paceFit: "普通",
    buyLabel: "様子見",
    lapShapeFitBonus: 0,
    raceAnalysisBonus: 0,
    lapSustainBonus: 0,
    lapQualityBonus: 0,
    stepPatternBonus: 0,
    lapProfile: "一貫型",
  } as unknown as HorseScoreResult;
}

function horse(id: string, ev: number, p: number): HorseAbility {
  return {
    horseId: id,
    horseName: id,
    runningStyle: "先行",
    speed: 50,
    stamina: 50,
    kick: 50,
    sustain: 50,
    power: 50,
    aiPredictedWinRate: p,
    aiEffectiveEv: ev,
  };
}

describe("applyAiMarksWithFreeze", () => {
  const raceInfo = {
    raceId: "202608030904",
    date: "2099-01-01",
    venue: "京都",
    raceNumber: 4,
    postTime: "12:00",
    surface: "芝" as const,
    distance: 1800,
  };

  it("uses stored snapshot when frozen", () => {
    const ts = [row("a", 50), row("b", 60)];
    const horses = [horse("a", 0.5, 0.1), horse("b", 2.0, 0.4)];
    const frozenAt = new Date("2099-01-01T10:00:00+09:00");
    const applied = applyAiMarksWithFreeze(ts, horses, condition, {
      raceInfo,
      storedSnapshot: {
        frozenAt: frozenAt.toISOString(),
        marksByHorseId: { a: "◎", b: "○" },
        logicVersion: AI_MARK_LOGIC_VERSION,
      },
      now: new Date("2099-01-01T11:45:00+09:00"),
    });
    expect(applied.marksFrozen).toBe(true);
    expect(applied.usedStoredSnapshot).toBe(true);
    expect(applied.results.find((r) => r.horseId === "a")?.mark).toBe("◎");
    expect(applied.results.find((r) => r.horseId === "b")?.mark).toBe("○");
  });

  it("recomputes marks before freeze window", () => {
    const ts = [row("a", 50), row("b", 60)];
    const horses = [horse("a", 0.5, 0.1), horse("b", 2.0, 0.4)];
    const applied = applyAiMarksWithFreeze(ts, horses, condition, {
      raceInfo,
      now: new Date("2099-01-01T08:00:00+09:00"),
    });
    expect(applied.marksFrozen).toBe(false);
    expect(applied.results.find((r) => r.mark === "◎")?.horseId).toBe("b");
    expect(applied.createdSnapshot).toBeNull();
  });

  it("ignores stale snapshot without logicVersion when frozen", () => {
    const ts = [row("a", 50), row("b", 60)];
    const horses = [horse("a", 0.5, 0.1), horse("b", 2.0, 0.4)];
    const applied = applyAiMarksWithFreeze(ts, horses, condition, {
      raceInfo,
      storedSnapshot: {
        frozenAt: new Date("2099-01-01T10:00:00+09:00").toISOString(),
        marksByHorseId: { a: "◎", b: "○" },
      },
      now: new Date("2099-01-01T11:45:00+09:00"),
    });
    expect(applied.usedStoredSnapshot).toBe(false);
    expect(applied.results.find((r) => r.mark === "◎")?.horseId).toBe("b");
  });
});
