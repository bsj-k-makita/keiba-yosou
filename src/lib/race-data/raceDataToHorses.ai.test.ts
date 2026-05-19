import { describe, expect, it } from "vitest";
import sample from "../../data/races/202604010108.json";
import { convertToRaceEvaluationData } from "./convertToRaceEvaluationData";
import { raceDataToHorses } from "./raceDataToHorses";
import { raceHasAiEngineReady } from "../pipeline/probabilityEngine";

describe("raceDataToHorses ai fields", () => {
  it("preserves ai_predicted_win_rate from analysis JSON through conversion", () => {
    const data = convertToRaceEvaluationData(sample);
    const horses = raceDataToHorses(data);

    expect(data.entries.some((e) => e.aiPredictedWinRate != null)).toBe(true);
    expect(horses.some((h) => h.aiPredictedWinRate != null)).toBe(true);
    expect(raceHasAiEngineReady(horses)).toBe(true);
  });
});
