import type { HorseScoreResult } from "../race-evaluation/abilityTypes";
import type { BetTicket } from "./types";

export type MarkedHorseRef = {
  horseNumber: number;
  mark: string;
  hokkakeRole?: HorseScoreResult["hokkakeRole"];
  longshotReversalTrigger?: boolean;
};

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
 * 期待値分散型 3連複フォーメ（◎ × 拡張2列目 × △☆ヒモ）。
 * 2列目: ○▲ + △1安定 + 爆穴トリガー☆（2列目昇格）
 */
export function buildOptimizedTrifectaCombinations(
  marks: readonly MarkedHorseRef[],
): number[][] {
  const byMark = (m: string) => marks.find((h) => h.mark === m)?.horseNumber;
  const omaru = byMark("◎");
  if (omaru == null) return [];

  const taiko = byMark("○");
  const ana = byMark("▲");
  const stabilityTop = marks.find((h) => h.hokkakeRole === "△1安定")?.horseNumber;
  const longshotStar = marks.find(
    (h) => h.mark === "☆" && h.longshotReversalTrigger === true,
  )?.horseNumber;

  const himoArray = marks
    .filter((h) => h.mark === "△" || h.mark === "☆")
    .map((h) => h.horseNumber)
    .filter((n) => Number.isFinite(n));

  if (himoArray.length === 0) return [];

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
    for (const third of himoArray) {
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
  const byMark = (m: string) => marks.find((h) => h.mark === m)?.horseNumber;
  const omaru = byMark("◎");
  const taiko = byMark("○");
  const ana = byMark("▲");

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
    });
  }
  return out;
}
