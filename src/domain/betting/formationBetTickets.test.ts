import { describe, expect, test } from "vitest";
import { generateFormationBetTickets } from "./bettingRules";

describe("generateFormationBetTickets", () => {
  const marks = [
    { horseNumber: 4, mark: "◎" },
    { horseNumber: 2, mark: "○" },
    { horseNumber: 8, mark: "▲" },
    { horseNumber: 1, mark: "△" },
  ];

  test("◎がいれば単勝・馬連・ワイド・3連複を生成", () => {
    const tickets = generateFormationBetTickets(marks, "MAIDEN_NEW", 100);
    expect(tickets.find((t) => t.ticketType === "WIN")?.combinations).toEqual([[4]]);
    expect(tickets.find((t) => t.ticketType === "MAIN_LINE")?.combinations).toEqual([[2, 4]]);
    expect(tickets.find((t) => t.ticketType === "WIDE")!.combinations.length).toBeGreaterThan(0);
    expect(tickets.find((t) => t.ticketType === "TRIFECTA_FORM")!.combinations.length).toBeGreaterThan(
      0,
    );
    const invested = tickets.reduce((s, t) => s + t.combinations.length * t.betAmount, 0);
    expect(invested).toBeGreaterThan(100);
  });
});
