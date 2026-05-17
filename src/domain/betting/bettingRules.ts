import type { HorseScoreResult } from "../race-evaluation/abilityTypes";
import type { BetTicket } from "./types";

export type MarkedHorseRef = {
  horseNumber: number;
  mark: string;
  hokkakeRole?: HorseScoreResult["hokkakeRole"];
  longshotReversalTrigger?: boolean;
  /** evaluateRace 完了後の最終順位（3列目間引き用） */
  finalRank?: number;
};

const HIMOE_ROLES = new Set<HorseScoreResult["hokkakeRole"]>([
  "△1安定",
  "△2物理",
  "△3狙い",
]);

function sortComb(a: number, b: number): number[] {
  return [a, b].sort((x, y) => x - y);
}

function sortTrifecta(a: number, b: number, c: number): number[] {
  return [a, b, c].sort((x, y) => x - y);
}

function trifectaKey(comb: number[]): string {
  return comb.join("-");
}

/**
 * 4角◎振替・ポートフォリオ分散後の最終 `mark === '◎'` を軸にする（finalRank 1位は使わない）。
 */
export function resolvePostProcessFavoriteNumber(
  marks: readonly MarkedHorseRef[],
): number | undefined {
  const fav = marks.find((h) => h.mark === "◎");
  return fav?.horseNumber;
}

/**
 * 3列目：△1/2/3・☆を優先。ヒモ役未割当の △ は finalRank 5位以内のみ残す。
 */
export function buildThirdRowNumbers(
  marks: readonly MarkedHorseRef[],
  longshotStar?: number,
): number[] {
  const nums = new Set<number>();

  for (const h of marks) {
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
 * 期待値分散型 3連複フォーメ（実戦型◎ × 拡張2列目 × スリム3列目）。
 */
export function buildOptimizedTrifectaCombinations(
  marks: readonly MarkedHorseRef[],
): number[][] {
  const omaru = resolvePostProcessFavoriteNumber(marks);
  if (omaru == null) return [];

  const taiko = marks.find((h) => h.mark === "○")?.horseNumber;
  const ana = marks.find((h) => h.mark === "▲")?.horseNumber;
  const stabilityTop = marks.find((h) => h.hokkakeRole === "△1安定")?.horseNumber;
  const longshotStar = marks.find(
    (h) => h.mark === "☆" && h.longshotReversalTrigger === true,
  )?.horseNumber;

  const thirdRow = buildThirdRowNumbers(marks, longshotStar);
  if (thirdRow.length === 0) return [];

  const secondRowSet = new Set<number>();
  if (taiko != null) secondRowSet.add(taiko);
  if (ana != null) secondRowSet.add(ana);
  if (stabilityTop != null) secondRowSet.add(stabilityTop);
  if (longshotStar != null) secondRowSet.add(longshotStar);

  if (secondRowSet.size === 0) {
    if (taiko != null) secondRowSet.add(taiko);
    if (ana != null) secondRowSet.add(ana);
  }
  if (secondRowSet.size === 0) return [];

  const uniq = new Map<string, number[]>();
  for (const second of secondRowSet) {
    if (second === omaru) continue;
    for (const third of thirdRow) {
      if (third === omaru || third === second) continue;
      const comb = sortTrifecta(omaru, second, third);
      uniq.set(trifectaKey(comb), comb);
    }
  }

  return [...uniq.values()];
}

/**
 * 印付き馬から定型3ルールの購入チケットを生成。
 */
export function generateTickets(
  marks: readonly MarkedHorseRef[],
  betAmount = 100,
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

  const trifectaCombinations = buildOptimizedTrifectaCombinations(marks);
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
    });
  }
  return out;
}
