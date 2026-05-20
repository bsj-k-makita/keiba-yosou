import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { HorseAbility } from "../../domain/race-evaluation/abilityTypes";
import { convertToRaceEvaluationData } from "../race-data/convertToRaceEvaluationData";
import { raceDataToHorses } from "../race-data/raceDataToHorses";
import {
  EV_STDEV_THRESHOLD,
  EV_WORTHLESS_THRESHOLD,
  resolveAiRaceRegime,
} from "./aiEvRegime";

function horse(id: string, ev: number): HorseAbility {
  return {
    horseId: id,
    horseName: id,
    runningStyle: "先行",
    speed: 70,
    stamina: 70,
    kick: 70,
    sustain: 70,
    power: 70,
    aiPredictedWinRate: 0.05,
    aiEffectiveEv: ev,
  };
}

describe("resolveAiRaceRegime", () => {
  it("最高EVが閾値以上なら NORMAL", () => {
    const horses = [horse("a", 0.2), horse("b", -0.05), horse("c", -0.12)];
    expect(resolveAiRaceRegime(horses)).toBe("NORMAL_AI_REGIME");
  });

  it("全頭が床付近で横並びなら NO_EV", () => {
    const horses = Array.from({ length: 10 }, (_, i) => horse(String(i), -0.15));
    expect(resolveAiRaceRegime(horses)).toBe("NO_EV_REGIME");
  });

  it("最高EVは低いが上位に差があれば NORMAL", () => {
    const horses = [
      horse("a", -0.05),
      ...Array.from({ length: 6 }, (_, i) => horse(`b${i}`, -0.15)),
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
    const evs = horses.map((h) => h.aiEffectiveEv).filter((v) => v != null) as number[];
    expect(Math.max(...evs)).toBeLessThan(EV_WORTHLESS_THRESHOLD);
    const top7 = [...evs].sort((a, b) => b - a).slice(0, 7);
    const avg = top7.reduce((s, v) => s + v, 0) / top7.length;
    const stdev = Math.sqrt(
      top7.reduce((s, v) => s + (v - avg) ** 2, 0) / top7.length,
    );
    expect(stdev).toBeLessThan(EV_STDEV_THRESHOLD);
  });
});
