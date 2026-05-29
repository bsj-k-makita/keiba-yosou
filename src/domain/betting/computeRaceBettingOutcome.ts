import type { HorseAbility, HorseScoreResult, RaceCondition } from "../race-evaluation/abilityTypes";
import { resolvePlaceToHorseId } from "../race-evaluation/markHitAnalysis";
import type { RaceResultData } from "../../lib/race-data/raceEvaluationTypes";
import {
  buildRaceBettingContext,
  type BuildRaceBettingContextOptions,
} from "./buildRaceBettingContext";
import { buildPayoutFallbackOddsMap } from "./bettingRules";
import { getEffectiveEvaluationSignals } from "../race-evaluation/resolveEvaluationSignals";
import { calculateRacePayout } from "./payoutCalculator";
import { analyzeSecondRowStatus } from "./secondRowAnalysis";
import { BET_TICKET_TYPES } from "./types";

export type RaceBettingOutcome = {
  status: "pending" | "resolved";
  recoveryRate: number;
  totalInvested: number;
  totalPayout: number;
  /** 全券種（印フォーメ）のいずれかが的中 */
  isHit: boolean;
  isSecondRowDead: boolean;
};

function buildFinishOrder(
  places: RaceResultData["places"],
  horses: readonly HorseAbility[],
  numberById: Map<string, number>,
): number[] {
  const sorted = [...places].sort((a, b) => a.place - b.place);
  const out: number[] = [];
  for (const p of sorted) {
    const hid = resolvePlaceToHorseId(p, horses);
    const placeHorseNumber = (p as { horseNumber?: number }).horseNumber;
    const num =
      (hid != null ? numberById.get(hid) : undefined) ??
      (placeHorseNumber != null && Number.isFinite(placeHorseNumber) ? placeHorseNumber : undefined);
    if (num != null) out.push(num);
  }
  return out;
}

export function computeRaceBettingOutcome(
  results: readonly HorseScoreResult[],
  horses: readonly HorseAbility[],
  condition: RaceCondition,
  result: RaceResultData | null | undefined,
  betAmount = 100,
  pipelineOpts?: BuildRaceBettingContextOptions,
): RaceBettingOutcome | null {
  const ctx = buildRaceBettingContext(results, horses, condition, betAmount, pipelineOpts);
  if (ctx == null) return null;

  if (result == null || result.places.length < 3) {
    const invested = ctx.formationTickets.reduce((s, t) => s + t.combinations.length * t.betAmount, 0);
    return {
      status: "pending",
      recoveryRate: 0,
      totalInvested: invested,
      totalPayout: 0,
      isHit: false,
      isSecondRowDead: false,
    };
  }

  const finishOrder = buildFinishOrder(result.places, horses, ctx.horseNumberById);
  if (finishOrder.length < 3) {
    const invested = ctx.formationTickets.reduce((s, t) => s + t.combinations.length * t.betAmount, 0);
    return {
      status: "pending",
      recoveryRate: 0,
      totalInvested: invested,
      totalPayout: 0,
      isHit: false,
      isSecondRowDead: false,
    };
  }

  const probByGate = new Map<number, number>();
  for (const h of horses) {
    const gate = (h as { gate?: number }).gate;
    if (gate == null || !Number.isFinite(gate)) continue;
    const g = Math.round(gate);
    const fromAi = h.aiPredictedWinRate;
    if (fromAi != null && fromAi > 0) {
      probByGate.set(g, fromAi);
      continue;
    }
    const winOdds = getEffectiveEvaluationSignals(h)?.winOdds;
    if (winOdds != null && winOdds > 0) probByGate.set(g, 1 / winOdds);
  }

  const payout = calculateRacePayout(ctx.formationTickets, {
    raceId: result.raceId,
    classLevel: ctx.classLevel,
    finishOrder,
    winOddsByNumber: ctx.winOddsByNumber,
    officialPayouts: result.payouts,
    fallbackExoticOdds: buildPayoutFallbackOddsMap(horses, result.payouts, probByGate),
  });

  const second = analyzeSecondRowStatus(
    ctx.marks,
    ctx.classTier,
    finishOrder,
    ctx.favoriteNumber,
    ctx.probabilityEngine,
  );
  const recoveryRate =
    payout.totalInvested > 0
      ? Math.round((payout.totalPayout / payout.totalInvested) * 1000) / 10
      : 0;
  const isHit = BET_TICKET_TYPES.some((t) => payout.byType[t].hitCount > 0);

  return {
    status: "resolved",
    recoveryRate,
    totalInvested: payout.totalInvested,
    totalPayout: payout.totalPayout,
    isHit,
    isSecondRowDead: second.isSecondRowDead,
  };
}

export type ListBettingRecoveryStats = {
  sampleSize: number;
  totalInvested: number;
  totalPayout: number;
  recoveryRate: number;
  hitRaces: number;
};

export function mergeListBettingRecoveryStats(
  outcomes: readonly (RaceBettingOutcome | null | undefined)[],
): ListBettingRecoveryStats {
  let sampleSize = 0;
  let totalInvested = 0;
  let totalPayout = 0;
  let hitRaces = 0;

  for (const o of outcomes) {
    if (o == null || o.status !== "resolved") continue;
    if (o.totalInvested <= 0) continue;
    sampleSize += 1;
    totalInvested += o.totalInvested;
    totalPayout += o.totalPayout;
    if (o.isHit) hitRaces += 1;
  }

  return {
    sampleSize,
    totalInvested,
    totalPayout,
    recoveryRate:
      totalInvested > 0 ? Math.round((totalPayout / totalInvested) * 1000) / 10 : 0,
    hitRaces,
  };
}
