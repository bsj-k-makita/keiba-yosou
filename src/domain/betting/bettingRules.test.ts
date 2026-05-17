import { describe, expect, test } from "vitest";
import {
  buildOptimizedTrifectaCombinations,
  buildSecondRowNumbers,
  buildThirdRowNumbers,
  buildWideCombinations,
  generateTickets,
  resolvePostProcessFavoriteNumber,
} from "./bettingRules";
import { calculateRacePayout } from "./payoutCalculator";

describe("generateTickets", () => {
  const baseMarks = [
    { mark: "◎", horseNumber: 1 },
    { mark: "○", horseNumber: 5 },
    { mark: "▲", horseNumber: 8 },
    { mark: "△", horseNumber: 3, finalRank: 4, hokkakeRole: "△1安定" as const },
    { mark: "△", horseNumber: 7, finalRank: 5 },
    { mark: "☆", horseNumber: 12 },
  ];

  test("未勝利Tierは2列目を○▲のみに逆縮小", () => {
    const second = buildSecondRowNumbers(baseMarks, "MAIDEN_NEW");
    expect(second.sort((a, b) => a - b)).toEqual([5, 8]);
    const combos = buildOptimizedTrifectaCombinations(baseMarks, { classTier: "MAIDEN_NEW" });
    expect(combos.length).toBeGreaterThanOrEqual(6);
    expect(combos.some((c) => [...c].sort((a, b) => a - b).join("-") === "1-5-8")).toBe(true);
  });

  test("OP・重賞Tierは2列目拡張", () => {
    const marks = [
      ...baseMarks,
      { mark: "△", horseNumber: 9, finalRank: 4, connectionsBonus: 4 },
    ];
    const second = buildSecondRowNumbers(marks, "G1_CLASS");
    expect(second).toContain(3);
    expect(second).toContain(9);
  });

  test("軸は最終印◎のみ", () => {
    const marks = [
      { mark: "◎", horseNumber: 9, finalRank: 2 },
      { mark: "○", horseNumber: 5, finalRank: 1 },
      { mark: "▲", horseNumber: 8, finalRank: 3 },
      { mark: "△", horseNumber: 3, finalRank: 4, hokkakeRole: "△1安定" as const },
    ];
    expect(resolvePostProcessFavoriteNumber(marks)).toBe(9);
  });

  test("3列目は○▲☆△（2列目と重複して◎-○-▲を形成可能）", () => {
    const marks = [
      { mark: "◎", horseNumber: 1 },
      { mark: "○", horseNumber: 5 },
      { mark: "▲", horseNumber: 8 },
      { mark: "△", horseNumber: 3, hokkakeRole: "△2物理" as const },
      { mark: "△", horseNumber: 7, finalRank: 8 },
      { mark: "☆", horseNumber: 12 },
    ];
    expect(buildThirdRowNumbers(marks).sort((a, b) => a - b)).toEqual([3, 5, 8, 12]);
  });

  test("◎○▲が3着内なら3連複的中（着順入替えでも可）", () => {
    const marks = [
      { mark: "◎", horseNumber: 1 },
      { mark: "○", horseNumber: 5 },
      { mark: "▲", horseNumber: 8 },
      { mark: "△", horseNumber: 3, hokkakeRole: "△1安定" as const },
    ];
    const combos = buildOptimizedTrifectaCombinations(marks);
    const key = (c: number[]) => [...c].sort((a, b) => a - b).join("-");
    expect(combos.some((c) => key(c) === "1-5-8")).toBe(true);

    const tickets = generateTickets(marks);
    const result = calculateRacePayout(tickets, {
      raceId: "test",
      classLevel: "OTHER",
      finishOrder: [5, 1, 8],
      winOddsByNumber: new Map(),
    });
    expect(result.byType.TRIFECTA_FORM.hitCount).toBeGreaterThan(0);
  });

  test("generateTickets 単勝・馬連", () => {
    const tickets = generateTickets(baseMarks);
    expect(tickets.find((t) => t.ticketType === "WIN")?.combinations).toEqual([[1]]);
    expect(tickets.find((t) => t.ticketType === "MAIN_LINE")?.combinations.length).toBe(3);
  });

  test("ワイドは◎と各印（○▲☆△）の組み合わせ", () => {
    const wide = buildWideCombinations(baseMarks, 1);
    const keys = wide.map((c) => c.join("-")).sort();
    expect(keys).toEqual(["1-12", "1-3", "1-5", "1-7", "1-8"]);
  });

  test("ワイドは3着内に両方入れば的中", () => {
    const tickets = generateTickets(baseMarks);
    const official = {
      WIN: [],
      SHOW: [],
      REN: [],
      WREN: [
        { numbers: [1, 5], dividend: 250 },
        { numbers: [1, 8], dividend: 350 },
      ],
      TRI: [],
    };
    const result = calculateRacePayout(tickets, {
      raceId: "test",
      classLevel: "OTHER",
      finishOrder: [5, 1, 8],
      winOddsByNumber: new Map(),
      officialPayouts: official,
    });
    expect(result.byType.WIDE.hitCount).toBe(2);
    expect(result.byType.WIDE.payout).toBe(600);
    expect(result.byType.WIDE.estimatedPayout).toBe(false);
  });
});
