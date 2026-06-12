import { describe, expect, test } from "vitest";
import type { RaceEvaluationData } from "./raceEvaluationTypes";
import { assertRaceDataQuality } from "./dataQualityGuards";
import { BUY_LABELS, FIT_TENDENCY, PACE_FIT } from "../../domain/race-evaluation/lingoConstants";

function makeRaceData(raceName: string, totalEntries = 12): RaceEvaluationData {
  return {
    raceId: "202605030205",
    raceInfo: {
      raceId: "202605030205",
      date: "2026-06-07",
      venue: "東京",
      raceNumber: 5,
      raceName,
      surface: "芝",
      distance: 1800,
    },
    condition: {
      venue: "東京",
      raceName,
      ground: "good",
      bias: "flat",
      pace: "middle",
      adjustmentStrength: "middle",
    },
    entries: Array.from({ length: totalEntries }, (_, i) => ({
      horseId: `h${i + 1}`,
      horseName: `horse-${i + 1}`,
      horseNumber: i + 1,
      frameNumber: Math.max(1, Math.min(8, Math.ceil((i + 1) / 2))),
      runningStyle: "好位",
      abilities: { speed: 50, stamina: 50, kick: 50, sustain: 50, power: 50 },
      abilityGrades: { speed: "C", stamina: "C", kick: "C", sustain: "C", power: "C" },
      evaluation: {
        baseScore: 50,
        adjustedScore: 50,
        scoreDiff: 0,
        baseAbilityCore: 50,
        intrinsicAbilityScore: 50,
        raceAdjustedInput: 50,
        conditionFitDelta: 0,
        reproducibilityDelta: 0,
        riskPenalty: 0,
        raceRelativeScore: 50,
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
        finalEvaluationScore: 50,
        lapShapeFitBonus: 0,
        raceAnalysisBonus: 0,
        lapSustainBonus: 0,
        lapQualityBonus: 0,
        stepPatternBonus: 0,
        lapProfile: "一貫型",
        varianceScore: 0,
        roleHint: "判定不能",
        pastRunInsight: "",
        fitLevel: FIT_TENDENCY.MID,
        paceFit: PACE_FIT.FIT,
        buyLabel: BUY_LABELS.GROUP,
      },
      pastRuns: [],
    })),
  };
}

describe("assertRaceDataQuality", () => {
  test("allows empty pastRuns for debut races", () => {
    const data = makeRaceData("2歳新馬");
    expect(() => assertRaceDataQuality(data)).not.toThrow();
  });

  test("throws when non-debut race has no pastRuns", () => {
    const data = makeRaceData("3歳未勝利");
    expect(() => assertRaceDataQuality(data)).toThrow(/pastRuns が空/);
  });
});
