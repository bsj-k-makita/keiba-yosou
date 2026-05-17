import type { HorseAbility, HorseScoreResult, RaceCondition } from "../race-evaluation/abilityTypes";
import { inferRaceClassBucket, resolveClassTier } from "../race-evaluation/raceClassLevel";
import type { ClassTier } from "../race-evaluation/resolveEffectiveRaceClass";
import { getEffectiveEvaluationSignals } from "../race-evaluation/resolveEvaluationSignals";
import {
  buildSecondRowNumbers,
  buildThirdRowNumbers,
  generateTickets,
  marksFromResults,
  resolvePostProcessFavoriteNumber,
  type MarkedHorseRef,
} from "./bettingRules";
import type { BetTicket } from "./types";

export type RaceBettingContext = {
  marks: MarkedHorseRef[];
  classTier: ClassTier;
  classLevel: ReturnType<typeof inferRaceClassBucket>;
  tickets: BetTicket[];
  favoriteNumber?: number;
  secondRow: number[];
  thirdRow: number[];
  horseNameByNumber: Map<number, string>;
  horseNumberById: Map<string, number>;
  winOddsByNumber: Map<number, number>;
};

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
): RaceBettingContext | null {
  const { horseNumberById, horseNameByNumber, winOddsByNumber } = horseNumberMaps(horses);
  if (horseNumberById.size === 0) return null;

  const marks = marksFromResults(results, horseNumberById);
  if (marks.length === 0) return null;

  const classTier = resolveClassTier(condition);
  const classLevel = inferRaceClassBucket(condition);
  const favoriteNumber = resolvePostProcessFavoriteNumber(marks);
  const longshotStar = marks.find((h) => h.mark === "☆" && h.longshotReversalTrigger)?.horseNumber;

  return {
    marks,
    classTier,
    classLevel,
    tickets: generateTickets(marks, betAmount, { classTier }),
    favoriteNumber,
    secondRow: buildSecondRowNumbers(marks, classTier),
    thirdRow: buildThirdRowNumbers(marks, longshotStar),
    horseNameByNumber,
    horseNumberById,
    winOddsByNumber,
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
  for (const t of ctx.tickets) {
    if (t.ticketType === "WIN") {
      const n = t.combinations[0]?.[0];
      lines.push(`【単勝】${n}番 ${t.betAmount}円`);
      continue;
    }
    if (t.ticketType === "MAIN_LINE") {
      const combos = t.combinations.map((c) => c.join("-")).join(", ");
      lines.push(`【馬連】${combos} 各${t.betAmount}円（${t.combinations.length}点）`);
      continue;
    }
    const preview = t.combinations
      .slice(0, 8)
      .map((c) => c.join("-"))
      .join(", ");
    const more = t.combinations.length > 8 ? ` …他${t.combinations.length - 8}点` : "";
    lines.push(
      `【3連複】${preview}${more} 各${t.betAmount}円（${t.combinations.length}点・${(t.combinations.length * t.betAmount).toLocaleString()}円）`,
    );
  }
  return lines.join("\n");
}
