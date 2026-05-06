import { describe, expect, test } from "vitest";
import type { HorseAbility, HorseScoreResult, RaceCondition } from "../../domain/race-evaluation";
import { buildBetPlan } from "./betBuilder";

function horse(id: string, name: string, odds?: number): HorseAbility {
  return {
    horseId: id,
    horseName: name,
    runningStyle: "先行",
    speed: 70,
    stamina: 70,
    kick: 70,
    sustain: 70,
    power: 70,
    signals: odds ? { winOdds: odds } : undefined,
  };
}

function result(id: string, name: string, rank: number, label: HorseScoreResult["buyLabel"]): HorseScoreResult {
  return {
    horseId: id,
    horseName: name,
    baseScore: 60,
    adjustedScore: 62,
    scoreDiff: 2,
    baseAbilityCore: 60,
    intrinsicAbilityScore: 60,
    raceAdjustedInput: 61,
    conditionFitDelta: 1,
    reproducibilityDelta: 0,
    riskPenalty: 0,
    baseRank: rank,
    adjustedRank: rank,
    raceRelativeScore: 60,
    paceFitBonus: 0,
    distanceFitBonus: 0,
    classLevelBonus: 0,
    pedigreeBonus: 0,
    gateBiasBonus: 0,
    gateStyleSynergyBonus: 0,
    connectionsBonus: 0,
    trendBonus: 0,
    paceBalanceBonus: 0,
    tripContextBonus: 0,
    finalEvaluationScore: 60,
    evaluationBaselineScore: 60,
    evaluationAdjustmentDelta: 0,
    lastMinuteAdjustmentBonus: 0,
    lastRunResetBonus: 0,
    lapFocusBonus: 0,
    adjustmentBadges: [],
    finalRank: rank,
    buyLabel: label,
    reason: "",
    strongAbilities: ["speed"],
    pastRunInsight: "",
    lapShapeFitBonus: 0,
    lapSustainBonus: 0,
    lapQualityBonus: 0,
    stepPatternBonus: 0,
    lapProfile: "一貫型",
    varianceScore: 0,
    roleHint: "判定不能",
  };
}

describe("buildBetPlan", () => {
  const condition: RaceCondition = {
    venue: "京都",
    ground: "good",
    bias: "flat",
    pace: "high",
    adjustmentStrength: "middle",
    distance: 3200,
  };

  test("builds tickets with axis horse and stake allocation", () => {
    const horses = [
      horse("h1", "A", 2.1),
      horse("h2", "B", 3.2),
      horse("h3", "C", 5.8),
      horse("h4", "D", 8.2),
      horse("h5", "E", 12.0),
      horse("h6", "F", 20.0),
    ];
    const sorted = [
      result("h1", "A", 1, "本命候補"),
      result("h2", "B", 2, "対抗"),
      result("h3", "C", 3, "単穴"),
      result("h4", "D", 4, "相手"),
      result("h5", "E", 5, "相手"),
      result("h6", "F", 6, "消し"),
    ];
    const plan = buildBetPlan(sorted, horses, condition, "conservative", 5000, false);
    expect(plan).not.toBeNull();
    expect(plan?.axisHorse.horseId).toBe("h1");
    expect(plan?.tickets.length).toBe(2);
    expect(plan?.tickets[0]?.type).toBe("馬連");
    expect(plan?.tickets[1]?.type).toBe("3連複");
    expect(plan?.totalStake).toBeGreaterThan(0);
    expect((plan?.tickets[0]?.items.length ?? 0) > 0).toBe(true);
  });

  test("anti-gami allocation narrows estimated return spread", () => {
    const horses = [
      horse("h1", "A", 2.1),
      horse("h2", "B", 3.2),
      horse("h3", "C", 5.8),
      horse("h4", "D", 8.2),
      horse("h5", "E", 12.0),
      horse("h6", "F", 30.0),
    ];
    const sorted = [
      result("h1", "A", 1, "本命候補"),
      result("h2", "B", 2, "対抗"),
      result("h3", "C", 3, "単穴"),
      result("h4", "D", 4, "相手"),
      result("h5", "E", 5, "相手"),
      result("h6", "F", 6, "相手"),
    ];
    const plain = buildBetPlan(sorted, horses, condition, "aggressive", 10000, false)!;
    const anti = buildBetPlan(sorted, horses, condition, "aggressive", 10000, true)!;
    const plainRange = plain.tickets[1]!.maxEstimatedReturn - plain.tickets[1]!.minEstimatedReturn;
    const antiRange = anti.tickets[1]!.maxEstimatedReturn - anti.tickets[1]!.minEstimatedReturn;
    expect(antiRange).toBeLessThan(plainRange);
  });
});
