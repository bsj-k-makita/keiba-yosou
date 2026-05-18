import type { HorseAbility, HorseScoreResult, RaceCondition } from "../race-evaluation/abilityTypes";
import type { ProbabilityEngine } from "../../lib/pipeline/probabilityEngine";
import { inferRaceClassBucket, resolveClassTier } from "../race-evaluation/raceClassLevel";
import type { ClassTier } from "../race-evaluation/resolveEffectiveRaceClass";
import { getEffectiveEvaluationSignals } from "../race-evaluation/resolveEvaluationSignals";
import {
  buildOddsMapFromHorses,
  buildSecondRowNumbers,
  buildThirdRowNumbers,
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
  tickets: BetTicket[];
  favoriteNumber?: number;
  secondRow: number[];
  thirdRow: number[];
  horseNameByNumber: Map<number, string>;
  horseNumberById: Map<string, number>;
  winOddsByNumber: Map<number, number>;
  isSkippableRace: boolean;
  /** EV基準を満たす買い目（ユーザー推奨用。集計は tickets を使用） */
  evTickets: BetTicket[];
  /** 見送り推奨理由（あれば UI 表示のみ） */
  advisoryReason?: string;
};

export type BuildRaceBettingContextOptions = {
  adjustedProbabilities?: ReadonlyMap<string, number>;
  isSkippableRace?: boolean;
  probabilityEngine?: ProbabilityEngine;
};

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

  const marks = marksFromResults(results, horseNumberById);
  const classTier = resolveClassTier(condition);
  const classLevel = inferRaceClassBucket(condition);
  const favoriteNumber = resolvePostProcessFavoriteNumber(marks);
  const longshotStar = marks.find((h) => h.mark === "☆" && h.longshotReversalTrigger)?.horseNumber;
  const isSkippableRace = pipelineOpts?.isSkippableRace ?? false;
  const winProbabilities = pipelineOpts?.adjustedProbabilities ?? new Map<string, number>();

  const oddsMap = buildOddsMapFromHorses(horses);
  const probabilityEngine = pipelineOpts?.probabilityEngine ?? "ts";
  const evTickets = generateBetTicketsFromEvaluation(
    {
      results,
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
  const tickets = generateFormationBetTickets(marks, classTier, betAmount);
  const evBetPointCount = evTickets.reduce((s, t) => s + t.combinations.length, 0);
  const advisoryReason = resolveBettingAdvisoryReason({
    isSkippableRace,
    hasMarks: marks.length > 0,
    evBetPointCount,
  });

  return {
    marks,
    classTier,
    classLevel,
    tickets,
    evTickets,
    advisoryReason,
    favoriteNumber,
    secondRow: buildSecondRowNumbers(marks, classTier),
    thirdRow: buildThirdRowNumbers(marks, longshotStar),
    horseNameByNumber,
    horseNumberById,
    winOddsByNumber,
    isSkippableRace,
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
  if (ctx.advisoryReason === "contradictory_marks") {
    lines.unshift("【見送り推奨】評価1位と表示◎が不一致（定型買い目は下記の通り）");
  } else if (ctx.advisoryReason === "no_ev_recommendation") {
    lines.unshift("【見送り推奨】EV≥1.3の買い目なし（定型フォーメは下記の通り）");
  }
  return lines.join("\n");
}
