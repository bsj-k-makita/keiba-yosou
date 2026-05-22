import { describe, expect, test } from "vitest";
import type { HorseScoreResult } from "../race-evaluation/abilityTypes";
import {
  AI_TRI_CONFIDENCE_EV_THRESHOLD,
  MAX_INVESTMENT_PER_RACE,
  buildRaceEvaluationContext,
  buildOddsMapForEvEvaluation,
  buildSecondRowNumbers,
  classifyRunningStyleForDiversification,
  evTicketsToBetTickets,
  generateFormationBetTickets,
  EV_MAX_TICKETS_PER_TYPE,
  EV_MAX_TRI_TICKETS_PER_TYPE,
  EV_MAX_WIDE_TICKETS_PER_TYPE,
  generateTicketsFromEvaluation,
  PAIR_EV_THRESHOLD,
  TRI_EV_THRESHOLD,
  WIDE_EV_THRESHOLD,
  shouldSkipAiFormationBets,
  HYBRID_SECOND_ROW_MIN_WIN_ODDS,
  LOW_FAVORITE_TRIFECTA_SKIP_ODDS,
  resolveBettingAdvisoryReason,
  resolveMaxInvestmentPerRace,
  WIDE_PARTNER_MIN_WIN_ODDS,
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
    topMarkGate: 1,
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
    expect(renTicket?.expectedValue).toBeGreaterThanOrEqual(PAIR_EV_THRESHOLD);
    expect(renTicket?.gates).toContain(1);
  });

  test("◎軸以外の馬連・ワイドは生成しない", () => {
    const oddsMap: OddsMap = {
      win: { 2: 3.0, 3: 4.0 },
      ren: { "2-3": 50.0 },
      wide: { "2-3": 40.0 },
    };
    const tickets = generateTicketsFromEvaluation(
      { ...mockContext, topMarkGate: 1 },
      oddsMap,
      1.3,
    );
    expect(tickets.some((t) => t.type === "REN" && t.gates[0] === 2 && t.gates[1] === 3)).toBe(
      false,
    );
    expect(tickets.some((t) => t.type === "WREN" && t.gates[0] === 2 && t.gates[1] === 3)).toBe(
      false,
    );
  });

  test("◎未設定時は複合馬券を生成しない", () => {
    const tickets = generateTicketsFromEvaluation(
      { ...mockContext, topMarkGate: undefined },
      {
        win: { 1: 2.0, 2: 3.0, 3: 4.0 },
        ren: { "1-2": 20.0, "2-3": 30.0 },
        wide: { "1-2": 15.0 },
        trifecta: { "1-2-3": 100.0 },
      },
      0.5,
    );
    expect(tickets.every((t) => t.type === "WIN")).toBe(true);
  });

  test(`券種ごと最大${EV_MAX_TICKETS_PER_TYPE}点まで（EV降順で足切り）`, () => {
    const manyHorses: RaceEvaluationContext = {
      isSkippableRace: false,
      classTier: "CONDITIONAL_LOWER",
      topMarkGate: 1,
      evaluatedHorses: Array.from({ length: 12 }, (_, i) => ({
        gate: i + 1,
        finalRank: i + 1,
        finalEvaluationScore: 12 - i,
      })),
      winProbabilities: Array.from({ length: 12 }, (_, i) => Math.max(0.02, 0.35 - i * 0.02)),
    };
    const ren: Record<string, number> = {};
    for (let a = 2; a <= 12; a++) {
      ren[`1-${a}`] = 80;
    }
    const tickets = generateTicketsFromEvaluation(manyHorses, { win: { 1: 2.0 }, ren }, 1.3);
    const renTickets = tickets.filter((t) => t.type === "REN");
    expect(renTickets.length).toBeLessThanOrEqual(EV_MAX_TICKETS_PER_TYPE);
    if (renTickets.length >= 2) {
      expect(renTickets[0]!.expectedValue).toBeGreaterThanOrEqual(renTickets[1]!.expectedValue);
    }
  });

  test(`ワイドは最大${EV_MAX_WIDE_TICKETS_PER_TYPE}点まで（EV降順で足切り）`, () => {
    const manyHorses: RaceEvaluationContext = {
      isSkippableRace: false,
      classTier: "CONDITIONAL_LOWER",
      topMarkGate: 1,
      evaluatedHorses: Array.from({ length: 12 }, (_, i) => ({
        gate: i + 1,
        finalRank: i + 1,
        finalEvaluationScore: 12 - i,
      })),
      winProbabilities: Array.from({ length: 12 }, (_, i) => Math.max(0.02, 0.35 - i * 0.02)),
    };
    const wide: Record<string, number> = {};
    const win: Record<number, number> = { 1: 2.0 };
    for (let a = 2; a <= 12; a++) {
      wide[`1-${a}`] = 40.0;
      win[a] = 12.0;
    }
    const tickets = generateTicketsFromEvaluation(manyHorses, { win, wide }, 1.3);
    const wideTickets = tickets.filter((t) => t.type === "WREN");
    expect(wideTickets.length).toBeLessThanOrEqual(EV_MAX_WIDE_TICKETS_PER_TYPE);
    if (wideTickets.length >= 2) {
      expect(wideTickets[0]!.expectedValue).toBeGreaterThanOrEqual(wideTickets[1]!.expectedValue);
    }
  });

  test("【罠③検証】勝率 < 1% のノイズカット：勝率0.5%の馬は、実オッズがあってもすべての券種から除外されること", () => {
    const noiseContext: RaceEvaluationContext = {
      isSkippableRace: false,
      classTier: "CONDITIONAL_LOWER",
      topMarkGate: 1,
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

  test(`3連複は最大${EV_MAX_TRI_TICKETS_PER_TYPE}点まで`, () => {
    const manyHorses: RaceEvaluationContext = {
      isSkippableRace: false,
      classTier: "CONDITIONAL_LOWER",
      topMarkGate: 1,
      evaluatedHorses: Array.from({ length: 8 }, (_, i) => ({
        gate: i + 1,
        finalRank: i + 1,
        finalEvaluationScore: 8 - i,
      })),
      winProbabilities: Array.from({ length: 8 }, () => 0.12),
    };
    const trifecta: Record<string, number> = {};
    for (let b = 2; b <= 8; b++) {
      for (let c = b + 1; c <= 8; c++) {
        trifecta[`1-${b}-${c}`] = 200;
      }
    }
    const tickets = generateTicketsFromEvaluation(
      manyHorses,
      { win: { 1: 2.0 }, trifecta },
      0.5,
    );
    const tri = tickets.filter((t) => t.type === "TRI");
    expect(tri.length).toBeLessThanOrEqual(EV_MAX_TRI_TICKETS_PER_TYPE);
  });

  test(`3連複は EV >= ${TRI_EV_THRESHOLD} のみ`, () => {
    const tickets = generateTicketsFromEvaluation(mockContext, {
      win: { 1: 2.0, 2: 3.0, 3: 4.0 },
      trifecta: { "1-2-3": 10.0 },
    }, 0.5);
    const tri = tickets.find((t) => t.type === "TRI");
    if (tri != null) {
      expect(tri.expectedValue).toBeGreaterThanOrEqual(TRI_EV_THRESHOLD);
      expect(tri.gates).toContain(1);
    }
  });

  test("新馬・未勝利でも3連複を許可する", () => {
    const tickets = generateTicketsFromEvaluation(
      { ...mockContext, classTier: "MAIDEN_NEW" },
      {
        win: { 1: 2.0, 2: 3.0, 3: 4.0 },
        trifecta: { "1-2-3": 100.0 },
      },
      0.5,
    );
    expect(tickets.some((t) => t.type === "TRI")).toBe(true);
  });

  test(`ワイドは EV >= ${WIDE_EV_THRESHOLD}（馬連より緩い）で生成`, () => {
    const tickets = generateTicketsFromEvaluation(mockContext, {
      win: { 1: 2.0, 2: 12.0, 3: 4.0 },
      wide: { "1-2": 2.5 },
      ren: { "1-2": 50.0 },
    }, 0.5);
    const wide = tickets.find((t) => t.type === "WREN");
    expect(wide).toBeDefined();
    expect(wide!.expectedValue).toBeGreaterThanOrEqual(WIDE_EV_THRESHOLD);
    expect(wide!.gates).toContain(1);
  });

  test("ワイド実オッズあり：WREN が生成され払戻計算に渡せること", () => {
    const tickets = generateTicketsFromEvaluation(mockContext, {
      win: { 1: 2.0, 2: 14.0, 3: 4.0 },
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

  test("evTicketsToBetTickets はクォーターケリーで金額傾斜配分する", () => {
    const betTickets = evTicketsToBetTickets([
      {
        type: "WIN",
        gates: [1],
        estimatedProbability: 0.4,
        expectedValue: 1.6,
        decimalOdds: 4.0,
      },
      {
        type: "WIN",
        gates: [2],
        estimatedProbability: 0.1,
        expectedValue: 0.2,
        decimalOdds: 2.0,
      },
    ]);
    const amountByGate = new Map<number, number>();
    for (const t of betTickets) {
      if (t.ticketType !== "WIN") continue;
      for (const c of t.combinations) amountByGate.set(c[0]!, t.betAmount);
    }
    expect(amountByGate.get(1)).toBe(500);
    expect(amountByGate.get(2)).toBe(100);
  });

  test("3連複は券種別ケリー係数0.15を適用する", () => {
    const betTickets = evTicketsToBetTickets([
      {
        type: "TRI",
        gates: [1, 2, 3],
        estimatedProbability: 0.4,
        expectedValue: 1.6,
        decimalOdds: 4.0,
      },
    ]);
    const tri = betTickets.find((t) => t.ticketType === "TRIFECTA_FORM");
    expect(tri).toBeDefined();
    expect(tri?.betAmount).toBe(300);
  });

  test("1レース総投資は MAX_INVESTMENT_PER_RACE を超えない", () => {
    const evTickets = Array.from({ length: 10 }, (_, i) => ({
      type: "WIN" as const,
      gates: [i + 1],
      estimatedProbability: 0.6,
      expectedValue: 3.0,
      decimalOdds: 5.0,
    }));
    const betTickets = evTicketsToBetTickets(evTickets);
    const totalInvested = betTickets.reduce(
      (sum, t) => sum + t.betAmount * t.combinations.length,
      0,
    );
    expect(totalInvested).toBeLessThanOrEqual(MAX_INVESTMENT_PER_RACE);
  });

  test("環境変数で1レース総投資キャップを5,000円へ一時変更できる", () => {
    const prev = process.env.BETTING_MAX_INVESTMENT_PER_RACE;
    process.env.BETTING_MAX_INVESTMENT_PER_RACE = "5000";
    try {
      const evTickets = Array.from({ length: 10 }, (_, i) => ({
        type: "WIN" as const,
        gates: [i + 1],
        estimatedProbability: 0.6,
        expectedValue: 3.0,
        decimalOdds: 5.0,
      }));
      const betTickets = evTicketsToBetTickets(evTickets);
      const totalInvested = betTickets.reduce(
        (sum, t) => sum + t.betAmount * t.combinations.length,
        0,
      );
      expect(totalInvested).toBeLessThanOrEqual(5000);
    } finally {
      if (prev == null) delete process.env.BETTING_MAX_INVESTMENT_PER_RACE;
      else process.env.BETTING_MAX_INVESTMENT_PER_RACE = prev;
    }
  });

  test("投資キャップ環境変数が不正値ならデフォルト8,000円へフォールバックする", () => {
    expect(resolveMaxInvestmentPerRace("abc")).toBe(MAX_INVESTMENT_PER_RACE);
    expect(resolveMaxInvestmentPerRace("50")).toBe(MAX_INVESTMENT_PER_RACE);
  });

  test(`ワイドは相手馬の単勝${WIDE_PARTNER_MIN_WIN_ODDS}倍未満を足切りする`, () => {
    const tickets = generateTicketsFromEvaluation(
      mockContext,
      {
        win: { 1: 2.0, 2: 6.0, 3: 4.0 },
        wide: { "1-2": 15.0 },
      },
      0.5,
    );
    expect(tickets.some((t) => t.type === "WREN")).toBe(true);
  });

  test("AIモード: EV順位ベースのフォーメーションを生成する", () => {
    const tickets = generateTicketsFromEvaluation(
      mockContext,
      buildOddsMapForEvEvaluation([] as never, {
        win: { 1: 8.0, 2: 12.0, 3: 15.0 },
      }),
      1.3,
      {
        probabilityEngine: "ai",
        effectiveEvByGate: new Map([
          [1, 1.0],
          [2, 1.1],
          [3, 0.5],
        ]),
      },
    );
    expect(tickets.some((t) => t.type === "WIN")).toBe(true);
    expect(tickets.length).toBeGreaterThan(0);
    expect(shouldSkipAiFormationBets("ai", tickets.length)).toBe(false);
  });

  test("AIモード3連複はEV閾値以上の自信券のみを採用する", () => {
    const context: RaceEvaluationContext = {
      isSkippableRace: false,
      classTier: "OPEN_GRADED",
      topMarkGate: 1,
      evaluatedHorses: Array.from({ length: 10 }, (_, i) => ({
        gate: i + 1,
        finalRank: i + 1,
        finalEvaluationScore: 10 - i,
      })),
      winProbabilities: Array.from({ length: 10 }, () => 0.1),
    };
    const tickets = generateTicketsFromEvaluation(
      context,
      {
        win: {
          1: 3.0,
          2: 6.0,
          3: 8.0,
          4: 12.0,
          5: 16.0,
          6: 24.0,
          7: 40.0,
          8: 55.0,
          9: 120.0,
          10: 200.0,
        },
      },
      1.3,
      {
        probabilityEngine: "ai",
        effectiveEvByGate: new Map(
          Array.from({ length: 10 }, (_, i) => [i + 1, 2.0 - i * 0.1] as const),
        ),
      },
    );
    const triTickets = tickets.filter((t) => t.type === "TRI");
    expect(triTickets.length).toBeGreaterThan(0);
    expect(triTickets.every((t) => t.gates.includes(1))).toBe(true);
    expect(
      triTickets.every((t) => t.expectedValue >= AI_TRI_CONFIDENCE_EV_THRESHOLD) ||
        triTickets.length === 1,
    ).toBe(true);
  });

  test("AIモード2列目（3頭）は脚質が片寄る場合に別グループを1頭補給する", () => {
    const context: RaceEvaluationContext = {
      isSkippableRace: false,
      classTier: "OPEN_GRADED",
      topMarkGate: 1,
      evaluatedHorses: Array.from({ length: 7 }, (_, i) => ({
        gate: i + 1,
        finalRank: i + 1,
        finalEvaluationScore: 70 - i,
      })),
      winProbabilities: Array.from({ length: 7 }, () => 0.1),
    };
    const tickets = generateTicketsFromEvaluation(
      context,
      { win: { 1: 2.0, 2: 7.0, 3: 9.0, 4: 11.0, 5: 14.0, 6: 18.0, 7: 22.0 } },
      1.3,
      {
        probabilityEngine: "ai",
        effectiveEvByGate: new Map([
          [1, 2.0],
          [2, 1.8],
          [3, 1.7],
          [4, 1.6],
          [5, 1.5],
          [6, 1.4],
          [7, 1.3],
        ]),
        // 2〜4が後ろ脚質で上位3頭を占有。5を前グループとして補給させる。
        runningStyleGroupByGate: new Map([
          [1, "front"],
          [2, "back"],
          [3, "back"],
          [4, "back"],
          [5, "front"],
          [6, "back"],
          [7, "back"],
        ]),
      },
    );
    const renPartners = tickets
      .filter((t) => t.type === "REN")
      .map((t) => t.gates.find((g) => g !== 1))
      .filter((g): g is number => g != null)
      .sort((a, b) => a - b);
    expect(renPartners).toEqual([2, 3, 5]);
  });

  test("AIモードワイド相手（6頭）にも脚質分散を適用する", () => {
    const context: RaceEvaluationContext = {
      isSkippableRace: false,
      classTier: "OPEN_GRADED",
      topMarkGate: 1,
      evaluatedHorses: Array.from({ length: 9 }, (_, i) => ({
        gate: i + 1,
        finalRank: i + 1,
        finalEvaluationScore: 80 - i,
      })),
      winProbabilities: Array.from({ length: 9 }, () => 0.1),
    };
    const tickets = generateTicketsFromEvaluation(
      context,
      {
        win: {
          1: 2.0,
          2: 6.0,
          3: 7.0,
          4: 8.0,
          5: 9.0,
          6: 10.0,
          7: 11.0,
          8: 12.0,
          9: 13.0,
        },
      },
      1.3,
      {
        probabilityEngine: "ai",
        effectiveEvByGate: new Map([
          [1, 2.0],
          [2, 1.9],
          [3, 1.8],
          [4, 1.7],
          [5, 1.6],
          [6, 1.5],
          [7, 1.4],
          [8, 1.3],
          [9, 1.2],
        ]),
        // 2〜7を後ろ、8を前にして top6(2..7) を 8 へ置換させる。
        runningStyleGroupByGate: new Map([
          [1, "front"],
          [2, "back"],
          [3, "back"],
          [4, "back"],
          [5, "back"],
          [6, "back"],
          [7, "back"],
          [8, "front"],
          [9, "back"],
        ]),
      },
    );
    const widePartners = tickets
      .filter((t) => t.type === "WREN")
      .map((t) => t.gates.find((g) => g !== 1))
      .filter((g): g is number => g != null)
      .sort((a, b) => a - b);
    expect(widePartners).toHaveLength(6);
    expect(widePartners).toContain(8);
    expect(widePartners).not.toContain(7);
  });

  test("AIモードの相手候補は印付き馬（○▲☆△）を優先し、印なし馬を含めない", () => {
    const context: RaceEvaluationContext = {
      isSkippableRace: false,
      classTier: "OPEN_GRADED",
      topMarkGate: 1,
      evaluatedHorses: [
        { gate: 1, finalRank: 1, finalEvaluationScore: 90 },
        { gate: 2, finalRank: 2, finalEvaluationScore: 88 },
        { gate: 3, finalRank: 3, finalEvaluationScore: 86 },
        { gate: 4, finalRank: 4, finalEvaluationScore: 84 },
        { gate: 5, finalRank: 5, finalEvaluationScore: 82 },
      ],
      markedHorses: [
        { gate: 1, mark: "◎", finalRank: 1 },
        { gate: 2, mark: "○", finalRank: 2 },
        { gate: 3, mark: "▲", finalRank: 3 },
        { gate: 4, mark: "△", finalRank: 4 },
      ],
      winProbabilities: [0.3, 0.2, 0.18, 0.12, 0.2],
    };
    const tickets = generateTicketsFromEvaluation(
      context,
      { win: { 1: 2.0, 2: 10.0, 3: 12.0, 4: 14.0, 5: 25.0 } },
      1.3,
      {
        probabilityEngine: "ai",
        // 5番(印なし)を最高EVにしても、相手候補には含めない想定
        effectiveEvByGate: new Map([
          [1, 1.2],
          [2, 1.0],
          [3, 0.9],
          [4, 0.8],
          [5, 2.5],
        ]),
      },
    );
    const allPartnerGates = new Set<number>();
    for (const t of tickets) {
      if (t.type === "WIN") continue;
      for (const c of t.gates) {
        if (c !== 1) allPartnerGates.add(c);
      }
    }
    expect(allPartnerGates.has(5)).toBe(false);
    expect(allPartnerGates.has(2)).toBe(true);
  });

  test("脚質グループ分類: パターンA/B/Cで好位・自在の扱いが変わる", () => {
    expect(classifyRunningStyleForDiversification("好位", "A")).toBe("front");
    expect(classifyRunningStyleForDiversification("好位", "B")).toBe("back");
    expect(classifyRunningStyleForDiversification("好位", "C")).toBe("mid");
    expect(classifyRunningStyleForDiversification("自在", "C")).toBe("mid");
  });

  test("パターンCは単一グループ独占時のみ末尾置換する", () => {
    const prev = process.env.BETTING_STYLE_DIVERSIFY_PATTERN;
    process.env.BETTING_STYLE_DIVERSIFY_PATTERN = "C";
    try {
      const context: RaceEvaluationContext = {
        isSkippableRace: false,
        classTier: "OPEN_GRADED",
        topMarkGate: 1,
        evaluatedHorses: Array.from({ length: 7 }, (_, i) => ({
          gate: i + 1,
          finalRank: i + 1,
          finalEvaluationScore: 70 - i,
        })),
        winProbabilities: Array.from({ length: 7 }, () => 0.1),
      };
      const tickets = generateTicketsFromEvaluation(
        context,
        { win: { 1: 2.0, 2: 7.0, 3: 9.0, 4: 11.0, 5: 14.0, 6: 18.0, 7: 22.0 } },
        1.3,
        {
          probabilityEngine: "ai",
          effectiveEvByGate: new Map([
            [1, 2.0],
            [2, 1.8],
            [3, 1.7],
            [4, 1.6],
            [5, 1.5],
            [6, 1.4],
            [7, 1.3],
          ]),
          runningStyleGroupByGate: new Map([
            [1, "front"],
            [2, "mid"],
            [3, "mid"],
            [4, "mid"],
            [5, "back"],
            [6, "back"],
            [7, "mid"],
          ]),
        },
      );
      const renPartners = tickets
        .filter((t) => t.type === "REN")
        .map((t) => t.gates.find((g) => g !== 1))
        .filter((g): g is number => g != null)
        .sort((a, b) => a - b);
      expect(renPartners).toEqual([2, 3, 5]);
    } finally {
      if (prev == null) delete process.env.BETTING_STYLE_DIVERSIFY_PATTERN;
      else process.env.BETTING_STYLE_DIVERSIFY_PATTERN = prev;
    }
  });

  test("AI モード単勝は常に◎を1点生成する", () => {
    const tickets = generateTicketsFromEvaluation(
      mockContext,
      { win: { 1: 2.0, 2: 50.0, 3: 10.0 } },
      1.3,
      {
        probabilityEngine: "ai",
        effectiveEvByGate: new Map([
          [1, 0.5],
          [2, 1.35],
          [3, 1.2],
        ]),
      },
    );
    const wins = tickets.filter((t) => t.type === "WIN");
    expect(wins).toHaveLength(1);
    expect(wins[0]?.gates).toEqual([1]);
    expect(wins[0]?.estimatedProbability).toBeGreaterThan(0);
    expect(wins[0]?.decimalOdds).toBe(2.0);
  });

  test("軸馬の予測勝率が8%未満なら topMarkGate を無効化する", () => {
    const topRow = {
      horseId: "h1",
      horseName: "h1",
      mark: "◎",
      finalRank: 1,
      finalEvaluationScore: 90,
      baseScore: 90,
      adjustedScore: 90,
      scoreDiff: 0,
      buyLabel: "見送り",
    } as unknown as HorseScoreResult;
    const context = buildRaceEvaluationContext({
      results: [topRow],
      winProbabilities: new Map([
        ["h1", 0.05],
      ]),
      horseNumberById: new Map([
        ["h1", 1],
      ]),
      oddsMap: { win: { 1: 2.0 } },
    });
    expect(context.topMarkGate).toBeUndefined();
  });

  test("動的EVしきい値で低勝率の単勝誤爆を抑制する", () => {
    const lowProbContext: RaceEvaluationContext = {
      isSkippableRace: false,
      classTier: "CONDITIONAL_LOWER",
      topMarkGate: undefined,
      evaluatedHorses: [{ gate: 9, finalRank: 1, finalEvaluationScore: 80 }],
      winProbabilities: [0.02],
    };
    const tickets = generateTicketsFromEvaluation(
      lowProbContext,
      { win: { 9: 100.0 } },
      1.3,
    );
    expect(tickets.some((t) => t.type === "WIN")).toBe(false);
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

  test("AIモードでは contradictory_marks 見送り理由を出さない", () => {
    expect(
      resolveBettingAdvisoryReason({
        isSkippableRace: true,
        hasMarks: true,
        evBetPointCount: 0,
        probabilityEngine: "ai",
      }),
    ).toBe("no_ev_recommendation");
    expect(
      resolveBettingAdvisoryReason({
        isSkippableRace: true,
        hasMarks: true,
        evBetPointCount: 1,
        probabilityEngine: "ai",
      }),
    ).toBeUndefined();
  });

  test(`AIモード2列目: 単勝${HYBRID_SECOND_ROW_MIN_WIN_ODDS}倍以上の大穴のみハイブリッド補給`, () => {
    const marks = [
      { horseNumber: 1, mark: "◎" },
      { horseNumber: 2, mark: "○" },
      { horseNumber: 3, mark: "▲" },
      { horseNumber: 7, mark: "☆", longshotReversalTrigger: true, winOdds: 18.0 },
      { horseNumber: 9, mark: "△", connectionsBonus: 3.0, winOdds: 12.5 },
    ];
    const secondRow = buildSecondRowNumbers(marks, "CONDITIONAL_LOWER", "ai");
    expect(secondRow).toContain(2);
    expect(secondRow).toContain(3);
    expect(secondRow).toContain(7);
    expect(secondRow).toContain(9);
  });

  test(`AIモード2列目: 単勝${HYBRID_SECOND_ROW_MIN_WIN_ODDS}倍未満のシグナル馬は補給しない`, () => {
    const marks = [
      { horseNumber: 1, mark: "◎" },
      { horseNumber: 2, mark: "○" },
      { horseNumber: 3, mark: "▲" },
      { horseNumber: 5, mark: "☆", longshotReversalTrigger: true, winOdds: 6.5 },
      { horseNumber: 8, mark: "△", connectionsBonus: 3.0, winOdds: 4.2 },
    ];
    const secondRow = buildSecondRowNumbers(marks, "CONDITIONAL_LOWER", "ai");
    expect(secondRow).toEqual([2, 3]);
  });

  test(`◎単勝${LOW_FAVORITE_TRIFECTA_SKIP_ODDS}倍以下は3連複フォーメを生成しない`, () => {
    const marks = [
      { horseNumber: 4, mark: "◎" },
      { horseNumber: 2, mark: "○" },
      { horseNumber: 8, mark: "▲" },
    ];
    const withTri = generateFormationBetTickets(marks, "CONDITIONAL_LOWER", 100, {
      favoriteWinOdds: 2.0,
    });
    const noTri = generateFormationBetTickets(marks, "CONDITIONAL_LOWER", 100, {
      favoriteWinOdds: 1.5,
    });
    expect(withTri.some((t) => t.ticketType === "TRIFECTA_FORM")).toBe(true);
    expect(noTri.some((t) => t.ticketType === "TRIFECTA_FORM")).toBe(false);
    expect(noTri.some((t) => t.ticketType === "WIN")).toBe(true);
    expect(noTri.some((t) => t.ticketType === "WIDE")).toBe(true);
  });
});
