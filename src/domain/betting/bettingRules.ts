import type { HorseScoreResult } from "../race-evaluation/abilityTypes";
import type { BetTicket } from "./types";

export type MarkedHorseRef = {
  horseNumber: number;
  mark: string;
};

function sortComb(a: number, b: number): number[] {
  return [a, b].sort((x, y) => x - y);
}

function sortTrifecta(a: number, b: number, c: number): number[] {
  return [a, b, c].sort((x, y) => x - y);
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
  const himo = marks
    .filter((h) => h.mark === "△" || h.mark === "☆")
    .map((h) => h.horseNumber)
    .filter((n) => Number.isFinite(n));

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

  if (omaru != null && taiko != null && ana != null && himo.length > 0) {
    const trifectaCombinations: number[][] = [];
    for (const second of [taiko, ana]) {
      for (const third of himo) {
        if (second === third) continue;
        trifectaCombinations.push(sortTrifecta(omaru, second, third));
      }
    }
    const uniq = new Map(trifectaCombinations.map((c) => [c.join("-"), c]));
    tickets.push({
      ticketType: "TRIFECTA_FORM",
      combinations: [...uniq.values()],
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
    out.push({ horseNumber, mark });
  }
  return out;
}
