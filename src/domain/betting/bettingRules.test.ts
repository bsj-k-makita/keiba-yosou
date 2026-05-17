import { describe, expect, test } from "vitest";
import {
  buildOptimizedTrifectaCombinations,
  buildSecondRowNumbers,
  buildThirdRowNumbers,
  generateTickets,
  resolvePostProcessFavoriteNumber,
} from "./bettingRules";

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
    expect(combos.length).toBe(6);
    expect(combos.every((c) => c.includes(1) && (c.includes(5) || c.includes(8)))).toBe(true);
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

  test("3列目は6位以下ノーマーク△を間引く", () => {
    const marks = [
      { mark: "◎", horseNumber: 1 },
      { mark: "○", horseNumber: 5 },
      { mark: "▲", horseNumber: 8 },
      { mark: "△", horseNumber: 3, hokkakeRole: "△2物理" },
      { mark: "△", horseNumber: 7, finalRank: 8 },
      { mark: "☆", horseNumber: 12 },
    ];
    expect(buildThirdRowNumbers(marks).sort((a, b) => a - b)).toEqual([3, 12]);
  });

  test("generateTickets 単勝・馬連", () => {
    const tickets = generateTickets(baseMarks);
    expect(tickets.find((t) => t.ticketType === "WIN")?.combinations).toEqual([[1]]);
    expect(tickets.find((t) => t.ticketType === "MAIN_LINE")?.combinations.length).toBe(3);
  });
});
