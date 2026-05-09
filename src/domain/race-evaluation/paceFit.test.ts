import { describe, expect, test } from "vitest";
import type { HorseAbility, RaceCondition } from "./abilityTypes";
import { PACE_FIT } from "./lingoConstants";
import {
  computeKickInTopFractionMap,
  computePaceFitEvaluation,
  computePaceFitLevel,
  computePaceScenarioAmplifier,
} from "./paceFit";

function cond(over: Partial<RaceCondition>): RaceCondition {
  return {
    venue: "東京",
    ground: "good",
    bias: "flat",
    pace: "middle",
    adjustmentStrength: "middle",
    ...over,
  };
}

function horse(
  id: string,
  runningStyle: HorseAbility["runningStyle"],
  kick: number,
): HorseAbility {
  return {
    horseId: id,
    horseName: id,
    runningStyle,
    speed: 50,
    stamina: 50,
    kick,
    sustain: 50,
    power: 50,
  };
}

describe("computePaceFitEvaluation", () => {
  test("前残り×スローで差しは ×（-5）", () => {
    const h = horse("a", "差し", 90);
    const c = cond({ bias: "front_favor", pace: "slow" });
    const r = computePaceFitEvaluation(h, c);
    expect(r.token).toBe(PACE_FIT.BAD);
    expect(r.bonus).toBe(-5);
  });

  test("前残り×スローで追込は極端ペナルティ（-10）", () => {
    const h = horse("a", "追込", 90);
    const c = cond({ bias: "front_favor", pace: "slow" });
    const r = computePaceFitEvaluation(h, c);
    expect(r.token).toBe(PACE_FIT.BAD);
    expect(r.bonus).toBe(-10);
  });

  test("前残り×ミドル×差しで末脚が下位なら ×（kickInTopFraction: false）", () => {
    const h = horse("a", "差し", 40);
    const c = cond({ bias: "front_favor", pace: "middle" });
    const r = computePaceFitEvaluation(h, c, { kickInTopFraction: false });
    expect(r.token).toBe(PACE_FIT.BAD);
    expect(r.bonus).toBe(-5);
  });

  test("前残り×ミドル×差しで末脚上位なら末脚ゲートなし（△相当の bonus 0）", () => {
    const h = horse("a", "差し", 90);
    const c = cond({ bias: "front_favor", pace: "middle" });
    const r = computePaceFitEvaluation(h, c, { kickInTopFraction: true });
    expect(r.token).not.toBe(PACE_FIT.BAD);
    expect(r.bonus).toBe(0);
  });

  test("context なしでは末脚ゲートを掛けない（△を維持しうる）", () => {
    const h = horse("a", "差し", 10);
    const c = cond({ bias: "front_favor", pace: "middle" });
    const r = computePaceFitEvaluation(h, c);
    expect(r.token).toBe(PACE_FIT.MAYBE);
  });
});

describe("computeKickInTopFractionMap", () => {
  test("上位20%相当の頭数をマークする", () => {
    const horses = [
      horse("a", "好位", 100),
      horse("b", "好位", 80),
      horse("c", "好位", 60),
      horse("d", "好位", 40),
      horse("e", "好位", 20),
    ];
    const m = computeKickInTopFractionMap(horses, 0.2);
    expect(m.get("a")).toBe(true);
    expect(m.get("e")).toBe(false);
  });
});

describe("computePaceScenarioAmplifier", () => {
  test("strong + 前残りで係数 > 1", () => {
    expect(
      computePaceScenarioAmplifier(
        cond({ adjustmentStrength: "strong", bias: "front_favor" }),
      ),
    ).toBe(1.6);
  });

  test("middle では 1", () => {
    expect(computePaceScenarioAmplifier(cond({}))).toBe(1);
  });
});

describe("computePaceFitLevel", () => {
  test("オプション context を踏襲する", () => {
    const h = horse("x", "差し", 30);
    const c = cond({ bias: "front_favor", pace: "middle" });
    expect(computePaceFitLevel(h, c)).toBe(PACE_FIT.MAYBE);
    expect(computePaceFitLevel(h, c, { kickInTopFraction: false })).toBe(PACE_FIT.BAD);
  });
});
