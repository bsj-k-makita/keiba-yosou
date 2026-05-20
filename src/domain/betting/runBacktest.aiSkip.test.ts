import { describe, expect, test } from "vitest";
import { shouldSkipAiFormationBets } from "./bettingRules";

describe("shouldSkipAiFormationBets", () => {
  test("AIかつEV推奨0点のときのみ定型フォーメをスキップ", () => {
    expect(shouldSkipAiFormationBets("ai", 0)).toBe(true);
    expect(shouldSkipAiFormationBets("ai", 1)).toBe(false);
    expect(shouldSkipAiFormationBets("ai", 3)).toBe(false);
  });

  test("TSモードはEV点数に関わらずスキップしない", () => {
    expect(shouldSkipAiFormationBets("ts", 0)).toBe(false);
    expect(shouldSkipAiFormationBets("ts", 0)).toBe(false);
  });
});
