import type { HorseScoreResult } from "../race-evaluation/abilityTypes";
import {
  type ClassTier,
  CLASS_TIER_RANK,
  isGradedOpenTier,
} from "../race-evaluation/resolveEffectiveRaceClass";
import type { BetTicket } from "./types";

export type MarkedHorseRef = {
  horseNumber: number;
  mark: string;
  hokkakeRole?: HorseScoreResult["hokkakeRole"];
  longshotReversalTrigger?: boolean;
  finalRank?: number;
  connectionsBonus?: number;
};

export type GenerateTicketsOptions = {
  classTier?: ClassTier;
};

const HIMOE_ROLES = new Set<HorseScoreResult["hokkakeRole"]>([
  "△1安定",
  "△2物理",
  "△3狙い",
]);

const CONNECTIONS_SECOND_ROW_MIN = 2.5;

function sortComb(a: number, b: number): number[] {
  return [a, b].sort((x, y) => x - y);
}

function sortTrifecta(a: number, b: number, c: number): number[] {
  return [a, b, c].sort((x, y) => x - y);
}

function trifectaKey(comb: number[]): string {
  return comb.join("-");
}

export function resolvePostProcessFavoriteNumber(
  marks: readonly MarkedHorseRef[],
): number | undefined {
  return marks.find((h) => h.mark === "◎")?.horseNumber;
}

/**
 * 3列目: ○▲☆△（2列目と重複可。各列から1頭ずつ異なる馬番で3連複を形成）
 * 例: 2列目=○▲ / 3列目=○▲☆△ → ◎-○-▲ の組み合わせが買い目に含まれる
 */
export function buildThirdRowNumbers(
  marks: readonly MarkedHorseRef[],
  longshotStar?: number,
): number[] {
  const nums = new Set<number>();

  for (const h of marks) {
    if (h.mark === "○" || h.mark === "▲") {
      nums.add(h.horseNumber);
      continue;
    }
    if (h.mark === "☆") {
      if (longshotStar != null && h.horseNumber === longshotStar) continue;
      nums.add(h.horseNumber);
      continue;
    }
    if (h.mark !== "△") continue;

    if (h.hokkakeRole != null && HIMOE_ROLES.has(h.hokkakeRole)) {
      nums.add(h.horseNumber);
      continue;
    }

    const fr = h.finalRank ?? 99;
    if (fr <= 5) nums.add(h.horseNumber);
  }

  return [...nums];
}

/**
 * Tier別2列目：未勝利は○▲のみ逆縮小、OP・重賞は拡張＋陣営上位バックアップ。
 */
export function buildSecondRowNumbers(
  marks: readonly MarkedHorseRef[],
  classTier: ClassTier = "CONDITIONAL_LOWER",
): number[] {
  const taiko = marks.find((h) => h.mark === "○")?.horseNumber;
  const ana = marks.find((h) => h.mark === "▲")?.horseNumber;
  const stabilityTop = marks.find((h) => h.hokkakeRole === "△1安定")?.horseNumber;
  const longshotStar = marks.find(
    (h) => h.mark === "☆" && h.longshotReversalTrigger === true,
  )?.horseNumber;

  const set = new Set<number>();

  if (classTier === "MAIDEN_NEW") {
    if (taiko != null) set.add(taiko);
    if (ana != null) set.add(ana);
    return [...set];
  }

  if (taiko != null) set.add(taiko);
  if (ana != null) set.add(ana);

  if (isGradedOpenTier(classTier)) {
    if (stabilityTop != null) set.add(stabilityTop);
    if (longshotStar != null) set.add(longshotStar);

    const backup = marks
      .filter((h) => h.mark !== "◎" && (h.connectionsBonus ?? 0) >= CONNECTIONS_SECOND_ROW_MIN)
      .sort((a, b) => (b.connectionsBonus ?? 0) - (a.connectionsBonus ?? 0))[0];
    if (backup != null) set.add(backup.horseNumber);
  } else if (CLASS_TIER_RANK[classTier] <= CLASS_TIER_RANK.CONDITIONAL_UPPER) {
    if (stabilityTop != null) set.add(stabilityTop);
  }

  return [...set];
}

export function buildOptimizedTrifectaCombinations(
  marks: readonly MarkedHorseRef[],
  options?: GenerateTicketsOptions,
): number[][] {
  const classTier = options?.classTier ?? "CONDITIONAL_LOWER";
  const omaru = resolvePostProcessFavoriteNumber(marks);
  if (omaru == null) return [];

  const longshotStar = marks.find(
    (h) => h.mark === "☆" && h.longshotReversalTrigger === true,
  )?.horseNumber;

  const thirdRow = buildThirdRowNumbers(marks, longshotStar);
  if (thirdRow.length === 0) return [];

  const secondRow = buildSecondRowNumbers(marks, classTier);
  if (secondRow.length === 0) return [];

  const uniq = new Map<string, number[]>();
  for (const second of secondRow) {
    if (second === omaru) continue;
    for (const third of thirdRow) {
      if (third === omaru || third === second) continue;
      const comb = sortTrifecta(omaru, second, third);
      uniq.set(trifectaKey(comb), comb);
    }
  }

  return [...uniq.values()];
}

const WIDE_PARTNER_MARKS = new Set(["○", "▲", "☆", "△"]);

/** ワイド: ◎と各印（○▲☆△）の2頭組。3着以内に両方入れば的中 */
export function buildWideCombinations(
  marks: readonly MarkedHorseRef[],
  omaru: number,
): number[][] {
  const uniq = new Map<string, number[]>();
  for (const h of marks) {
    if (h.horseNumber === omaru) continue;
    if (!WIDE_PARTNER_MARKS.has(h.mark)) continue;
    const comb = sortComb(omaru, h.horseNumber);
    uniq.set(comb.join("-"), comb);
  }
  return [...uniq.values()];
}

export function generateTickets(
  marks: readonly MarkedHorseRef[],
  betAmount = 100,
  options?: GenerateTicketsOptions,
): BetTicket[] {
  const omaru = resolvePostProcessFavoriteNumber(marks);
  const taiko = marks.find((h) => h.mark === "○")?.horseNumber;
  const ana = marks.find((h) => h.mark === "▲")?.horseNumber;

  const tickets: BetTicket[] = [];

  if (omaru != null) {
    tickets.push({ ticketType: "WIN", combinations: [[omaru]], betAmount });
  }

  if (omaru != null && taiko != null && ana != null) {
    tickets.push({
      ticketType: "MAIN_LINE",
      combinations: [
        sortComb(omaru, taiko),
        sortComb(omaru, ana),
        sortComb(taiko, ana),
      ],
      betAmount,
    });
  }

  if (omaru != null) {
    const wideCombinations = buildWideCombinations(marks, omaru);
    if (wideCombinations.length > 0) {
      tickets.push({ ticketType: "WIDE", combinations: wideCombinations, betAmount });
    }
  }

  const trifectaCombinations = buildOptimizedTrifectaCombinations(marks, options);
  if (omaru != null && trifectaCombinations.length > 0) {
    tickets.push({
      ticketType: "TRIFECTA_FORM",
      combinations: trifectaCombinations,
      betAmount,
    });
  }

  return tickets;
}

export function marksFromResults(
  results: readonly HorseScoreResult[],
  horseNumberById: Map<string, number>,
): MarkedHorseRef[] {
  const out: MarkedHorseRef[] = [];
  for (const r of results) {
    const mark = r.mark ?? "";
    if (!mark) continue;
    const horseNumber = horseNumberById.get(r.horseId);
    if (horseNumber == null || !Number.isFinite(horseNumber)) continue;
    out.push({
      horseNumber,
      mark,
      hokkakeRole: r.hokkakeRole,
      longshotReversalTrigger: r.longshotReversalTrigger,
      finalRank: r.finalRank,
      connectionsBonus: r.connectionsBonus,
    });
  }
  return out;
}
