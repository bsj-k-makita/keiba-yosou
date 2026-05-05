import { describe, expect, test } from "vitest";
import { getFrameColor } from "./frameColor";
import { computeConnectionSpecialBadges } from "./evaluationTags";

describe("frame color mapping", () => {
  test("returns official frame colors", () => {
    expect(getFrameColor(1).bg).toBe("#ffffff");
    expect(getFrameColor(2).bg).toBe("#202124");
    expect(getFrameColor(8).bg).toBe("#f9a8d4");
  });
});

describe("computeConnectionSpecialBadges", () => {
  test("adds temperament warning badge when temperament risk is high", () => {
    const badges = computeConnectionSpecialBadges(
      {
        horseId: "h1",
        horseName: "テストホース",
        runningStyle: "先行",
        speed: 70,
        stamina: 70,
        kick: 70,
        sustain: 70,
        power: 70,
        signals: { temperamentConcern01: 0.8 },
      },
      {
        venue: "京都",
        ground: "good",
        bias: "flat",
        pace: "middle",
        adjustmentStrength: "middle",
        distance: 3200,
      },
    );
    expect(badges.some((b) => b.includes("折り合い注意"))).toBe(true);
  });
});
