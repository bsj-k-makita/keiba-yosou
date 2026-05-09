import { describe, expect, test } from "vitest";
import type { HorseAbility, RaceCondition } from "./abilityTypes";
import { resolveEffectiveRacePace } from "./paceSeverity";

function horse(style: string): HorseAbility {
  return {
    horseId: "x",
    horseName: "X",
    runningStyle: style as HorseAbility["runningStyle"],
    speed: 55,
    stamina: 50,
    kick: 50,
    sustain: 50,
    power: 50,
  };
}

describe("resolveEffectiveRacePace", () => {
  test("manual mode keeps middle without inferring many_front_runners", () => {
    const condition: RaceCondition = {
      venue: "東京",
      ground: "good",
      bias: "flat",
      pace: "middle",
      adjustmentStrength: "middle",
      paceInference: "manual",
    };
    const horses: HorseAbility[] = [
      horse("逃げ"),
      horse("逃げ"),
      horse("逃げ"),
      horse("先行"),
    ];
    expect(resolveEffectiveRacePace(condition, horses)).toBe("middle");
  });

  test("auto mode still infers from field when pace is middle", () => {
    const condition: RaceCondition = {
      venue: "東京",
      ground: "good",
      bias: "flat",
      pace: "middle",
      adjustmentStrength: "middle",
    };
    const horses: HorseAbility[] = [
      horse("逃げ"),
      horse("逃げ"),
      horse("逃げ"),
      horse("先行"),
    ];
    expect(resolveEffectiveRacePace(condition, horses)).toBe("many_front_runners");
  });
});
