import { describe, expect, test } from "vitest";
import {
  buildDiagnosisLabel,
  formatFinishWithMarks,
  sortRaceDetailsForDisplay,
} from "./raceDetailLog";
import type { RaceDetailLog } from "./types";

function baseDetail(overrides: Partial<RaceDetailLog> = {}): RaceDetailLog {
  return {
    raceId: "r1",
    raceName: "テストS",
    classTier: "CONDITIONAL_LOWER",
    classTierLabel: "3勝下",
    venue: "東京",
    raceNumber: 11,
    date: "2026-05-01",
    actualResults: [1, 2, 3],
    finishLabel: "1(◎)→2(○)→3(△)",
    aiMarks: { "1": "◎", "2": "○" },
    tickets: {
      WIN: { invested: 100, payout: 0, isHit: false },
      MAIN_LINE: { invested: 300, payout: 0, isHit: false },
      WIDE: { invested: 500, payout: 0, isHit: false },
      TRIFECTA_FORM: { invested: 300, payout: 0, isHit: false },
    },
    totalInvested: 700,
    totalPayout: 0,
    dominantComment: "先行有利",
    isAnchorHit: true,
    isSecondRowDead: true,
    diagnosisLabel: "",
    ...overrides,
  };
}

describe("raceDetailLog", () => {
  test("着順ラベルを印付きで整形", () => {
    expect(formatFinishWithMarks([12, 7, 3], { "12": "◎", "7": "○", "3": "△" })).toBe(
      "12(◎)→7(○)→3(△)",
    );
  });

  test("2列目全滅の診断ラベル", () => {
    expect(buildDiagnosisLabel(baseDetail())).toBe("【2列目全滅】3着にヒモ決着");
  });

  test("払戻順にソート", () => {
    const sorted = sortRaceDetailsForDisplay([
      baseDetail({ raceId: "a", totalPayout: 0 }),
      baseDetail({ raceId: "b", totalPayout: 5000 }),
    ]);
    expect(sorted[0]!.raceId).toBe("b");
  });
});
