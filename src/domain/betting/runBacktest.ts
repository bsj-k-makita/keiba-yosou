import type { HorseAbility, RaceCondition, HorseScoreResult } from "../race-evaluation/abilityTypes";
import type { RaceGradeLabel } from "../../lib/race-data/raceEvaluationTypes";
import {
  inferRaceClassBucket,
  resolveClassTier,
  type RaceClassBucket,
} from "../race-evaluation/raceClassLevel";
import {
  type ClassTier,
  CLASS_TIER_RANK,
} from "../race-evaluation/resolveEffectiveRaceClass";
import { resolvePlaceToHorseId } from "../race-evaluation/markHitAnalysis";
import { getEffectiveEvaluationSignals } from "../race-evaluation/resolveEvaluationSignals";
import { raceHasFullAiBackfill } from "../../lib/pipeline/aiMarkAssignment";
import { runRaceEvaluationPipeline } from "../../lib/pipeline/evaluationPipeline";
import { type ProbabilityEngine } from "../../lib/pipeline/probabilityEngine";
import { buildRaceBettingContextFromPipeline } from "./buildRaceBettingContext";
import {
  computeFavoriteMarkHit,
  emptyFavoriteMarkAggregate,
  finalizeFavoriteMarkAggregate,
  mergeFavoriteMarkHit,
} from "./favoriteMarkStats";
import {
  buildPayoutFallbackOddsMap,
  countEvRecommendationPoints,
  resolvePostProcessFavoriteNumber,
  type MarkedHorseRef,
} from "./bettingRules";
import { buildRaceDetailLog, finalizeRaceDetailLog } from "./raceDetailLog";
import { aggregateSecondRowDead } from "./secondRowAnalysis";
import {
  calculateRacePayout,
  finalizeTicketStats,
  mergeTicketStats,
} from "./payoutCalculator";
import type { RaceOfficialPayouts } from "../../lib/race-data/raceEvaluationTypes";
import type {
  BacktestRaceOutput,
  BacktestSummary,
  BetTicketType,
  RaceBetResult,
  RaceDetailLog,
  TicketTypeStats,
} from "./types";

export type { BacktestRaceOutput } from "./types";

export type BacktestRaceInput = {
  raceId: string;
  meta: {
    date: string;
    venue: string;
    raceNumber: number;
    raceName?: string;
    surface: "芝" | "ダート";
    distance: number;
    raceGrade?: RaceGradeLabel;
  };
  condition: RaceCondition;
  horses: HorseAbility[];
  places: { place: number; horseId?: string; horseName?: string; horseNumber?: number }[];
  payouts?: RaceOfficialPayouts;
};

export type RunBacktestOnRaceOptions = {
  probabilityEngine?: ProbabilityEngine;
};

function horseNumberMap(horses: readonly HorseAbility[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const h of horses) {
    const gate = (h as HorseAbility & { gate?: number }).gate;
    if (gate != null && Number.isFinite(gate)) m.set(h.horseId, Math.round(gate));
  }
  return m;
}

function winOddsMap(horses: readonly HorseAbility[]): Map<number, number> {
  const m = new Map<number, number>();
  for (const h of horses) {
    const gate = (h as HorseAbility & { gate?: number }).gate;
    const sig = getEffectiveEvaluationSignals(h);
    const odds = sig?.winOdds;
    if (gate == null || odds == null || !Number.isFinite(odds) || odds <= 0) continue;
    m.set(Math.round(gate), odds);
  }
  return m;
}

function buildFinishOrder(
  places: BacktestRaceInput["places"],
  horses: readonly HorseAbility[],
  numberById: Map<string, number>,
): number[] {
  const sorted = [...places].sort((a, b) => a.place - b.place);
  const out: number[] = [];
  for (const p of sorted) {
    const hid = resolvePlaceToHorseId(p, horses);
    const num =
      (hid != null ? numberById.get(hid) : undefined) ??
      (p.horseNumber != null && Number.isFinite(p.horseNumber) ? p.horseNumber : undefined);
    if (num != null) out.push(num);
  }
  return out;
}

function emptyStats(): TicketTypeStats {
  return {
    invested: 0,
    payout: 0,
    rate: 0,
    accuracy: 0,
    hitCount: 0,
    betCount: 0,
    estimatedPayout: true,
  };
}

function emptyRaceResult(
  raceId: string,
  classLevel: RaceClassBucket,
  classTier: ClassTier,
  skippedReason: string,
  favoriteFields: Partial<Pick<RaceBetResult, "favoriteWinHit" | "favoriteShowHit">>,
): RaceBetResult {
  return {
    raceId,
    classLevel,
    classTier,
    totalInvested: 0,
    totalPayout: 0,
    byType: {
      WIN: emptyStats(),
      MAIN_LINE: emptyStats(),
      WIDE: emptyStats(),
      TRIFECTA_FORM: emptyStats(),
    },
    skippedReason,
    ...favoriteFields,
  };
}

function makeDetail(
  input: BacktestRaceInput,
  results: HorseScoreResult[],
  marks: readonly MarkedHorseRef[],
  classTier: ClassTier,
  finishOrder: number[],
  row: RaceBetResult,
  favoriteNumber?: number,
  probabilityEngine?: ProbabilityEngine,
): RaceDetailLog {
  return finalizeRaceDetailLog(
    buildRaceDetailLog({
      raceId: input.raceId,
      raceName: input.condition.raceName ?? input.meta.raceName ?? input.raceId,
      classTier,
      venue: input.meta.venue,
      raceNumber: input.meta.raceNumber,
      date: input.meta.date,
      marks,
      results,
      horses: input.horses,
      finishOrder,
      row,
      favoriteNumber,
      probabilityEngine,
    }),
  );
}

export function runBacktestOnRace(
  input: BacktestRaceInput,
  options?: RunBacktestOnRaceOptions,
): BacktestRaceOutput | null {
  const engine: ProbabilityEngine = options?.probabilityEngine ?? "ts";
  if (engine === "ai" && !raceHasFullAiBackfill(input.horses)) {
    return null;
  }

  const numberById = horseNumberMap(input.horses);
  if (numberById.size === 0) return null;

  const pipeline = runRaceEvaluationPipeline(input.horses, input.condition, {
    probabilityEngine: engine,
  });
  if (engine === "ai" && pipeline.probabilityEngine !== "ai") {
    return null;
  }

  const ctx = buildRaceBettingContextFromPipeline(
    pipeline,
    input.horses,
    input.condition,
    100,
  );
  const marks = ctx?.marks ?? [];
  const evTickets = ctx?.evTickets ?? [];
  const classTier = resolveClassTier(input.condition);
  const classLevel = inferRaceClassBucket(input.condition);
  const favoriteNumber = resolvePostProcessFavoriteNumber(marks);
  const finishOrder = buildFinishOrder(input.places, input.horses, numberById);
  const favoriteHit = computeFavoriteMarkHit(favoriteNumber, finishOrder);
  const favoriteFields =
    favoriteNumber != null
      ? { favoriteWinHit: favoriteHit.winHit, favoriteShowHit: favoriteHit.showHit }
      : {};

  if (marks.length === 0) {
    const empty = emptyRaceResult(input.raceId, classLevel, classTier, "no_marks", favoriteFields);
    return {
      result: empty,
      detail: makeDetail(
        input,
        pipeline.results,
        marks,
        classTier,
        finishOrder,
        empty,
        favoriteNumber,
        pipeline.probabilityEngine,
      ),
    };
  }

  if (finishOrder.length < 3) {
    const empty = emptyRaceResult(
      input.raceId,
      classLevel,
      classTier,
      "insufficient_results",
      favoriteFields,
    );
    return {
      result: empty,
      detail: makeDetail(
        input,
        pipeline.results,
        marks,
        classTier,
        finishOrder,
        empty,
        favoriteNumber,
        pipeline.probabilityEngine,
      ),
    };
  }

  const probByGate = new Map<number, number>();
  for (const [horseId, prob] of pipeline.adjustedProbabilities) {
    const gate = numberById.get(horseId);
    if (gate != null && Number.isFinite(prob)) probByGate.set(gate, prob);
  }

  const payoutInput = {
    raceId: input.raceId,
    classLevel,
    finishOrder,
    winOddsByNumber: winOddsMap(input.horses),
    officialPayouts: input.payouts,
    fallbackExoticOdds: buildPayoutFallbackOddsMap(input.horses, input.payouts, probByGate),
  };

  const evPayout = calculateRacePayout(evTickets, payoutInput);

  const evBetPointCount = countEvRecommendationPoints(evTickets);
  const advisoryReason = ctx?.advisoryReason;
  const evSkippedReason =
    evBetPointCount === 0 ? "no_ev_recommendation" : advisoryReason;

  const result: RaceBetResult = {
    ...evPayout,
    classTier,
    skippedReason: evSkippedReason,
    ...favoriteFields,
  };

  return {
    result,
    detail: makeDetail(
      input,
      pipeline.results,
      marks,
      classTier,
      finishOrder,
      result,
      favoriteNumber,
      pipeline.probabilityEngine,
    ),
  };
}

type AggregateSliceOptions = {
  /** true: 投資0レースを matched に含めない */
  skipZeroInvested: boolean;
};

function aggregateBettingSlice(
  outputs: readonly BacktestRaceOutput[],
  options: AggregateSliceOptions,
): Omit<
  BacktestSummary,
  "favoriteMark" | "secondRowDead" | "raceDetails" | "generatedAt" | "probabilityEngine" | "totalResultRaceCount" | "raceDetailsForHitList"
> {
  const byTicketType: Record<BetTicketType, TicketTypeStats> = {
    WIN: emptyStats(),
    MAIN_LINE: emptyStats(),
    WIDE: emptyStats(),
    TRIFECTA_FORM: emptyStats(),
  };
  const byClassLevel: Record<
    RaceClassBucket,
    { races: number; invested: number; payout: number; rate: number }
  > = {
    MAIDEN_NEW: { races: 0, invested: 0, payout: 0, rate: 0 },
    OPEN_GRADE: { races: 0, invested: 0, payout: 0, rate: 0 },
    OTHER: { races: 0, invested: 0, payout: 0, rate: 0 },
  };
  const tierKeys = (Object.keys(CLASS_TIER_RANK) as ClassTier[]).sort(
    (a, b) => CLASS_TIER_RANK[a] - CLASS_TIER_RANK[b],
  );
  const byClassTier = Object.fromEntries(
    tierKeys.map((t) => [t, { races: 0, invested: 0, payout: 0, rate: 0 }]),
  ) as Record<ClassTier, { races: number; invested: number; payout: number; rate: number }>;

  let totalInvested = 0;
  let totalPayout = 0;
  let matched = 0;
  let skipped = 0;

  for (const o of outputs) {
    const row = o.result;
    if (row.skippedReason === "no_marks" || row.skippedReason === "insufficient_results") {
      skipped += 1;
      continue;
    }
    if (options.skipZeroInvested && row.totalInvested === 0) {
      skipped += 1;
      continue;
    }
    matched += 1;
    totalInvested += row.totalInvested;
    totalPayout += row.totalPayout;
    mergeTicketStats(byTicketType, row);
    const cl = byClassLevel[row.classLevel];
    cl.races += 1;
    cl.invested += row.totalInvested;
    cl.payout += row.totalPayout;
    if (row.classTier != null) {
      const ct = byClassTier[row.classTier];
      ct.races += 1;
      ct.invested += row.totalInvested;
      ct.payout += row.totalPayout;
    }
  }

  finalizeTicketStats(byTicketType);
  for (const k of Object.keys(byClassLevel) as RaceClassBucket[]) {
    const c = byClassLevel[k];
    c.rate = c.invested > 0 ? Math.round((c.payout / c.invested) * 1000) / 10 : 0;
  }
  for (const t of tierKeys) {
    const c = byClassTier[t];
    c.rate = c.invested > 0 ? Math.round((c.payout / c.invested) * 1000) / 10 : 0;
  }

  return {
    totalRacesMatched: matched,
    totalRacesSkipped: skipped,
    totalInvestedSum: totalInvested,
    totalPayoutSum: totalPayout,
    totalRecoveryRate:
      totalInvested > 0 ? Math.round((totalPayout / totalInvested) * 1000) / 10 : 0,
    byTicketType,
    byClassLevel,
    byClassTier,
  };
}

export function aggregateBacktest(outputs: BacktestRaceOutput[]): BacktestSummary {
  const raceDetails = outputs.map((o) => o.detail);
  const core = aggregateBettingSlice(outputs, { skipZeroInvested: true });

  const favoriteMark = emptyFavoriteMarkAggregate();
  for (const o of outputs) {
    const row = o.result;
    if (row.favoriteWinHit != null && row.favoriteShowHit != null) {
      mergeFavoriteMarkHit(
        favoriteMark,
        { winHit: row.favoriteWinHit, showHit: row.favoriteShowHit },
        true,
      );
    }
  }
  finalizeFavoriteMarkAggregate(favoriteMark);
  const secondRowDead = aggregateSecondRowDead(raceDetails);

  return {
    ...core,
    favoriteMark,
    secondRowDead,
    raceDetails,
    generatedAt: new Date().toISOString(),
  };
}
