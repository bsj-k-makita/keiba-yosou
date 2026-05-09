import { describe, expect, it } from "vitest";
import { BUY_LABELS } from "./lingoConstants";
import type { HorseScoreResult } from "./abilityTypes";
import { assignCompleteMarks, computeTriangleTarget, ensureTriangleMarks } from "./markAssigner";

/** 印ロジック単体テスト用の最小スタブ（evaluateRace 結果の一部フィールドのみ） */
function row(id: string, overrides: Partial<HorseScoreResult> & { finalRank: number }): HorseScoreResult {
  const fr = overrides.finalRank;
  return {
    horseId: id,
    horseName: id,
    baseScore: 50,
    adjustedScore: 50,
    scoreDiff: 0,
    baseAbilityCore: 50,
    intrinsicAbilityScore: 50,
    raceAdjustedInput: 50,
    conditionFitDelta: 0,
    reproducibilityDelta: 0,
    riskPenalty: 0,
    raceRelativeScore: 50,
    paceFitBonus: 0,
    distanceFitBonus: 0,
    classLevelBonus: 0,
    pedigreeBonus: 0,
    gateBiasBonus: 0,
    gateStyleSynergyBonus: 0,
    connectionsBonus: 0,
    trendBonus: 0,
    paceBalanceBonus: 0,
    tripContextBonus: 0,
    courseTraitBonus: 0,
    courseTraitReasons: [],
    finalEvaluationScore: 100 - fr,
    evaluationBaselineScore: 0,
    evaluationAdjustmentDelta: 0,
    lastMinuteAdjustmentBonus: 0,
    lastRunResetBonus: 0,
    lapFocusBonus: 0,
    adjustmentBadges: [],
    lapShapeFitBonus: 0,
    raceAnalysisBonus: 0,
    lapSustainBonus: 0,
    lapQualityBonus: 0,
    stepPatternBonus: 0,
    varianceScore: 0,
    roleHint: "判定不能",
    buyLabel: BUY_LABELS.GROUP,
    reason: "",
    strongAbilities: [],
    pastRunInsight: "",
    lapProfile: "一貫型",
    enginePeakBonus: 0,
    staminaResilienceFlag: false,
    staminaResilienceStrength01: 0,
    todayLapKind: null,
    staminaResilienceBonus: 0,
    oddsDistortionFlag: false,
    oddsDistortionScore01: 0,
    oddsDistortionReasons: [],
    stabilityScore: 50,
    paceSeverityKind: "neutral",
    mark: "",
    ...overrides,
  } as HorseScoreResult;
}

describe("computeTriangleTarget", () => {
  it("頭数に応じて△の目標数を抑える（8頭→4、7頭→3）", () => {
    expect(computeTriangleTarget(8)).toBe(4);
    expect(computeTriangleTarget(7)).toBe(3);
    expect(computeTriangleTarget(5)).toBe(1);
  });
});

describe("assignCompleteMarks", () => {
  it("構造消し後でも ◎〜△ と △ が欠けないよう再割当できる", () => {
    const results: HorseScoreResult[] = [
      row("h1", { finalRank: 1, mark: "", buyLabel: BUY_LABELS.FAVORITE }),
      row("h2", { finalRank: 2, mark: "", buyLabel: BUY_LABELS.RIVAL }),
      row("h3", { finalRank: 3, mark: "", buyLabel: BUY_LABELS.TAN }),
      row("h4", { finalRank: 4, mark: "", buyLabel: BUY_LABELS.GROUP }),
      row("h5", { finalRank: 5, mark: "", buyLabel: BUY_LABELS.GROUP }),
      row("h6", { finalRank: 6, mark: "", buyLabel: BUY_LABELS.DISMISS }),
    ];
    assignCompleteMarks(results, new Set());
    const marks = new Set(results.map((r) => r.mark).filter(Boolean));
    expect(marks.has("◎")).toBe(true);
    expect(marks.has("○")).toBe(true);
    expect(marks.has("▲")).toBe(true);
    expect(marks.has("☆")).toBe(true);
    expect(results.filter((r) => r.mark === "△").length).toBeGreaterThanOrEqual(1);
  });
});

describe("ensureTriangleMarks", () => {
  it("6位以下が buyLabel DISMISS でも、構造消しでなければ空印へ △ を足して4頭にする", () => {
    const results: HorseScoreResult[] = [
      row("h1", { finalRank: 1, mark: "◎", buyLabel: BUY_LABELS.FAVORITE }),
      row("h2", { finalRank: 2, mark: "○", buyLabel: BUY_LABELS.RIVAL }),
      row("h3", { finalRank: 3, mark: "▲", buyLabel: BUY_LABELS.TAN }),
      row("h4", { finalRank: 4, mark: "☆", buyLabel: BUY_LABELS.GROUP }),
      row("h5", { finalRank: 5, mark: "△", buyLabel: BUY_LABELS.GROUP }),
      ...[6, 7, 8, 9, 10].map((rnk) =>
        row(`h${rnk}`, {
          finalRank: rnk,
          mark: "",
          buyLabel: BUY_LABELS.DISMISS,
        }),
      ),
    ];
    const dismissIds = new Set<string>();
    ensureTriangleMarks(results, 4, dismissIds);
    const triangleIds = results.filter((r) => r.mark === "△").map((r) => r.horseId);
    expect(triangleIds).toHaveLength(4);
    expect(triangleIds).toContain("h5");
    expect(triangleIds).toContain("h6");
    expect(triangleIds).toContain("h7");
    expect(triangleIds).toContain("h8");
  });

  it("構造消し馬には △ を付けない", () => {
    const results: HorseScoreResult[] = [
      row("ok1", { finalRank: 1, mark: "◎", buyLabel: BUY_LABELS.FAVORITE }),
      row("ok2", { finalRank: 2, mark: "○", buyLabel: BUY_LABELS.RIVAL }),
      row("ok3", { finalRank: 3, mark: "▲", buyLabel: BUY_LABELS.TAN }),
      row("ok4", { finalRank: 4, mark: "☆", buyLabel: BUY_LABELS.GROUP }),
      row("ok5", { finalRank: 5, mark: "△", buyLabel: BUY_LABELS.GROUP }),
      row("bad", {
        finalRank: 10,
        mark: "",
        buyLabel: BUY_LABELS.DISMISS,
      }),
    ];
    const dismissIds = new Set<string>(["bad"]);
    ensureTriangleMarks(results, 4, dismissIds);
    expect(results.find((r) => r.horseId === "bad")?.mark).toBe("");
    expect(results.filter((r) => r.mark === "△").length).toBe(1);
  });
});
