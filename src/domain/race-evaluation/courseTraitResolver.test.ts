import { describe, expect, test } from "vitest";
import type { HorseAbility, RaceCondition } from "./abilityTypes";
import {
  resolveCourseTraitKey,
  resolveCourseTraits,
  computeCourseTraitHits,
} from "./courseTraitResolver";

function baseHorse(over: Partial<HorseAbility>): HorseAbility {
  return {
    horseId: "h1",
    horseName: "テスト",
    runningStyle: "先行",
    speed: 55,
    stamina: 55,
    kick: 55,
    sustain: 55,
    power: 55,
    ...over,
  };
}

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

describe("resolveCourseTraitKey", () => {
  test("京都芝1600外で _OUT キー", () => {
    const key = resolveCourseTraitKey(
      cond({
        venue: "京都",
        surface: "芝",
        distance: 1600,
        courseKey: "京都1600外",
      }),
    );
    expect(key).toBe("KYOTO_T1600_OUT");
  });

  test("中京→ CHUKYO プレフィックス", () => {
    const key = resolveCourseTraitKey(
      cond({ venue: "中京", surface: "芝", distance: 2000 }),
    );
    expect(key).toBe("CHUKYO_T2000");
  });
});

describe("computeCourseTraitHits", () => {
  test("新潟芝1000・外枠差しで大きくプラス", () => {
    const h = baseHorse({
      runningStyle: "差し",
      frameNumber: 8,
    });
    const c = cond({
      venue: "新潟",
      surface: "芝",
      distance: 1000,
    });
    const traits = resolveCourseTraits(c);
    expect(traits).toContain("OUTSIDE_EDGE_MAX");
    const hits = computeCourseTraitHits(h, c);
    const sum = hits.reduce((s, x) => s + x.bonus, 0);
    expect(sum).toBeGreaterThan(5);
  });

  test("短い初角コースで外枠先行はマイナス", () => {
    const h = baseHorse({
      runningStyle: "先行",
      frameNumber: 7,
    });
    const c = cond({
      venue: "中山",
      surface: "芝",
      distance: 1600,
    });
    const hits = computeCourseTraitHits(h, c);
    const neg = hits.filter((x) => x.bonus < 0);
    expect(neg.length).toBeGreaterThan(0);
  });
});
