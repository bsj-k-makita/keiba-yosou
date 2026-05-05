import { describe, expect, test } from "vitest";
import { buildInvestmentShortReview } from "./reasonGenerator";
import type { InvestmentCommentInput } from "./abilityTypes";

function input(overrides: Partial<InvestmentCommentInput> = {}): InvestmentCommentInput {
  return {
    predictedProbability: 0.45,
    actualOdds: 2.8,
    oddsSource: "actual",
    valueRank: "A",
    betType: "軸",
    valueChange: "STABLE",
    keyFactors: ["長距離実績", "内枠有利"],
    riskFactors: ["末脚のキレ負け"],
    ...overrides,
  };
}

describe("buildInvestmentShortReview", () => {
  test("returns 80-120 chars and includes mandatory phrases", () => {
    const out = buildInvestmentShortReview(input());
    expect(out.length).toBeGreaterThanOrEqual(80);
    expect(out.length).toBeLessThanOrEqual(120);
    expect(out).toContain("AIの期待水準");
    expect(out).toContain("取りこぼし余地は残り");
    expect(out).toContain("軸として検討できる水準で");
    expect(out).toContain("現在の評価水準を維持しています");
  });

  test("renders downside pattern for skip recommendation", () => {
    const out = buildInvestmentShortReview(
      input({
        predictedProbability: 0.2,
        actualOdds: 3.5,
        valueRank: "D",
        betType: "見送り",
        valueChange: "DOWN",
        keyFactors: ["前年覇者"],
        riskFactors: ["外枠による致命的な距離ロス"],
      }),
    );
    expect(out.length).toBeGreaterThanOrEqual(80);
    expect(out.length).toBeLessThanOrEqual(120);
    expect(out).toContain("人気との乖離");
    expect(out).toContain("積極的に手を出す根拠は薄く");
    expect(out).toContain("妙味は低下");
  });

  test("estimated odds are labeled as estimates", () => {
    const out = buildInvestmentShortReview(
      input({
        oddsSource: "estimated",
      }),
    );
    expect(out).toContain("推定オッズ");
    expect(out).not.toContain("実オッズ");
  });
});
import { buildStructuredShortReview } from "./reasonGenerator";

describe("buildStructuredShortReview", () => {
  test("本命候補: 3段構成と文字数レンジを満たす", () => {
    const text = buildStructuredShortReview({
      expected_popularity: "2番人気",
      system_rank: "1位",
      buy_label: "本命候補",
      top_bonuses: "ルメール騎手の東京コース勝率30.5%",
      lap_fit: "一貫型",
      core_ability: "総合A",
    });
    expect(text).toContain("想定2番人気");
    expect(text).toContain("最大要因");
    expect(text).toContain("本命候補");
    expect(text.length).toBeGreaterThanOrEqual(80);
    expect(text.length).toBeLessThanOrEqual(120);
  });

  test("大穴候補: 積極トーンを維持する", () => {
    const text = buildStructuredShortReview({
      expected_popularity: "9番人気",
      system_rank: "3位",
      buy_label: "大穴候補",
      top_bonuses: ["血統起伏適性S", "前走の不利恩恵"],
      lap_fit: "消耗戦型",
      core_ability: "末脚S・持続力A",
    });
    expect(text).toContain("想定9番人気");
    expect(text).toContain("高配当");
    expect(text).toContain("大穴候補");
    expect(text.length).toBeGreaterThanOrEqual(80);
    expect(text.length).toBeLessThanOrEqual(120);
  });

  test("危険な人気馬: 警鐘トーンを維持する", () => {
    const text = buildStructuredShortReview({
      expected_popularity: "1番人気",
      system_rank: "8位",
      buy_label: "危険な人気馬",
      top_bonuses: "大外枠×先行脚質の距離ロス",
      lap_fit: "判定不能",
      core_ability: "スピードC",
    });
    expect(text).toContain("想定1番人気");
    expect(text).toContain("危険な人気馬");
    expect(text).toMatch(/慎重|注意|過信/);
    expect(text.length).toBeGreaterThanOrEqual(80);
    expect(text.length).toBeLessThanOrEqual(120);
  });
});
