import { describe, expect, test } from "vitest";
import {
  buildOptimizedTrifectaCombinations,
  buildThirdRowNumbers,
  generateTickets,
  resolvePostProcessFavoriteNumber,
} from "./bettingRules";

describe("generateTickets", () => {
  test("定型3ルールの単勝・馬連", () => {
    const tickets = generateTickets([
      { mark: "◎", horseNumber: 1 },
      { mark: "○", horseNumber: 5 },
      { mark: "▲", horseNumber: 8 },
      { mark: "△", horseNumber: 3 },
      { mark: "△", horseNumber: 7 },
    ]);
    expect(tickets.find((t) => t.ticketType === "WIN")?.combinations).toEqual([[1]]);
    expect(tickets.find((t) => t.ticketType === "MAIN_LINE")?.combinations.length).toBe(3);
  });

  test("軸は最終印◎のみ（finalRank 1位ではない）", () => {
    const marks = [
      { mark: "◎", horseNumber: 9, finalRank: 2 },
      { mark: "○", horseNumber: 5, finalRank: 1 },
      { mark: "▲", horseNumber: 8, finalRank: 3 },
      { mark: "△", horseNumber: 3, finalRank: 4, hokkakeRole: "△1安定" as const },
    ];
    expect(resolvePostProcessFavoriteNumber(marks)).toBe(9);
    expect(generateTickets(marks).find((t) => t.ticketType === "WIN")?.combinations).toEqual([[9]]);
  });

  test("3列目はヒモ役優先・6位以下ノーマーク△を間引く", () => {
    const marks = [
      { mark: "◎", horseNumber: 1 },
      { mark: "○", horseNumber: 5 },
      { mark: "▲", horseNumber: 8 },
      { mark: "△", horseNumber: 3, hokkakeRole: "△2物理" },
      { mark: "△", horseNumber: 7, finalRank: 8 },
      { mark: "☆", horseNumber: 12 },
    ];
    expect(buildThirdRowNumbers(marks).sort((a, b) => a - b)).toEqual([3, 12]);
    const combos = buildOptimizedTrifectaCombinations(marks);
    expect(combos.every((c) => !c.includes(7))).toBe(true);
  });

  test("2列目拡張で3連複点数が増える", () => {
    const base = buildOptimizedTrifectaCombinations([
      { mark: "◎", horseNumber: 1 },
      { mark: "○", horseNumber: 5 },
      { mark: "▲", horseNumber: 8 },
      { mark: "△", horseNumber: 3, finalRank: 4 },
      { mark: "△", horseNumber: 7, finalRank: 5 },
    ]);
    const expanded = buildOptimizedTrifectaCombinations([
      { mark: "◎", horseNumber: 1 },
      { mark: "○", horseNumber: 5 },
      { mark: "▲", horseNumber: 8 },
      { mark: "△", horseNumber: 3, hokkakeRole: "△1安定", finalRank: 4 },
      { mark: "△", horseNumber: 7, finalRank: 5 },
    ]);
    expect(base.length).toBe(4);
    expect(expanded.length).toBe(5);
  });
});
