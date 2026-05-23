import { describe, expect, it } from "vitest";
import { hasQuinellaWideAndTrifectaPayouts, isUsableRaceResult } from "./raceResultLoad";
import type { RaceResultData } from "./raceEvaluationTypes";

function minimalPlaces(count: number) {
  return Array.from({ length: count }, (_, i) => ({
    place: i + 1,
    horseNumber: i + 1,
    horseName: `馬${i + 1}`,
  }));
}

describe("isUsableRaceResult", () => {
  it("accepts 3+ places with horseNumber only", () => {
    const data = { places: minimalPlaces(3) } as RaceResultData;
    expect(isUsableRaceResult(data)).toBe(true);
  });

  it("rejects fewer than 3 valid places", () => {
    expect(isUsableRaceResult({ places: minimalPlaces(2) })).toBe(false);
    expect(isUsableRaceResult(null)).toBe(false);
  });
});

describe("hasQuinellaWideAndTrifectaPayouts", () => {
  it("requires REN, WREN, TRI", () => {
    const base = { places: minimalPlaces(3), payouts: {} } as RaceResultData;
    expect(hasQuinellaWideAndTrifectaPayouts(base)).toBe(false);
    const full = {
      ...base,
      payouts: {
        REN: [{ numbers: [1, 2], dividend: 100 }],
        WREN: [{ numbers: [1, 2], dividend: 50 }],
        TRI: [{ numbers: [1, 2, 3], dividend: 200 }],
      },
    } as RaceResultData;
    expect(hasQuinellaWideAndTrifectaPayouts(full)).toBe(true);
  });
});
