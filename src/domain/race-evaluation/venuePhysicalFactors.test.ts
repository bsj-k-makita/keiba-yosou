import { describe, expect, test } from "vitest";
import { getBaseWeights, getFinalWeights } from "./weightResolver";
import {
  applyVenuePhysicalFactorAdjustments,
  resolveVenuePhysicalFactorKey,
  VENUE_PHYSICAL_FACTORS,
} from "./venuePhysicalFactors";
import type { RaceCondition } from "./abilityTypes";

function sumWeights(w: Record<string, number>): number {
  return Object.values(w).reduce((a, b) => a + b, 0);
}

describe("venuePhysicalFactors", () => {
  test("resolveVenuePhysicalFactorKey maps 京都 to 京都外 and 新潟 to 新潟外", () => {
    expect(
      resolveVenuePhysicalFactorKey({
        venue: "京都",
        ground: "good",
        bias: "flat",
        pace: "middle",
        adjustmentStrength: "middle",
      }),
    ).toBe("京都外");
    expect(
      resolveVenuePhysicalFactorKey({
        venue: "京都",
        courseKey: "京都内",
        ground: "good",
        bias: "flat",
        pace: "middle",
        adjustmentStrength: "middle",
      }),
    ).toBe("京都内");
    expect(
      resolveVenuePhysicalFactorKey({
        venue: "新潟",
        ground: "good",
        bias: "flat",
        pace: "middle",
        adjustmentStrength: "middle",
      }),
    ).toBe("新潟外");
  });

  test("applyVenuePhysicalFactorAdjustments returns normalized weights", () => {
    const c: RaceCondition = {
      venue: "東京",
      ground: "good",
      bias: "flat",
      pace: "middle",
      adjustmentStrength: "middle",
      distance: 2000,
      surface: "芝",
    };
    const base = getBaseWeights(c);
    const out = applyVenuePhysicalFactorAdjustments(base, c);
    expect(sumWeights(out)).toBeCloseTo(1, 5);
    expect(out.speed).toBeGreaterThan(0);
  });

  test("getFinalWeights uses physical layer then still normalizes", () => {
    const c: RaceCondition = {
      venue: "福島",
      ground: "good",
      trackSpeed: "standard",
      bias: "flat",
      pace: "middle",
      adjustmentStrength: "middle",
      distance: 1200,
      surface: "ダート",
    };
    const w = getFinalWeights(c);
    expect(sumWeights(w)).toBeCloseTo(1, 5);
  });

  test("VENUE_PHYSICAL_FACTORS has expected keys from spec", () => {
    for (const k of [
      "東京",
      "中山",
      "京都外",
      "京都内",
      "阪神外",
      "中京",
      "福島",
      "新潟外",
      "小倉",
      "札幌",
      "函館",
    ]) {
      expect(VENUE_PHYSICAL_FACTORS[k]).toBeDefined();
    }
  });
});
