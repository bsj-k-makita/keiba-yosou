import type { HorseAbility, RaceCondition, HorseScoreResult } from "../race-evaluation/abilityTypes";
import type { RaceGradeLabel } from "../../lib/race-data/raceEvaluationTypes";
import { evaluateRace } from "../race-evaluation/scoreCalculator";
import { inferRaceClassBucket, type RaceClassBucket } from "../race-evaluation/raceClassLevel";
import { resolvePlaceToHorseId } from "../race-evaluation/markHitAnalysis";
import { getEffectiveEvaluationSignals } from "../race-evaluation/resolveEvaluationSignals";
import { generateTickets, marksFromResults } from "./bettingRules";
import {
  calculateRacePayout,
  finalizeTicketStats,
  mergeTicketStats,
} from "./payoutCalculator";
import type { BacktestSummary, BetTicketType, RaceBetResult, TicketTypeStats } from "./types";

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

export function runBacktestOnRace(input: BacktestRaceInput): RaceBetResult | null {
  const numberById = horseNumberMap(input.horses);
  if (numberById.size === 0) return null;

  const results: HorseScoreResult[] = evaluateRace(input.horses, input.condition);
  const marks = marksFromResults(results, numberById);
  const tickets = generateTickets(marks);
  if (tickets.length === 0) {
    return {
      raceId: input.raceId,
      classLevel: inferRaceClassBucket(input.condition),
      totalInvested: 0,
      totalPayout: 0,
      byType: {
        WIN: emptyStats(),
        MAIN_LINE: emptyStats(),
        TRIFECTA_FORM: emptyStats(),
      },
      skippedReason: "no_marks",
    };
  }

  const finishOrder = buildFinishOrder(input.places, input.horses, numberById);
  if (finishOrder.length < 3) {
    return {
      raceId: input.raceId,
      classLevel: inferRaceClassBucket(input.condition),
      totalInvested: 0,
      totalPayout: 0,
      byType: {
        WIN: emptyStats(),
        MAIN_LINE: emptyStats(),
        TRIFECTA_FORM: emptyStats(),
      },
      skippedReason: "insufficient_results",
    };
  }

  return calculateRacePayout(tickets, {
    raceId: input.raceId,
    classLevel: inferRaceClassBucket(input.condition),
    finishOrder,
    winOddsByNumber: winOddsMap(input.horses),
  });
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

export function aggregateBacktest(rows: RaceBetResult[]): BacktestSummary {
  const byTicketType: Record<BetTicketType, TicketTypeStats> = {
    WIN: emptyStats(),
    MAIN_LINE: emptyStats(),
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

  let totalInvested = 0;
  let totalPayout = 0;
  let matched = 0;
  let skipped = 0;

  for (const row of rows) {
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
  }

  finalizeTicketStats(byTicketType);
  for (const k of Object.keys(byClassLevel) as RaceClassBucket[]) {
    const c = byClassLevel[k];
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
    generatedAt: new Date().toISOString(),
  };
}
