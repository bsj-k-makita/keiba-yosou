import type { BetTicket, BetTicketType, RaceBetResult, RacePayoutInput, TicketTypeStats } from "./types";
import type { OddsMap } from "./bettingRules";
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

function expectedCombinationSize(ticketType: BetTicketType): number {
  if (ticketType === "WIN") return 1;
  if (ticketType === "MAIN_LINE") return 2;
  if (ticketType === "WIDE") return 2;
  return 3;
}

function normalizeCombination(
  comb: number[],
  expectedSize: number,
): number[] | null {
  if (comb.length !== expectedSize) return null;
  if (comb.some((n) => !Number.isFinite(n))) return null;
  const sorted = [...comb].sort((a, b) => a - b);
  if (new Set(sorted).size !== expectedSize) return null;
  return sorted;
}

function isExactMatchCombination(
  left: number[],
  right: number[],
): boolean {
  if (left.length !== right.length) return false;
  for (let i = 0; i < left.length; i++) {
    if (left[i] !== right[i]) return false;
  }
  return true;
}

function isWinHit(comb: number[], finishOrder: number[]): boolean {
  return finishOrder[0] === comb[0];
}

function isMainLineHit(comb: number[], finishOrder: number[]): boolean {
  if (finishOrder.length < 2) return false;
  const top2 = new Set(finishOrder.slice(0, 2));
  return top2.has(comb[0]!) && top2.has(comb[1]!);
}

function isWideHit(comb: number[], finishOrder: number[]): boolean {
  if (finishOrder.length < 3) return false;
  const top3 = new Set(finishOrder.slice(0, 3));
  return top3.has(comb[0]!) && top3.has(comb[1]!);
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
  if (ticketType === "WIDE") return payouts.WREN;
  if (ticketType === "TRIFECTA_FORM") return payouts.TRI;
  return null;
}

function findOfficialPayoutRow(
  payouts: RaceOfficialPayouts | undefined,
  ticketType: BetTicketType,
  comb: number[],
): RaceOfficialPayoutRow | null {
  const pool = poolForTicket(payouts, ticketType);
  if (!pool || pool.length === 0) return null;
  const expectedSize = expectedCombinationSize(ticketType);
  const normalizedComb = normalizeCombination(comb, expectedSize);
  if (normalizedComb == null) return null;
  for (const row of pool) {
    const normalizedRow = normalizeCombination(row.numbers, expectedSize);
    if (normalizedRow == null) continue;
    if (isExactMatchCombination(normalizedComb, normalizedRow)) {
      return row;
    }
  }
  return null;
}

/** 公式払戻行に同一組み合わせが存在するか（ソート済み完全一致） */
export function checkOfficialHit(
  ticketType: BetTicketType,
  myCombination: number[],
  officialPayouts: RaceOfficialPayouts | undefined,
): boolean {
  return findOfficialPayoutRow(officialPayouts, ticketType, myCombination) != null;
}

/** 確定配当（100円あたり）を馬番組み合わせから検索 */
export function lookupOfficialDividend(
  payouts: RaceOfficialPayouts | undefined,
  ticketType: BetTicketType,
  comb: number[],
): number | null {
  return findOfficialPayoutRow(payouts, ticketType, comb)?.dividend ?? null;
}

function lookupFallbackOddsMultiplier(
  fallback: Pick<OddsMap, "ren" | "wide" | "trifecta"> | undefined,
  ticketType: BetTicketType,
  comb: number[],
): number | undefined {
  if (!fallback) return undefined;
  const normalizedComb = normalizeCombination(comb, expectedCombinationSize(ticketType));
  if (normalizedComb == null) return undefined;
  const key = combKey(normalizedComb);
  if (ticketType === "MAIN_LINE") return fallback.ren?.[key];
  if (ticketType === "WIDE") return fallback.wide?.[key];
  if (ticketType === "TRIFECTA_FORM") return fallback.trifecta?.[key];
  return undefined;
}

function positiveMultiplier(value: number | undefined): number | undefined {
  if (value == null || !Number.isFinite(value) || value <= 0) return undefined;
  return value;
}

function payoutFromMultiplier(betAmount: number, multiplier: number): number {
  return (betAmount / 100) * multiplier * 100;
}

function estimateWinPayout(horseNo: number, winOddsByNumber: Map<number, number>, betAmount: number): number {
  const odds = winOddsByNumber.get(horseNo);
  const mult = positiveMultiplier(odds);
  if (mult == null) return 0;
  return payoutFromMultiplier(betAmount, mult);
}

function estimateExoticPayout(
  ticketType: BetTicketType,
  comb: number[],
  betAmount: number,
  input: RacePayoutInput,
): number {
  if (ticketType === "WIN") return 0;
  const mult = positiveMultiplier(
    lookupFallbackOddsMultiplier(input.fallbackExoticOdds, ticketType, comb),
  );
  if (mult == null) return 0;
  return payoutFromMultiplier(betAmount, mult);
}

function usesOfficialPayouts(payouts: RaceOfficialPayouts | undefined, ticketType: BetTicketType): boolean {
  const pool = poolForTicket(payouts, ticketType);
  return pool != null && pool.length > 0;
}

function isWinningByFinishOrder(
  ticketType: BetTicketType,
  comb: number[],
  finishOrder: number[],
): boolean {
  if (ticketType === "WIN") return isWinHit(comb, finishOrder);
  if (ticketType === "MAIN_LINE") return isMainLineHit(comb, finishOrder);
  if (ticketType === "WIDE") return isWideHit(comb, finishOrder);
  return isTrifectaHit(comb, finishOrder);
}

export function calculateRacePayout(
  tickets: BetTicket[],
  input: RacePayoutInput,
): RaceBetResult {
  const official = input.officialPayouts;
  const byType: RaceBetResult["byType"] = {
    WIN: emptyTypeStats(!usesOfficialPayouts(official, "WIN")),
    MAIN_LINE: emptyTypeStats(!usesOfficialPayouts(official, "MAIN_LINE")),
    WIDE: emptyTypeStats(!usesOfficialPayouts(official, "WIDE")),
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
      const expectedSize = expectedCombinationSize(ticket.ticketType);
      const normalizedComb = normalizeCombination(comb, expectedSize);
      if (normalizedComb == null) continue;
      const officialMode = usesOfficialPayouts(official, ticket.ticketType);
      const officialDividend = lookupOfficialDividend(official, ticket.ticketType, normalizedComb);
      const hit = officialMode
        ? checkOfficialHit(ticket.ticketType, normalizedComb, official)
        : isWinningByFinishOrder(ticket.ticketType, normalizedComb, input.finishOrder);

      if (!hit) continue;

      bucket.hitCount += 1;
      let payout = 0;
      if (officialDividend != null) {
        payout = (ticket.betAmount / 100) * officialDividend;
      } else if (ticket.ticketType === "WIN") {
        payout = estimateWinPayout(normalizedComb[0]!, input.winOddsByNumber, ticket.betAmount);
        if (payout > 0) bucket.estimatedPayout = true;
      } else {
        payout = estimateExoticPayout(ticket.ticketType, normalizedComb, ticket.betAmount, input);
        if (payout > 0) bucket.estimatedPayout = true;
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
