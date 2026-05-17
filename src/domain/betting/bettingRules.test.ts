import { describe, expect, test } from "vitest";
import { generateTickets } from "./bettingRules";

describe("generateTickets", () => {
  test("定型3ルールの点数", () => {
    const tickets = generateTickets([
      { mark: "◎", horseNumber: 1 },
      { mark: "○", horseNumber: 5 },
      { mark: "▲", horseNumber: 8 },
      { mark: "△", horseNumber: 3 },
      { mark: "△", horseNumber: 7 },
    ]);
    expect(tickets.find((t) => t.ticketType === "WIN")?.combinations).toEqual([[1]]);
    expect(tickets.find((t) => t.ticketType === "MAIN_LINE")?.combinations.length).toBe(3);
    expect(tickets.find((t) => t.ticketType === "TRIFECTA_FORM")?.combinations.length).toBe(4);
  });
});
