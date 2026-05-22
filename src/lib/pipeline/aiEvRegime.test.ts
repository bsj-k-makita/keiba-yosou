import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { HorseAbility } from "../../domain/race-evaluation/abilityTypes";
import { convertToRaceEvaluationData } from "../race-data/convertToRaceEvaluationData";
import { raceDataToHorses } from "../race-data/raceDataToHorses";
import {
  WIN_RATE_STDEV_THRESHOLD,
  resolveAiRaceRegime,
} from "./aiEvRegime";

function horse(id: string, ev: number, winRate: number = 0.05): HorseAbility {
  return {
    horseId: id,
    horseName: id,
    runningStyle: "先行",
    speed: 70,
    stamina: 70,
    kick: 70,
    sustain: 70,
    power: 70,
    aiPredictedWinRate: winRate,
    aiEffectiveEv: ev,
  };
}

describe("resolveAiRaceRegime", () => {
  it("最高EVが閾値以上なら NORMAL", () => {
    const horses = [
      horse("a", 0.2, 0.35),
      horse("b", -0.05, 0.18),
      horse("c", -0.12, 0.07),
    ];
    expect(resolveAiRaceRegime(horses)).toBe("NORMAL_AI_REGIME");
  });

  it("全頭が床付近で横並びなら NO_EV", () => {
    const horses = Array.from({ length: 10 }, (_, i) => horse(String(i), -0.15));
    expect(resolveAiRaceRegime(horses)).toBe("NO_EV_REGIME");
  });

  it("最高EVは低いが上位に差があれば NORMAL", () => {
    const horses = [
      horse("a", -0.05, 0.32),
      ...Array.from({ length: 6 }, (_, i) => horse(`b${i}`, -0.15, 0.04 + i * 0.01)),
    ];
    expect(resolveAiRaceRegime(horses)).toBe("NORMAL_AI_REGIME");
  });

  it("オークス 202605021011 は NO_EV_REGIME", () => {
    const raw = JSON.parse(
      readFileSync(join(process.cwd(), "src/data/races/202605021011.json"), "utf8"),
    );
    const data = convertToRaceEvaluationData(raw);
    const horses = raceDataToHorses(data);
    expect(resolveAiRaceRegime(horses)).toBe("NO_EV_REGIME");
    const top7ByEv = [...horses]
      .filter((h) => h.aiEffectiveEv != null && h.aiPredictedWinRate != null)
      .sort((a, b) => (b.aiEffectiveEv ?? -Infinity) - (a.aiEffectiveEv ?? -Infinity))
      .slice(0, 7);
    const ps = top7ByEv.map((h) => h.aiPredictedWinRate as number);
    const avgP = ps.reduce((s, v) => s + v, 0) / ps.length;
    const stdevP = Math.sqrt(ps.reduce((s, v) => s + (v - avgP) ** 2, 0) / ps.length);
    expect(stdevP).toBeLessThan(WIN_RATE_STDEV_THRESHOLD);
  });
});
