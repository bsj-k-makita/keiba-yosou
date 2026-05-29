import type { HorseAbility, HorseScoreResult, RaceCondition } from "../race-evaluation/abilityTypes";
import type { EvaluationPipelineResult } from "../../lib/pipeline/evaluationPipeline";
import { resolveAiRaceRegime } from "../../lib/pipeline/aiEvRegime";
import {
  applyAiMarksByEffectiveEv,
  buildAiProbabilityMap,
  raceHasFullAiBackfill,
  tsWinRateOf,
  type AnchorHonmeiWinRateRule,
  type ProbabilityEngine,
} from "../../lib/pipeline/probabilityEngine";
import { inferRaceClassBucket, resolveClassTier } from "../race-evaluation/raceClassLevel";
import type { ClassTier } from "../race-evaluation/resolveEffectiveRaceClass";
import { getEffectiveEvaluationSignals } from "../race-evaluation/resolveEvaluationSignals";
import {
  buildOddsMapForEvEvaluation,
  buildSecondRowNumbers,
  buildThirdRowNumbers,
  countEvRecommendationPoints,
  generateBetTicketsFromEvaluation,
  generateFormationBetTickets,
  marksFromResults,
  resolveBettingAdvisoryReason,
  resolvePostProcessFavoriteNumber,
  type MarkedHorseRef,
} from "./bettingRules";
import type { BetTicket } from "./types";

export type RaceBettingContext = {
  marks: MarkedHorseRef[];
  classTier: ClassTier;
  classLevel: ReturnType<typeof inferRaceClassBucket>;
  favoriteNumber?: number;
  secondRow: number[];
  thirdRow: number[];
  horseNameByNumber: Map<number, string>;
  horseNumberById: Map<string, number>;
  winOddsByNumber: Map<number, number>;
  isSkippableRace: boolean;
  probabilityEngine: ProbabilityEngine;
  /** EV基準を満たす買い目（UI・集計の唯一のソース） */
  evTickets: BetTicket[];
  /** 印フォーメーション（単勝・馬連・ワイド・3連複 全券種・各100円） */
  formationTickets: BetTicket[];
  /** 見送り推奨理由（あれば UI 表示のみ） */
  advisoryReason?: string;
};

export type BuildRaceBettingContextOptions = {
  adjustedProbabilities?: ReadonlyMap<string, number>;
  isSkippableRace?: boolean;
  probabilityEngine?: ProbabilityEngine;
  noAiEvRegime?: boolean;
  /** ◎付与時の勝率8%ルール（相印はAI EV順のまま） */
  anchorHonmeiWinRateRule?: AnchorHonmeiWinRateRule;
};

/** 評価パイプライン出力から馬券コンテキストを組み立てる（印・EVエンジンを揃える） */
export function buildRaceBettingContextFromPipeline(
  pipeline: Pick<
    EvaluationPipelineResult,
    "results" | "adjustedProbabilities" | "probabilityEngine" | "isSkippableRace" | "aiRaceRegime"
  >,
  horses: readonly HorseAbility[],
  condition: RaceCondition,
  betAmount = 100,
  pipelineOpts?: Pick<BuildRaceBettingContextOptions, "anchorHonmeiWinRateRule">,
): RaceBettingContext | null {
  return buildRaceBettingContext(pipeline.results, horses, condition, betAmount, {
    adjustedProbabilities: pipeline.adjustedProbabilities,
    isSkippableRace: pipeline.isSkippableRace,
    probabilityEngine: pipeline.probabilityEngine,
    noAiEvRegime: pipeline.aiRaceRegime === "NO_EV_REGIME",
    ...pipelineOpts,
  });
}

function horseNumberMaps(horses: readonly HorseAbility[]): {
  horseNumberById: Map<string, number>;
  horseNameByNumber: Map<number, string>;
  winOddsByNumber: Map<number, number>;
} {
  const horseNumberById = new Map<string, number>();
  const horseNameByNumber = new Map<number, string>();
  const winOddsByNumber = new Map<number, number>();

  for (const h of horses) {
    const gate = (h as HorseAbility & { gate?: number }).gate;
    if (gate == null || !Number.isFinite(gate)) continue;
    const num = Math.round(gate);
    horseNumberById.set(h.horseId, num);
    horseNameByNumber.set(num, h.horseName);
    const odds = getEffectiveEvaluationSignals(h)?.winOdds;
    if (odds != null && Number.isFinite(odds) && odds > 0) {
      winOddsByNumber.set(num, odds);
    }
  }

  return { horseNumberById, horseNameByNumber, winOddsByNumber };
}

export function buildRaceBettingContext(
  results: readonly HorseScoreResult[],
  horses: readonly HorseAbility[],
  condition: RaceCondition,
  betAmount = 100,
  pipelineOpts?: BuildRaceBettingContextOptions,
): RaceBettingContext | null {
  const { horseNumberById, horseNameByNumber, winOddsByNumber } = horseNumberMaps(horses);
  if (horseNumberById.size === 0) return null;

  const probabilityEngine: ProbabilityEngine =
    pipelineOpts?.probabilityEngine ??
    (raceHasFullAiBackfill(horses) ? "ai" : "ts");
  const isSkippableRace =
    probabilityEngine === "ai" ? false : (pipelineOpts?.isSkippableRace ?? false);
  const noAiEvRegime =
    pipelineOpts?.noAiEvRegime ??
    (probabilityEngine === "ai" && resolveAiRaceRegime(horses) === "NO_EV_REGIME");

  const explicitAnchorRule = pipelineOpts?.anchorHonmeiWinRateRule;
  const anchorHonmeiWinRateRule = explicitAnchorRule ?? "ai";
  let resultsForBetting: readonly HorseScoreResult[] = results;
  if (probabilityEngine === "ai" && raceHasFullAiBackfill(horses)) {
    const needsAnchorReapply =
      explicitAnchorRule != null || !results.some((r) => r.mark === "◎");
    if (needsAnchorReapply) {
      resultsForBetting = applyAiMarksByEffectiveEv(
        results,
        horses,
        condition,
        anchorHonmeiWinRateRule,
      );
    }
  }

  const marks = marksFromResults(resultsForBetting, horseNumberById, winOddsByNumber);
  const classTier = resolveClassTier(condition);
  const classLevel = inferRaceClassBucket(condition);
  const favoriteNumber = resolvePostProcessFavoriteNumber(marks);
  const longshotStar = marks.find((h) => h.mark === "☆" && h.longshotReversalTrigger)?.horseNumber;
  const pipelineProbabilities = pipelineOpts?.adjustedProbabilities ?? new Map<string, number>();
  const winProbabilities =
    probabilityEngine === "ai" && raceHasFullAiBackfill(horses)
      ? buildAiProbabilityMap(horses)
      : new Map<string, number>(pipelineProbabilities);

  const probByGate = new Map<number, number>();
  for (const [horseId, prob] of winProbabilities) {
    const gate = horseNumberById.get(horseId);
    if (gate != null && Number.isFinite(prob)) probByGate.set(gate, prob);
  }
  const anchorGateWinRateProbabilities =
    anchorHonmeiWinRateRule === "ts"
      ? new Map(
          horses.map((h) => [h.horseId, tsWinRateOf(h)] as const),
        )
      : winProbabilities;
  const oddsMap = buildOddsMapForEvEvaluation(horses, undefined, probByGate);
  const evTickets = generateBetTicketsFromEvaluation(
    {
      results: resultsForBetting,
      winProbabilities,
      horseNumberById,
      oddsMap,
      isSkippableRace,
      classTier,
      anchorGateWinRateProbabilities,
    },
    betAmount,
    {
      classTier,
      probabilityEngine,
    },
  );
  const formationTickets =
    marks.length > 0
      ? generateFormationBetTickets(marks, classTier, betAmount, {
          favoriteWinOdds:
            favoriteNumber != null ? winOddsByNumber.get(favoriteNumber) : undefined,
          probabilityEngine,
        })
      : [];
  const evBetPointCount = countEvRecommendationPoints(evTickets);
  const advisoryReason = resolveBettingAdvisoryReason({
    isSkippableRace,
    hasMarks: marks.length > 0,
    evBetPointCount,
    noAiEvRegime,
    probabilityEngine,
  });

  return {
    marks,
    classTier,
    classLevel,
    evTickets,
    formationTickets,
    advisoryReason,
    favoriteNumber,
    secondRow: buildSecondRowNumbers(marks, classTier, probabilityEngine),
    thirdRow: buildThirdRowNumbers(marks, longshotStar),
    horseNameByNumber,
    horseNumberById,
    winOddsByNumber,
    isSkippableRace,
    probabilityEngine,
  };
}

export function formatHorseList(numbers: readonly number[], nameByNumber: Map<number, string>): string {
  return numbers
    .map((n) => {
      const name = nameByNumber.get(n);
      return name ? `${n}番${name}` : `${n}番`;
    })
    .join("、");
}

export function buildTicketsCopyText(ctx: RaceBettingContext): string {
  const lines: string[] = [];
  for (const t of ctx.formationTickets) {
    if (t.ticketType === "WIN") {
      const combos = t.combinations.map((c) => `${c[0]}番`).join(", ");
      lines.push(`【単勝】${combos} 各${t.betAmount}円（${t.combinations.length}点）`);
      continue;
    }
    if (t.ticketType === "MAIN_LINE") {
      const combos = t.combinations.map((c) => c.join("-")).join(", ");
      lines.push(`【馬連】${combos} 各${t.betAmount}円（${t.combinations.length}点）`);
      continue;
    }
    if (t.ticketType === "WIDE") {
      const combos = t.combinations.map((c) => c.join("-")).join(", ");
      lines.push(`【ワイド】${combos} 各${t.betAmount}円（${t.combinations.length}点）`);
      continue;
    }
    const preview = t.combinations
      .slice(0, 8)
      .map((c) => c.join("-"))
      .join(", ");
    const more = t.combinations.length > 8 ? ` …他${t.combinations.length - 8}点` : "";
    lines.push(`【3連複】${preview}${more} 各${t.betAmount}円（${t.combinations.length}点）`);
  }
  if (ctx.formationTickets.length === 0) {
    return "【買い目なし】印が不足しています";
  }
  return lines.join("\n");
}
