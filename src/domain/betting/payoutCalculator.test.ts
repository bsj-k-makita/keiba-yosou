import { describe, expect, test } from "vitest";
import { calculateRacePayout, lookupOfficialDividend } from "./payoutCalculator";
import type { BetTicket } from "./types";
import type { RaceOfficialPayouts } from "../../lib/race-data/raceEvaluationTypes";

const official: RaceOfficialPayouts = {
  WIN: [{ numbers: [2], dividend: 460 }],
  SHOW: [],
  REN: [{ numbers: [2, 7], dividend: 650 }],
  WREN: [{ numbers: [2, 7], dividend: 250 }],
  TRI: [{ numbers: [2, 7, 13], dividend: 840 }],
};

describe("lookupOfficialDividend", () => {
  test("馬連は順不同で一致", () => {
    expect(lookupOfficialDividend(official, "MAIN_LINE", [7, 2])).toBe(650);
    expect(lookupOfficialDividend(official, "WIDE", [2, 7])).toBe(250);
    expect(lookupOfficialDividend(official, "TRIFECTA_FORM", [13, 2, 7])).toBe(840);
  });
});

describe("calculateRacePayout", () => {
  test("確定払戻で1円単位の払戻", () => {
    const tickets: BetTicket[] = [
      { ticketType: "WIN", combinations: [[2]], betAmount: 100 },
      { ticketType: "MAIN_LINE", combinations: [[2, 7]], betAmount: 100 },
      { ticketType: "WIDE", combinations: [[2, 7]], betAmount: 100 },
      { ticketType: "TRIFECTA_FORM", combinations: [[2, 7, 13]], betAmount: 100 },
    ];
    const row = calculateRacePayout(tickets, {
      raceId: "test",
      classLevel: "OTHER",
      finishOrder: [2, 7, 13],
      winOddsByNumber: new Map(),
      officialPayouts: official,
    });
    expect(row.totalPayout).toBe(460 + 650 + 250 + 840);
    expect(row.byType.WIN.estimatedPayout).toBe(false);
    expect(row.byType.MAIN_LINE.estimatedPayout).toBe(false);
    expect(row.byType.WIDE.estimatedPayout).toBe(false);
    expect(row.byType.TRIFECTA_FORM.estimatedPayout).toBe(false);
  });
});
