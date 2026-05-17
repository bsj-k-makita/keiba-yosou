import { describe, expect, test } from "vitest";
import { analyzeSecondRowStatus, aggregateSecondRowDead } from "./secondRowAnalysis";

describe("secondRowAnalysis", () => {
  test("2列目全滅を検知", () => {
    const status = analyzeSecondRowStatus(
      [
        { mark: "◎", horseNumber: 1 },
        { mark: "○", horseNumber: 5 },
        { mark: "▲", horseNumber: 8 },
      ],
      "CONDITIONAL_LOWER",
      [1, 3, 9],
      1,
    );
    expect(status.isAnchorHit).toBe(true);
    expect(status.isSecondRowHit).toBe(false);
    expect(status.isSecondRowDead).toBe(true);
  });

  test("2列目全滅率を集計", () => {
    const agg = aggregateSecondRowDead([
      { isAnchorHit: true, isSecondRowDead: true },
      { isAnchorHit: true, isSecondRowDead: false },
      { isAnchorHit: false, isSecondRowDead: false },
    ]);
    expect(agg.anchorSurvivedRaces).toBe(2);
    expect(agg.secondRowDeadCount).toBe(1);
    expect(agg.secondRowDeadRate).toBe(50);
  });
});
