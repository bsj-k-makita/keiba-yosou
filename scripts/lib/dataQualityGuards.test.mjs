import { describe, expect, test } from "vitest";
import { isDebutRaceName, shouldFailByPastRunQuality } from "./dataQualityGuards.mjs";

describe("dataQualityGuards (fetch)", () => {
  test("isDebutRaceName detects 新馬 races", () => {
    expect(isDebutRaceName("2歳新馬")).toBe(true);
    expect(isDebutRaceName("3歳未勝利")).toBe(false);
  });

  test("allows debut race with zero pastRuns", () => {
    const data = {
      meta: { raceName: "2歳新馬" },
      entries: Array.from({ length: 12 }, () => ({})),
    };
    expect(shouldFailByPastRunQuality(data, { successCount: 0 })).toBe(false);
  });

  test("fails non-debut race with zero pastRuns", () => {
    const data = {
      meta: { raceName: "3歳未勝利" },
      entries: Array.from({ length: 12 }, () => ({})),
    };
    expect(shouldFailByPastRunQuality(data, { successCount: 0 })).toBe(true);
  });
});
