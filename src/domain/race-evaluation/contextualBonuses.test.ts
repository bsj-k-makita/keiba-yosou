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
});
