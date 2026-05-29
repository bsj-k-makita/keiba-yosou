import { describe, expect, test } from "vitest";
import type { HorseScoreResult } from "../race-evaluation/abilityTypes";
import {
  MAX_INVESTMENT_PER_RACE,
  buildRaceEvaluationContext,
  buildOddsMapForEvEvaluation,
  buildAiTrifectaThirdColumnGates,
  buildSecondRowNumbers,
  classifyRunningStyleForDiversification,
  estimatePairProbability,
  estimateTrifectaProbability,
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
  type OddsMap,
  type RaceEvaluationContext,
  VALID_PROB_THRESHOLD,
} from "./bettingRules";
import { calculateRacePayout } from "./payoutCalculator";

describe("bettingRules - Harville probability", () => {
  test("馬連確率は Harville 公式 P(A)×P(B)/(1-P(A)) + P(B)×P(A)/(1-P(B))", () => {
    const pA = 0.4;
    const pB = 0.25;
    const expected = (pA * pB) / (1 - pA) + (pB * pA) / (1 - pB);
    expect(estimatePairProbability(pA, pB)).toBeCloseTo(expected, 10);
  });

  test("3連複確率は全6通りの順列確率の合算", () => {
    const probs = [0.4, 0.25, 0.15];
    const permutations: [number, number, number][] = [
      [0, 1, 2],
      [0, 2, 1],
      [1, 0, 2],
      [1, 2, 0],
      [2, 0, 1],
      [2, 1, 0],
    ];
    let expected = 0;
    for (const [i, j, k] of permutations) {
      const pf = probs[i]!;
      const ps = probs[j]!;
      const pt = probs[k]!;
      expected += pf * (ps / (1 - pf)) * (pt / (1 - pf - ps));
    }
    expect(estimateTrifectaProbability(probs[0]!, probs[1]!, probs[2]!)).toBeCloseTo(
      expected,
      10,
    );
  });
});

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

  test("単勝は◎（topMarkGate）のみ生成し、他馬の単勝EV合格券は出さない", () => {
    const oddsMap: OddsMap = {
      win: { 1: 2.5, 2: 50.0, 3: 40.0 },
    };
    const tickets = generateTicketsFromEvaluation(mockContext, oddsMap, 1.3);
    const wins = tickets.filter((t) => t.type === "WIN");
    expect(wins.length).toBeLessThanOrEqual(1);
    if (wins.length === 1) {
      expect(wins[0]!.gates).toEqual([1]);
    }
    expect(tickets.some((t) => t.type === "WIN" && t.gates[0] === 2)).toBe(false);
    expect(tickets.some((t) => t.type === "WIN" && t.gates[0] === 3)).toBe(false);
  });

  test("topMarkGate 未設定時は単勝券を生成しない", () => {
    const tickets = generateTicketsFromEvaluation(
      { ...mockContext, topMarkGate: undefined },
      { win: { 1: 2.0, 2: 50.0, 3: 40.0 } },
      0.5,
    );
    expect(tickets.every((t) => t.type !== "WIN")).toBe(true);
  });

  test("単勝のみオッズでも推定オッズから複合券を生成できる", () => {
    const oddsMap: OddsMap = {
      win: { 1: 2.5, 2: 4.0, 3: 10.0 },
    };

    const tickets = generateTicketsFromEvaluation(mockContext, oddsMap, 1.3);

    expect(tickets.some((t) => t.type === "WIN")).toBe(true);
    expect(tickets.some((t) => t.type === "REN" || t.type === "WREN" || t.type === "TRI")).toBe(
      true,
    );
  });

  test("【罠②検証】馬連実オッズあり：EV条件を満たせば REN が正しく生成されること", () => {
    const oddsMap: OddsMap = {
      win: { 1: 2.0, 2: 4.0, 3: 10.0 },
      ren: {
        "1-2": 5.0,
      },
    };

    const tickets = generateTicketsFromEvaluation(mockContext, oddsMap, 1.3);
    const renTicket = tickets.find((t) => t.type === "REN" && t.gates.join("-") === "1-2");

    expect(renTicket).toBeDefined();
    expect(renTicket?.expectedValue).toBeGreaterThanOrEqual(PAIR_EV_THRESHOLD);
  });

  test("◎軸に依存せず全組み合わせから EV 合格券を生成する", () => {
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
      true,
    );
    expect(tickets.some((t) => t.type === "WREN" && t.gates[0] === 2 && t.gates[1] === 3)).toBe(
      true,
    );
  });

  test("topMarkGate 未設定でも複合馬券を生成する", () => {
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
    expect(tickets.some((t) => t.type === "REN")).toBe(true);
    expect(tickets.some((t) => t.type === "WREN")).toBe(true);
    expect(tickets.some((t) => t.type === "TRI")).toBe(true);
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
    const win: Record<number, number> = {};
    for (let i = 1; i <= 12; i++) win[i] = 2.0 + i * 0.5;
    const tickets = generateTicketsFromEvaluation(manyHorses, { win }, 1.3);
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
    const win: Record<number, number> = {};
    for (let i = 1; i <= 12; i++) win[i] = 2.0 + i * 0.5;
    const tickets = generateTicketsFromEvaluation(manyHorses, { win }, 1.3);
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
    const win: Record<number, number> = {};
    for (let i = 1; i <= 8; i++) win[i] = 3.0 + i;
    const tickets = generateTicketsFromEvaluation(manyHorses, { win }, 0.5);
    const tri = tickets.filter((t) => t.type === "TRI");
    expect(tri.length).toBeLessThanOrEqual(EV_MAX_TRI_TICKETS_PER_TYPE);
  });

  test(`3連複は EV >= ${TRI_EV_THRESHOLD} のみ`, () => {
    const tickets = generateTicketsFromEvaluation(
      mockContext,
      {
        win: { 1: 2.0, 2: 3.0, 3: 4.0 },
        trifecta: { "1-2-3": 10.0 },
      },
      0.5,
    );
    const tri = tickets.find((t) => t.type === "TRI");
    if (tri != null) {
      expect(tri.expectedValue).toBeGreaterThanOrEqual(TRI_EV_THRESHOLD);
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
    const tickets = generateTicketsFromEvaluation(
      mockContext,
      {
        win: { 1: 2.0, 2: 12.0, 3: 4.0 },
        wide: { "1-2": 2.5 },
        ren: { "1-2": 50.0 },
      },
      0.5,
    );
    const wide = tickets.find((t) => t.type === "WREN");
    expect(wide).toBeDefined();
    expect(wide!.expectedValue).toBeGreaterThanOrEqual(WIDE_EV_THRESHOLD);
  });

  test("ワイド実オッズあり：WREN が生成され払戻計算に渡せること", () => {
    const tickets = generateTicketsFromEvaluation(
      mockContext,
      {
        win: { 1: 2.0, 2: 14.0, 3: 4.0 },
        wide: { "1-2": 2.5 },
      },
      0.5,
    );
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

  test("AIモードは3連複のみ列ベース生成（TSは全組み合わせ）", () => {
    const odds = buildOddsMapForEvEvaluation([] as never, {
      win: { 1: 8.0, 2: 12.0, 3: 15.0 },
    });
    const tsTickets = generateTicketsFromEvaluation(mockContext, odds, 1.3, {
      probabilityEngine: "ts",
    });
    const aiTickets = generateTicketsFromEvaluation(mockContext, odds, 1.3, {
      probabilityEngine: "ai",
    });
    expect(tsTickets.filter((t) => t.type === "TRI").length).toBeGreaterThan(0);
    expect(aiTickets.filter((t) => t.type !== "TRI")).toEqual(
      tsTickets.filter((t) => t.type !== "TRI"),
    );
    expect(shouldSkipAiFormationBets("ai", aiTickets.length)).toBe(false);
  });

  test("AI 3列目: 150倍以上の無印は除外し100倍以上は最大2頭", () => {
    const context: RaceEvaluationContext = {
      isSkippableRace: false,
      classTier: "CONDITIONAL_LOWER",
      topMarkGate: 1,
      markedHorses: [
        { gate: 1, mark: "◎", finalRank: 1 },
        { gate: 2, mark: "○", finalRank: 2 },
      ],
      evaluatedHorses: Array.from({ length: 6 }, (_, i) => ({
        gate: i + 1,
        finalRank: i + 1,
        finalEvaluationScore: 6 - i,
      })),
      winProbabilities: [0.25, 0.2, 0.15, 0.12, 0.1, 0.08],
    };
    const validHorses = [
      { gate: 1, finalRank: 1, finalEvaluationScore: 6, prob: 0.25 },
      { gate: 2, finalRank: 2, finalEvaluationScore: 5, prob: 0.2 },
      { gate: 3, finalRank: 3, finalEvaluationScore: 4, prob: 0.15 },
      { gate: 4, finalRank: 4, finalEvaluationScore: 3, prob: 0.12 },
      { gate: 5, finalRank: 5, finalEvaluationScore: 2, prob: 0.1 },
      { gate: 6, finalRank: 6, finalEvaluationScore: 1, prob: 0.08 },
    ];
    const winOdds = {
      1: 3.0,
      2: 12.0,
      3: 120.0,
      4: 180.0,
      5: 200.0,
      6: 250.0,
    };
    const thirdCol = buildAiTrifectaThirdColumnGates(
      context,
      validHorses,
      winOdds,
      "CONDITIONAL_LOWER",
    );
    expect(thirdCol).not.toContain(4);
    expect(thirdCol).not.toContain(6);
    const ultraCount = thirdCol.filter((g) => (winOdds[g as keyof typeof winOdds] ?? 0) >= 100)
      .length;
    expect(ultraCount).toBeLessThanOrEqual(2);
  });

  test("脚質グループ分類: パターンA/B/Cで好位・自在の扱いが変わる", () => {
    expect(classifyRunningStyleForDiversification("好位", "A")).toBe("front");
    expect(classifyRunningStyleForDiversification("好位", "B")).toBe("back");
    expect(classifyRunningStyleForDiversification("好位", "C")).toBe("mid");
    expect(classifyRunningStyleForDiversification("自在", "C")).toBe("mid");
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
      winProbabilities: new Map([["h1", 0.05]]),
      horseNumberById: new Map([["h1", 1]]),
      oddsMap: { win: { 1: 2.0 } },
    });
    expect(context.topMarkGate).toBeUndefined();
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
