import { describe, expect, it } from "vitest";
import type { HorseAbility } from "../../domain/race-evaluation/abilityTypes";
import {
  ANOMALY_WIN_RATE_FLOOR,
  FAVORITE_ANOMALY_MAX_WIN_ODDS,
  WIN_RATE_STDEV_THRESHOLD,
  resolveAiRaceRegime,
} from "./aiEvRegime";

function horse(
  id: string,
  ev: number,
  winRate: number = 0.05,
  winOdds?: number,
): HorseAbility {
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
    signals: winOdds != null ? { winOdds } : undefined,
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

  it("1番人気相当が低オッズなのに勝率1%以下なら NO_EV", () => {
    const horses = [
      horse("fav", 0.1, ANOMALY_WIN_RATE_FLOOR, FAVORITE_ANOMALY_MAX_WIN_ODDS),
      horse("b", -0.05, 0.08, 30),
      horse("c", -0.08, 0.06, 50),
    ];
    expect(resolveAiRaceRegime(horses)).toBe("NO_EV_REGIME");
  });

  it("勝率がわずかにフラットでも maxEv が低ければ NO_EV（すり抜け対策）", () => {
    const horses = Array.from({ length: 8 }, (_, i) =>
      horse(String(i), -0.12, 0.06 + i * 0.0015, 10 + i),
    );
    expect(resolveAiRaceRegime(horses)).toBe("NO_EV_REGIME");
  });

  it("勝率stdevが閾値未満なら NO_EV（オークス型の横並び）", () => {
    const horses = Array.from({ length: 8 }, (_, i) =>
      horse(`h${i}`, -0.12, 0.05 + (i % 2) * 0.0001),
    );
    expect(resolveAiRaceRegime(horses)).toBe("NO_EV_REGIME");
    const ps = horses.map((h) => h.aiPredictedWinRate as number);
    const avgP = ps.reduce((s, v) => s + v, 0) / ps.length;
    const stdevP = Math.sqrt(ps.reduce((s, v) => s + (v - avgP) ** 2, 0) / ps.length);
    expect(stdevP).toBeLessThan(WIN_RATE_STDEV_THRESHOLD);
  });
});
