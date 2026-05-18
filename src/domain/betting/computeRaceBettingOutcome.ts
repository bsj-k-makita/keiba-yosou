import type { HorseAbility, HorseScoreResult, RaceCondition } from "../race-evaluation/abilityTypes";
import { resolvePlaceToHorseId } from "../race-evaluation/markHitAnalysis";
import type { RaceResultData } from "../../lib/race-data/raceEvaluationTypes";
import { buildRaceBettingContext } from "./buildRaceBettingContext";
import { computeFormationHits, hasAnyFormationHit } from "./markFormationHits";
import { calculateRacePayout } from "./payoutCalculator";
import { analyzeSecondRowStatus } from "./secondRowAnalysis";

export type RaceBettingOutcome = {
  status: "pending" | "resolved";
  recoveryRate: number;
  totalInvested: number;
  totalPayout: number;
  /** 購入券の払戻あり */
  isHit: boolean;
  /** 印フォーメ（◎単勝・◎○馬連等）上は的中 */
  hasFormationHit: boolean;
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
    if (!hid) continue;
    const num = numberById.get(hid);
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
): RaceBettingOutcome | null {
  const ctx = buildRaceBettingContext(results, horses, condition, betAmount);
  if (ctx == null) return null;

  if (result == null || result.places.length < 3) {
    return {
      status: "pending",
      recoveryRate: 0,
      totalInvested: ctx.tickets.reduce((s, t) => s + t.combinations.length * t.betAmount, 0),
      totalPayout: 0,
      isHit: false,
      hasFormationHit: false,
      isSecondRowDead: false,
    };
  }

  const finishOrder = buildFinishOrder(result.places, horses, ctx.horseNumberById);
  if (finishOrder.length < 3) {
    return {
      status: "pending",
      recoveryRate: 0,
      totalInvested: ctx.tickets.reduce((s, t) => s + t.combinations.length * t.betAmount, 0),
      totalPayout: 0,
      isHit: false,
      hasFormationHit: false,
      isSecondRowDead: false,
    };
  }

  const payout = calculateRacePayout(ctx.tickets, {
    raceId: result.raceId,
    classLevel: ctx.classLevel,
    finishOrder,
    winOddsByNumber: ctx.winOddsByNumber,
    officialPayouts: result.payouts,
  });

  const second = analyzeSecondRowStatus(ctx.marks, ctx.classTier, finishOrder, ctx.favoriteNumber);
  const formationHits = computeFormationHits(ctx.marks, finishOrder, ctx.classTier);
  const recoveryRate =
    payout.totalInvested > 0
      ? Math.round((payout.totalPayout / payout.totalInvested) * 1000) / 10
      : 0;

  return {
    status: "resolved",
    recoveryRate,
    totalInvested: payout.totalInvested,
    totalPayout: payout.totalPayout,
    isHit: payout.totalPayout > 0,
    hasFormationHit: hasAnyFormationHit(formationHits),
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
