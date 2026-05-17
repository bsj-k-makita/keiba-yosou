import { describe, expect, test } from "vitest";
import { buildOptimizedTrifectaCombinations, generateTickets } from "./bettingRules";

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

  test("2列目拡張で3連複点数が増える", () => {
    const base = buildOptimizedTrifectaCombinations([
      { mark: "◎", horseNumber: 1 },
      { mark: "○", horseNumber: 5 },
      { mark: "▲", horseNumber: 8 },
      { mark: "△", horseNumber: 3 },
      { mark: "△", horseNumber: 7 },
    ]);
    const expanded = buildOptimizedTrifectaCombinations([
      { mark: "◎", horseNumber: 1 },
      { mark: "○", horseNumber: 5 },
      { mark: "▲", horseNumber: 8 },
      { mark: "△", horseNumber: 3, hokkakeRole: "△1安定" },
      { mark: "△", horseNumber: 7 },
    ]);
    expect(base.length).toBe(4);
    expect(expanded.length).toBe(5);
  });

  test("爆穴☆は2列目昇格", () => {
    const combos = buildOptimizedTrifectaCombinations([
      { mark: "◎", horseNumber: 1 },
      { mark: "○", horseNumber: 5 },
      { mark: "▲", horseNumber: 8 },
      { mark: "☆", horseNumber: 12, longshotReversalTrigger: true },
      { mark: "△", horseNumber: 3 },
    ]);
    expect(combos.some((c) => c.includes(12) && c.includes(1))).toBe(true);
    expect(combos.some((c) => c.includes(1) && c.includes(12) && !c.includes(5))).toBe(true);
  });
});
