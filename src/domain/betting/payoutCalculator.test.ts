import { describe, expect, test } from "vitest";
import { calculateRacePayout, checkOfficialHit, lookupOfficialDividend } from "./payoutCalculator";
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

  test("公式払戻の的中判定はソート済み完全一致のみ", () => {
    expect(checkOfficialHit("MAIN_LINE", [7, 2], official)).toBe(true);
    expect(checkOfficialHit("WIDE", [2, 8], official)).toBe(false);
    expect(checkOfficialHit("TRIFECTA_FORM", [2, 7, 9], official)).toBe(false);
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

  test("馬連: 公式払戻未取得時は推定オッズで払戻する", () => {
    const tickets: BetTicket[] = [
      { ticketType: "MAIN_LINE", combinations: [[1, 2]], betAmount: 100 },
    ];
    const row = calculateRacePayout(tickets, {
      raceId: "test",
      classLevel: "OTHER",
      finishOrder: [1, 2, 3],
      winOddsByNumber: new Map(),
      officialPayouts: {
        WIN: [],
        SHOW: [],
          REN: [],
        WREN: [],
        TRI: [],
      },
      fallbackExoticOdds: {
        ren: { "1-2": 6.5 },
      },
    });
    expect(row.byType.MAIN_LINE.hitCount).toBe(1);
    expect(row.byType.MAIN_LINE.payout).toBe(650);
    expect(row.byType.MAIN_LINE.estimatedPayout).toBe(true);
  });

  test("公式払戻がある券種は、着順一致ではなく配当行一致で的中判定する", () => {
    const row = calculateRacePayout(
      [{ ticketType: "MAIN_LINE", combinations: [[1, 2]], betAmount: 100 }],
      {
        raceId: "test",
        classLevel: "OTHER",
        finishOrder: [1, 2, 3],
        winOddsByNumber: new Map(),
        officialPayouts: {
          WIN: [],
          SHOW: [],
          REN: [{ numbers: [1, 3], dividend: 500 }],
          WREN: [],
          TRI: [],
        },
      },
    );
    expect(row.byType.MAIN_LINE.hitCount).toBe(0);
    expect(row.byType.MAIN_LINE.payout).toBe(0);
  });

  test("ワイド: 公式払戻未取得時は推定で払戻（0円にならない）", () => {
    const row = calculateRacePayout(
      [{ ticketType: "WIDE", combinations: [[4, 11]], betAmount: 100 }],
      {
        raceId: "test",
        classLevel: "OTHER",
        finishOrder: [11, 14, 4],
        winOddsByNumber: new Map(),
        officialPayouts: {
          WIN: [],
          SHOW: [],
          REN: [],
          WREN: [],
          TRI: [],
        },
        fallbackExoticOdds: {
          wide: { "4-11": 8.7 },
        },
      },
    );
    expect(row.byType.WIDE.hitCount).toBe(1);
    expect(row.byType.WIDE.payout).toBeCloseTo(870, 5);
  });

  test("ワイド: 公式払戻ありでは1頭一致の部分一致を的中扱いにしない", () => {
    const row = calculateRacePayout(
      [{ ticketType: "WIDE", combinations: [[2, 9]], betAmount: 100 }],
      {
        raceId: "test",
        classLevel: "OTHER",
        finishOrder: [2, 7, 9],
        winOddsByNumber: new Map(),
        officialPayouts: {
          WIN: [],
          SHOW: [],
          REN: [],
          WREN: [
            { numbers: [2, 7], dividend: 250 },
            { numbers: [2, 8], dividend: 300 },
            { numbers: [7, 8], dividend: 310 },
          ],
          TRI: [],
        },
      },
    );
    expect(row.byType.WIDE.hitCount).toBe(0);
    expect(row.byType.WIDE.payout).toBe(0);
  });

  test("3連複: 公式払戻ありでは2頭一致の部分一致を的中扱いにしない", () => {
    const row = calculateRacePayout(
      [{ ticketType: "TRIFECTA_FORM", combinations: [[2, 7, 15]], betAmount: 100 }],
      {
        raceId: "test",
        classLevel: "OTHER",
        finishOrder: [2, 7, 15],
        winOddsByNumber: new Map(),
        officialPayouts: {
          WIN: [],
          SHOW: [],
          REN: [],
          WREN: [],
          TRI: [{ numbers: [2, 7, 13], dividend: 840 }],
        },
      },
    );
    expect(row.byType.TRIFECTA_FORM.hitCount).toBe(0);
    expect(row.byType.TRIFECTA_FORM.payout).toBe(0);
  });

  test("同一馬番の不正組み合わせは的中扱いにしない", () => {
    const row = calculateRacePayout(
      [{ ticketType: "MAIN_LINE", combinations: [[2, 2]], betAmount: 100 }],
      {
        raceId: "test",
        classLevel: "OTHER",
        finishOrder: [2, 7, 13],
        winOddsByNumber: new Map(),
        officialPayouts: {
          WIN: [],
          SHOW: [],
          REN: [],
          WREN: [],
          TRI: [],
        },
        fallbackExoticOdds: {
          ren: { "2-7": 8.0 },
        },
      },
    );
    expect(row.byType.MAIN_LINE.hitCount).toBe(0);
    expect(row.byType.MAIN_LINE.payout).toBe(0);
  });
});
