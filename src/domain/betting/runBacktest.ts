import type { HorseAbility, RaceCondition, HorseScoreResult } from "../race-evaluation/abilityTypes";
import type { RaceGradeLabel } from "../../lib/race-data/raceEvaluationTypes";
import { evaluateRace } from "../race-evaluation/scoreCalculator";
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
import {
  computeFavoriteMarkHit,
  emptyFavoriteMarkAggregate,
  finalizeFavoriteMarkAggregate,
  mergeFavoriteMarkHit,
} from "./favoriteMarkStats";
import { generateTickets, marksFromResults, resolvePostProcessFavoriteNumber } from "./bettingRules";
import { buildRaceDetailLog, finalizeRaceDetailLog } from "./raceDetailLog";
import { aggregateSecondRowDead } from "./secondRowAnalysis";
import {
  calculateRacePayout,
  finalizeTicketStats,
  mergeTicketStats,
} from "./payoutCalculator";
import type { RaceOfficialPayouts } from "../../lib/race-data/raceEvaluationTypes";
import type { BacktestSummary, BetTicketType, RaceBetResult, RaceDetailLog, TicketTypeStats } from "./types";

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

export type BacktestRaceOutput = {
  result: RaceBetResult;
  detail: RaceDetailLog;
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
    if (!hid) continue;
    const num = numberById.get(hid);
    if (num != null) out.push(num);
  }
  return out;
}

function makeDetail(
  input: BacktestRaceInput,
  results: HorseScoreResult[],
  marks: ReturnType<typeof marksFromResults>,
  classTier: ClassTier,
  finishOrder: number[],
  row: RaceBetResult,
  favoriteNumber?: number,
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
      finishOrder,
      row,
      favoriteNumber,
    }),
  );
}

export function runBacktestOnRace(input: BacktestRaceInput): BacktestRaceOutput | null {
  const numberById = horseNumberMap(input.horses);
  if (numberById.size === 0) return null;

  const results: HorseScoreResult[] = evaluateRace(input.horses, input.condition);
  const marks = marksFromResults(results, numberById);
  const classTier = resolveClassTier(input.condition);
  const classLevel = inferRaceClassBucket(input.condition);
  const tickets = generateTickets(marks, 100, { classTier });
  const favoriteNumber = resolvePostProcessFavoriteNumber(marks);
  const finishOrder = buildFinishOrder(input.places, input.horses, numberById);
  const favoriteHit = computeFavoriteMarkHit(favoriteNumber, finishOrder);
  const favoriteFields =
    favoriteNumber != null
      ? { favoriteWinHit: favoriteHit.winHit, favoriteShowHit: favoriteHit.showHit }
      : {};

  if (tickets.length === 0) {
    const result: RaceBetResult = {
      raceId: input.raceId,
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
      skippedReason: "no_marks",
      ...favoriteFields,
    };
    return { result, detail: makeDetail(input, results, marks, classTier, finishOrder, result, favoriteNumber) };
  }

  if (finishOrder.length < 3) {
    const result: RaceBetResult = {
      raceId: input.raceId,
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
      skippedReason: "insufficient_results",
      ...favoriteFields,
    };
    return { result, detail: makeDetail(input, results, marks, classTier, finishOrder, result, favoriteNumber) };
  }

  const payout = calculateRacePayout(tickets, {
    raceId: input.raceId,
    classLevel,
    finishOrder,
    winOddsByNumber: winOddsMap(input.horses),
    officialPayouts: input.payouts,
  });
  const result: RaceBetResult = { ...payout, classTier, ...favoriteFields };
  return { result, detail: makeDetail(input, results, marks, classTier, finishOrder, result, favoriteNumber) };
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

export function aggregateBacktest(
  outputs: BacktestRaceOutput[],
): BacktestSummary {
  const rows = outputs.map((o) => o.result);
  const raceDetails = outputs.map((o) => o.detail);

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
  const favoriteMark = emptyFavoriteMarkAggregate();

  for (const row of rows) {
    if (row.favoriteWinHit != null && row.favoriteShowHit != null) {
      mergeFavoriteMarkHit(
        favoriteMark,
        { winHit: row.favoriteWinHit, showHit: row.favoriteShowHit },
        true,
      );
    }

    if (row.skippedReason) {
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
  finalizeFavoriteMarkAggregate(favoriteMark);
  const secondRowDead = aggregateSecondRowDead(raceDetails);

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
    favoriteMark,
    secondRowDead,
    raceDetails,
    generatedAt: new Date().toISOString(),
  };
}
