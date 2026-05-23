import { describe, expect, it } from "vitest";
import { hasQuinellaWideAndTrifectaPayouts, isUsableRaceResult } from "./raceResultLoad";
import type { RaceResultData, RaceResultPlace } from "./raceEvaluationTypes";

function minimalPlaces(count: number): RaceResultPlace[] {
  return Array.from({ length: count }, (_, i) => ({
    place: i + 1,
    horseId: `horse-${i + 1}`,
    horseNumber: i + 1,
    horseName: `馬${i + 1}`,
  }));
}

function minimalResult(places: RaceResultPlace[]): RaceResultData {
  return {
    raceId: "202608030904",
    fetchedAt: "2026-05-23T00:00:00.000Z",
    places,
  };
}

describe("isUsableRaceResult", () => {
  it("accepts 3+ places with horseNumber only", () => {
    expect(isUsableRaceResult(minimalResult(minimalPlaces(3)))).toBe(true);
  });

  it("rejects fewer than 3 valid places", () => {
    expect(isUsableRaceResult(minimalResult(minimalPlaces(2)))).toBe(false);
    expect(isUsableRaceResult(null)).toBe(false);
  });
});

describe("hasQuinellaWideAndTrifectaPayouts", () => {
  it("requires REN, WREN, TRI", () => {
    const base = minimalResult(minimalPlaces(3));
    expect(hasQuinellaWideAndTrifectaPayouts(base)).toBe(false);
    const full: RaceResultData = {
      ...base,
      payouts: {
        WIN: [],
        SHOW: [],
        REN: [{ numbers: [1, 2], dividend: 100 }],
        WREN: [{ numbers: [1, 2], dividend: 50 }],
        TRI: [{ numbers: [1, 2, 3], dividend: 200 }],
      },
    };
    expect(hasQuinellaWideAndTrifectaPayouts(full)).toBe(true);
  });
});
