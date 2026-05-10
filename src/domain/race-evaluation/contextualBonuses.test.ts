import { describe, expect, test } from "vitest";
import { computeContextualBonuses } from "./contextualBonuses";
import type { HorseAbility, RaceCondition } from "./abilityTypes";

describe("computeContextualBonuses gateBiasBonus", () => {
  test("馬場傾向フラットでも馬番ピンポイント不利を gateBiasBonus に反映する", () => {
    const horse = {
      horseId: "x",
      horseName: "X",
      speed: 50,
      stamina: 50,
      kick: 50,
      sustain: 50,
      power: 50,
      frameNumber: 1,
      runningStyle: "好位",
      gate: 1,
    } as HorseAbility & { gate: number };
    const condition: RaceCondition = {
      venue: "東京",
      ground: "good",
      bias: "flat",
      pace: "middle",
      adjustmentStrength: "middle",
      disfavoredHorseNumbers: [1],
    };
    const b = computeContextualBonuses(horse, condition, 16);
    expect(b.gateBiasBonus).toBe(-8);
  });

  test("馬場フラットでもコーナー既定時に外枠先行へ枠×脚質シナジーが付く（以前はゼロだった）", () => {
    const outerFront = {
      horseId: "o",
      horseName: "O",
      speed: 50,
      stamina: 50,
      kick: 50,
      sustain: 50,
      power: 50,
      frameNumber: 8,
      runningStyle: "先行",
    } as HorseAbility;
    const innerFront = { ...outerFront, frameNumber: 1 };
    const flat: RaceCondition = {
      venue: "東京",
      ground: "good",
      bias: "flat",
      pace: "middle",
      adjustmentStrength: "middle",
    };
    const bOuter = computeContextualBonuses(outerFront, flat, 16);
    const bInner = computeContextualBonuses(innerFront, flat, 16);
    expect(bOuter.gateStyleSynergyBonus).toBeLessThan(0);
    expect(bInner.gateStyleSynergyBonus).toBeGreaterThan(0);
    expect(bInner.gateStyleSynergyBonus).toBeGreaterThan(bOuter.gateStyleSynergyBonus);
  });
});
