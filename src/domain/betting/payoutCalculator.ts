import type { BetTicket, BetTicketType, RaceBetResult, RacePayoutInput, TicketTypeStats } from "./types";
import type { RaceOfficialPayoutRow, RaceOfficialPayouts } from "../../lib/race-data/raceEvaluationTypes";

function emptyTypeStats(estimated: boolean): TicketTypeStats {
  return {
    invested: 0,
    payout: 0,
    rate: 0,
    accuracy: 0,
    hitCount: 0,
    betCount: 0,
    estimatedPayout: estimated,
  };
}

function combKey(nums: number[]): string {
  return [...nums].sort((a, b) => a - b).join("-");
}

function isWinHit(comb: number[], finishOrder: number[]): boolean {
  return finishOrder[0] === comb[0];
}

function isMainLineHit(comb: number[], finishOrder: number[]): boolean {
  if (finishOrder.length < 2) return false;
  const top2 = new Set(finishOrder.slice(0, 2));
  return top2.has(comb[0]!) && top2.has(comb[1]!);
}

function isTrifectaHit(comb: number[], finishOrder: number[]): boolean {
  if (finishOrder.length < 3) return false;
  const top3 = new Set(finishOrder.slice(0, 3));
  return top3.has(comb[0]!) && top3.has(comb[1]!) && top3.has(comb[2]!);
}

function poolForTicket(
  payouts: RaceOfficialPayouts | undefined,
  ticketType: BetTicketType,
): RaceOfficialPayoutRow[] | null {
  if (!payouts) return null;
  if (ticketType === "WIN") return payouts.WIN;
  if (ticketType === "MAIN_LINE") return payouts.REN;
  if (ticketType === "TRIFECTA_FORM") return payouts.TRI;
  return null;
}

/** 確定配当（100円あたり）を馬番組み合わせから検索 */
export function lookupOfficialDividend(
  payouts: RaceOfficialPayouts | undefined,
  ticketType: BetTicketType,
  comb: number[],
): number | null {
  const pool = poolForTicket(payouts, ticketType);
  if (!pool || pool.length === 0) return null;
  const key = combKey(comb);
  for (const row of pool) {
    if (combKey(row.numbers) === key) return row.dividend;
  }
  return null;
}

function estimateWinPayout(horseNo: number, winOddsByNumber: Map<number, number>, betAmount: number): number {
  const odds = winOddsByNumber.get(horseNo);
  if (odds == null || !Number.isFinite(odds) || odds <= 0) return 0;
  return (betAmount / 100) * odds * 100;
}

function usesOfficialPayouts(payouts: RaceOfficialPayouts | undefined, ticketType: BetTicketType): boolean {
  const pool = poolForTicket(payouts, ticketType);
  return pool != null && pool.length > 0;
}

export function calculateRacePayout(
  tickets: BetTicket[],
  input: RacePayoutInput,
): RaceBetResult {
  const official = input.officialPayouts;
  const byType: RaceBetResult["byType"] = {
    WIN: emptyTypeStats(!usesOfficialPayouts(official, "WIN")),
    MAIN_LINE: emptyTypeStats(!usesOfficialPayouts(official, "MAIN_LINE")),
    TRIFECTA_FORM: emptyTypeStats(!usesOfficialPayouts(official, "TRIFECTA_FORM")),
  };

  let raceInvested = 0;
  let racePayout = 0;

  for (const ticket of tickets) {
    const cost = ticket.combinations.length * ticket.betAmount;
    const bucket = byType[ticket.ticketType];
    bucket.invested += cost;
    bucket.betCount += ticket.combinations.length;
    raceInvested += cost;

    for (const comb of ticket.combinations) {
      let hit = false;
      if (ticket.ticketType === "WIN") hit = isWinHit(comb, input.finishOrder);
      else if (ticket.ticketType === "MAIN_LINE") hit = isMainLineHit(comb, input.finishOrder);
      else hit = isTrifectaHit(comb, input.finishOrder);

      if (!hit) continue;

      bucket.hitCount += 1;
      const officialDividend = lookupOfficialDividend(official, ticket.ticketType, comb);
      let payout = 0;
      if (officialDividend != null) {
        payout = (ticket.betAmount / 100) * officialDividend;
        bucket.estimatedPayout = false;
      } else if (ticket.ticketType === "WIN") {
        payout = estimateWinPayout(comb[0]!, input.winOddsByNumber, ticket.betAmount);
        bucket.estimatedPayout = bucket.estimatedPayout && payout <= 0;
      }
      bucket.payout += payout;
      racePayout += payout;
    }
  }

  for (const t of Object.keys(byType) as BetTicketType[]) {
    const b = byType[t];
    b.rate = b.invested > 0 ? Math.round((b.payout / b.invested) * 1000) / 10 : 0;
    b.accuracy = b.betCount > 0 ? Math.round((b.hitCount / b.betCount) * 1000) / 10 : 0;
  }

  return {
    raceId: input.raceId,
    classLevel: input.classLevel,
    totalInvested: raceInvested,
    totalPayout: racePayout,
    byType,
  };
}

export function mergeTicketStats(
  acc: Record<BetTicketType, TicketTypeStats>,
  row: RaceBetResult,
): void {
  for (const t of Object.keys(acc) as BetTicketType[]) {
    const a = acc[t];
    const b = row.byType[t];
    a.invested += b.invested;
    a.payout += b.payout;
    a.hitCount += b.hitCount;
    a.betCount += b.betCount;
    a.estimatedPayout = a.estimatedPayout && b.estimatedPayout;
  }
}

export function finalizeTicketStats(acc: Record<BetTicketType, TicketTypeStats>): void {
  for (const t of Object.keys(acc) as BetTicketType[]) {
    const b = acc[t];
    b.rate = b.invested > 0 ? Math.round((b.payout / b.invested) * 1000) / 10 : 0;
    b.accuracy = b.betCount > 0 ? Math.round((b.hitCount / b.betCount) * 1000) / 10 : 0;
  }
}
