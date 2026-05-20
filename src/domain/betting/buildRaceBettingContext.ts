import type { HorseAbility, HorseScoreResult, RaceCondition } from "../race-evaluation/abilityTypes";
import type { EvaluationPipelineResult } from "../../lib/pipeline/evaluationPipeline";
import { resolveAiRaceRegime } from "../../lib/pipeline/aiEvRegime";
import {
  applyAiMarksByEffectiveEv,
  buildAiProbabilityMap,
  raceHasFullAiBackfill,
  type ProbabilityEngine,
} from "../../lib/pipeline/probabilityEngine";
import { inferRaceClassBucket, resolveClassTier } from "../race-evaluation/raceClassLevel";
import type { ClassTier } from "../race-evaluation/resolveEffectiveRaceClass";
import { getEffectiveEvaluationSignals } from "../race-evaluation/resolveEvaluationSignals";
import {
  AI_EFFECTIVE_EV_THRESHOLD,
} from "../race-evaluation/investmentEvConstants";
import {
  buildOddsMapForEvEvaluation,
  buildSecondRowNumbers,
  buildThirdRowNumbers,
  countEvRecommendationPoints,
  generateBetTicketsFromEvaluation,
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
  /** 見送り推奨理由（あれば UI 表示のみ） */
  advisoryReason?: string;
};

export type BuildRaceBettingContextOptions = {
  adjustedProbabilities?: ReadonlyMap<string, number>;
  isSkippableRace?: boolean;
  probabilityEngine?: ProbabilityEngine;
  noAiEvRegime?: boolean;
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
): RaceBettingContext | null {
  return buildRaceBettingContext(pipeline.results, horses, condition, betAmount, {
    adjustedProbabilities: pipeline.adjustedProbabilities,
    isSkippableRace: pipeline.isSkippableRace,
    probabilityEngine: pipeline.probabilityEngine,
    noAiEvRegime: pipeline.aiRaceRegime === "NO_EV_REGIME",
  });
}

function buildEffectiveEvByGate(horses: readonly HorseAbility[]): Map<number, number> {
  const map = new Map<number, number>();
  for (const h of horses) {
    const gate = (h as HorseAbility & { gate?: number }).gate;
    if (gate == null || !Number.isFinite(gate)) continue;
    const ev = h.aiEffectiveEv;
    if (ev != null && Number.isFinite(ev)) {
      map.set(Math.round(gate), ev);
    }
  }
  return map;
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

  let resultsForBetting: readonly HorseScoreResult[] = results;
  if (probabilityEngine === "ai" && raceHasFullAiBackfill(horses)) {
    if (!results.some((r) => r.mark === "◎")) {
      resultsForBetting = applyAiMarksByEffectiveEv(results, horses);
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
  const oddsMap = buildOddsMapForEvEvaluation(horses, undefined, probByGate);
  const evTickets = generateBetTicketsFromEvaluation(
    {
      results: resultsForBetting,
      winProbabilities,
      horseNumberById,
      oddsMap,
      isSkippableRace,
      classTier,
    },
    betAmount,
    {
      classTier,
      probabilityEngine,
      effectiveEvByGate:
        probabilityEngine === "ai" ? buildEffectiveEvByGate(horses) : undefined,
    },
  );
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
  for (const t of ctx.evTickets) {
    if (t.ticketType === "WIN") {
      const combos = t.combinations.map((c) => `${c[0]}番`).join(", ");
      lines.push(`【単勝】${combos} 各${t.betAmount}円（${t.combinations.length}点）`);
      continue;
    }
    if (t.ticketType === "MAIN_LINE") {
      const combos = t.combinations.map((c) => c.join("-")).join(", ");
      lines.push(`【馬連】${combos} 各${t.betAmount}円（${t.combinations.length}点・実オッズ・EV≥1.3）`);
      continue;
    }
    if (t.ticketType === "WIDE") {
      const combos = t.combinations.map((c) => c.join("-")).join(", ");
      lines.push(`【ワイド】${combos} 各${t.betAmount}円（${t.combinations.length}点・実オッズ・EV≥1.3）`);
      continue;
    }
    const preview = t.combinations
      .slice(0, 8)
      .map((c) => c.join("-"))
      .join(", ");
    const more = t.combinations.length > 8 ? ` …他${t.combinations.length - 8}点` : "";
    lines.push(
      `【3連複】${preview}${more} 各${t.betAmount}円（${t.combinations.length}点・EV≥1.5）`,
    );
  }
  if (ctx.evTickets.length === 0) {
    if (ctx.advisoryReason === "no_ai_ev_regime") {
      return "【投資判断：低期待値につき見送り推奨】EV推奨なし（買い目0点）";
    }
    if (ctx.advisoryReason === "contradictory_marks") {
      return "【見送り推奨】評価1位と表示◎が不一致（買い目0点）";
    }
    if (ctx.advisoryReason === "no_ev_recommendation") {
      const evLabel =
        ctx.probabilityEngine === "ai"
          ? `EV≥${AI_EFFECTIVE_EV_THRESHOLD}`
          : "EV≥1.3";
      return `【見送り推奨】${evLabel}の買い目なし（買い目0点）`;
    }
    return "【見送り】EV推奨なし（買い目0点）";
  }
  return lines.join("\n");
}
