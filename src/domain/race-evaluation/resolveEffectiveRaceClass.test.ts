import { describe, expect, test } from "vitest";
import {
  classTierFromPastRun,
  hasOpenClassStepCredibility,
  resolveEffectiveRaceClass,
} from "./resolveEffectiveRaceClass";

describe("resolveEffectiveRaceClass", () => {
  test("raceGrade を最優先", () => {
    expect(
      resolveEffectiveRaceClass({ raceName: "3歳未勝利", raceGrade: "G3" }),
    ).toBe("G2_G3_CLASS");
    expect(resolveEffectiveRaceClass({ raceName: "平安S", raceGrade: "G3" })).toBe(
      "G2_G3_CLASS",
    );
    expect(resolveEffectiveRaceClass({ raceName: "〇〇賞", raceGrade: "G1" })).toBe(
      "G1_CLASS",
    );
    expect(resolveEffectiveRaceClass({ raceName: "京王杯", raceGrade: "G2" })).toBe(
      "G2_G3_CLASS",
    );
    expect(resolveEffectiveRaceClass({ raceName: "函館記念", raceGrade: "S" })).toBe(
      "OPEN_LISTED",
    );
    expect(resolveEffectiveRaceClass({ raceName: "福島牝馬S", raceGrade: "L" })).toBe(
      "OPEN_LISTED",
    );
  });

  test("レース名のみの補完", () => {
    expect(resolveEffectiveRaceClass({ raceName: "3歳未勝利" })).toBe("MAIDEN_NEW");
    expect(resolveEffectiveRaceClass({ raceName: "3勝クラス" })).toBe("CONDITIONAL_UPPER");
    expect(resolveEffectiveRaceClass({ raceName: "1勝クラス" })).toBe("CONDITIONAL_LOWER");
    expect(resolveEffectiveRaceClass({ raceName: "東京優駿", netkeibaGradeType: 1 })).toBe(
      "G1_CLASS",
    );
  });

  test("ステップ実績トリガー", () => {
    const horse = {
      pastRuns: [
        { raceClass: "G3" as const, place: 4, marginToWinnerSec: 0.5 },
        { raceClass: "OP" as const, place: 8, marginToWinnerSec: 1.2 },
      ],
    };
    expect(hasOpenClassStepCredibility(horse, "G2_G3_CLASS")).toBe(true);
    expect(
      hasOpenClassStepCredibility(
        { pastRuns: [{ raceClass: "1勝", place: 2, marginToWinnerSec: 0.1 }] },
        "G1_CLASS",
      ),
    ).toBe(false);
    expect(classTierFromPastRun({ raceClass: "G1" })).toBe("G1_CLASS");
  });
});
