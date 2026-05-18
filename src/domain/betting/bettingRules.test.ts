import { describe, expect, test } from "vitest";
import {
  evTicketsToBetTickets,
  generateTicketsFromEvaluation,
  type OddsMap,
  type RaceEvaluationContext,
  VALID_PROB_THRESHOLD,
} from "./bettingRules";
import { calculateRacePayout } from "./payoutCalculator";

describe("bettingRules - generateTicketsFromEvaluation", () => {
  const mockContext: RaceEvaluationContext = {
    isSkippableRace: false,
    classTier: "CONDITIONAL_LOWER",
    evaluatedHorses: [
      { gate: 1, finalRank: 1, finalEvaluationScore: 3.5 },
      { gate: 2, finalRank: 2, finalEvaluationScore: 2.0 },
      { gate: 3, finalRank: 3, finalEvaluationScore: 1.0 },
    ],
    winProbabilities: [0.6, 0.3, 0.1],
  };

  test("【罠①検証】実オッズなし：単勝のみオッズがある場合、ワイド・馬連・3連複は一切生成されないこと", () => {
    const oddsMap: OddsMap = {
      win: { 1: 2.5, 2: 4.0, 3: 10.0 },
    };

    const tickets = generateTicketsFromEvaluation(mockContext, oddsMap, 1.3);

    expect(tickets.every((t) => t.type === "WIN")).toBe(true);
    expect(tickets.find((t) => t.gates.includes(1))).toBeDefined();
    expect(tickets.some((t) => t.type === "REN" || t.type === "WREN" || t.type === "TRI")).toBe(
      false,
    );
  });

  test("【罠②検証】馬連実オッズあり：EV条件を満たせば REN が正しく生成されること", () => {
    const oddsMap: OddsMap = {
      win: { 1: 2.0 },
      ren: {
        "1-2": 5.0,
      },
    };

    const tickets = generateTicketsFromEvaluation(mockContext, oddsMap, 1.3);
    const renTicket = tickets.find((t) => t.type === "REN");

    expect(renTicket).toBeDefined();
    expect(renTicket?.gates).toEqual([1, 2]);
    expect(renTicket?.expectedValue).toBeGreaterThanOrEqual(1.3);
  });

  test("【罠③検証】勝率 < 1% のノイズカット：勝率0.5%の馬は、実オッズがあってもすべての券種から除外されること", () => {
    const noiseContext: RaceEvaluationContext = {
      isSkippableRace: false,
      classTier: "CONDITIONAL_LOWER",
      evaluatedHorses: [
        { gate: 1, finalRank: 1, finalEvaluationScore: 4.0 },
        { gate: 2, finalRank: 2, finalEvaluationScore: 2.0 },
        { gate: 3, finalRank: 3, finalEvaluationScore: -5.0 },
      ],
      winProbabilities: [0.695, 0.3, 0.005],
    };

    const oddsMap: OddsMap = {
      win: { 1: 2.0, 2: 3.5, 3: 500.0 },
      ren: { "1-3": 1000.0 },
    };

    const tickets = generateTicketsFromEvaluation(noiseContext, oddsMap, 1.3);

    tickets.forEach((ticket) => {
      expect(ticket.gates).not.toContain(3);
    });
    expect(noiseContext.winProbabilities[2]).toBeLessThan(VALID_PROB_THRESHOLD);
  });

  test("自己矛盾レースは全見送り", () => {
    const tickets = generateTicketsFromEvaluation(
      { ...mockContext, isSkippableRace: true },
      { win: { 1: 3.0 } },
      1.3,
    );
    expect(tickets).toEqual([]);
  });

  test("新馬・未勝利は3連複をスキップ", () => {
    const tickets = generateTicketsFromEvaluation(
      { ...mockContext, classTier: "MAIDEN_NEW" },
      {
        win: { 1: 2.0, 2: 3.0, 3: 4.0 },
        trifecta: { "1-2-3": 100.0 },
      },
      0.5,
    );
    expect(tickets.some((t) => t.type === "TRI")).toBe(false);
  });

  test("ワイド実オッズあり：WREN が生成され払戻計算に渡せること", () => {
    const tickets = generateTicketsFromEvaluation(mockContext, {
      win: { 1: 2.0, 2: 3.0, 3: 4.0 },
      wide: { "1-2": 2.5 },
    }, 0.5);
    const wide = tickets.find((t) => t.type === "WREN");
    expect(wide).toBeDefined();

    const betTickets = evTicketsToBetTickets(tickets);
    const wideBet = betTickets.find((t) => t.ticketType === "WIDE");
    expect(wideBet).toBeDefined();

    const result = calculateRacePayout(wideBet ? [wideBet] : [], {
      raceId: "test",
      classLevel: "OTHER",
      finishOrder: [1, 2, 3],
      winOddsByNumber: new Map(),
      officialPayouts: {
        WIN: [],
        SHOW: [],
        REN: [],
        WREN: [{ numbers: [1, 2], dividend: 250 }],
        TRI: [],
      },
    });
    expect(result.byType.WIDE.hitCount).toBe(1);
  });

  test("AI モード単勝は ai_effective_ev >= 1.05 で判定（prob×odds ではない）", () => {
    const tickets = generateTicketsFromEvaluation(
      mockContext,
      { win: { 1: 2.0, 2: 50.0, 3: 10.0 } },
      1.3,
      {
        probabilityEngine: "ai",
        effectiveEvByGate: new Map([
          [1, 0.5],
          [2, 1.2],
          [3, 0.01],
        ]),
      },
    );
    const wins = tickets.filter((t) => t.type === "WIN");
    expect(wins).toHaveLength(1);
    expect(wins[0]?.gates).toEqual([2]);
    expect(wins[0]?.expectedValue).toBe(1.2);
  });

  test("evaluatedHorses と winProbabilities の長さ不一致はエラー", () => {
    expect(() =>
      generateTicketsFromEvaluation(
        { ...mockContext, winProbabilities: [0.5] },
        { win: { 1: 2.0 } },
        1.3,
      ),
    ).toThrow(/must match/);
  });
});
