import type { HorseAbility, HorseScoreResult } from "../race-evaluation/abilityTypes";
import { classTierLabelJa, type ClassTier } from "../race-evaluation/resolveEffectiveRaceClass";
import type { ProbabilityEngine } from "../../lib/pipeline/probabilityEngine";
import type { MarkedHorseRef } from "./bettingRules";
import { analyzeSecondRowStatus } from "./secondRowAnalysis";
import type { BetTicketType, RaceBetResult, RaceDetailLog, RaceDetailTicketSlot } from "./types";

function ticketSlot(row: RaceBetResult, t: BetTicketType): RaceDetailTicketSlot {
  const b = row.byType[t];
  return {
    invested: b.invested,
    payout: b.payout,
    isHit: b.payout > 0,
  };
}

export function buildAiMarksMap(marks: readonly MarkedHorseRef[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of marks) {
    out[String(m.horseNumber)] = m.mark;
  }
  return out;
}

export function buildHorseNameByNumber(horses: readonly HorseAbility[]): Map<number, string> {
  const out = new Map<number, string>();
  for (const h of horses) {
    const gate = (h as HorseAbility & { gate?: number }).gate;
    if (gate == null || !Number.isFinite(gate)) continue;
    out.set(Math.round(gate), h.horseName);
  }
  return out;
}

export function formatFinishWithMarks(
  finishOrder: readonly number[],
  aiMarks: Record<string, string>,
  horseNameByNumber?: ReadonlyMap<number, string>,
  limit = 3,
): string {
  return finishOrder
    .slice(0, limit)
    .map((n) => {
      const mark = aiMarks[String(n)] ?? "─";
      const name = horseNameByNumber?.get(n);
      if (name) return `${n}番 ${name}(${mark})`;
      return `${n}(${mark})`;
    })
    .join("→");
}

export function isEvSkipDetail(detail: RaceDetailLog): boolean {
  return (
    detail.totalInvested === 0 &&
    (detail.skippedReason === "no_ev_recommendation" ||
      detail.skippedReason === "no_ai_ev_regime" ||
      detail.skippedReason === "contradictory_marks")
  );
}

export function buildDiagnosisLabel(detail: RaceDetailLog): string {
  if (isEvSkipDetail(detail)) {
    return "【見送り判定成功】";
  }
  if (detail.skippedReason === "no_marks") return "【集計外】印なし";
  if (detail.skippedReason === "insufficient_results") return "【集計外】着順不足";

  const f = detail.tickets;
  if (f.TRIFECTA_FORM.isHit) return "【完璧】3連複的中";
  if (f.MAIN_LINE.isHit && !f.TRIFECTA_FORM.isHit) return "【馬連のみ】3連複は不的中";
  if (f.WIN.isHit) return "【単勝的中】";
  if (detail.isSecondRowDead) return "【2列目全滅】3着にヒモ決着";
  if (detail.isAnchorHit && detail.totalPayout > 0) return "【部分的中】";
  if (!detail.isAnchorHit) return "【軸トビ】";
  return "【不的中】";
}

export function buildRaceDetailLog(params: {
  raceId: string;
  raceName: string;
  classTier: ClassTier;
  venue: string;
  raceNumber: number;
  date: string;
  marks: readonly MarkedHorseRef[];
  results: readonly HorseScoreResult[];
  horses?: readonly HorseAbility[];
  finishOrder: readonly number[];
  row: RaceBetResult;
  favoriteNumber?: number;
  probabilityEngine?: ProbabilityEngine;
}): RaceDetailLog {
  const { marks, finishOrder, row, classTier, results, favoriteNumber, horses } = params;
  const aiMarks = buildAiMarksMap(marks);
  const horseNameByNumber = horses ? buildHorseNameByNumber(horses) : undefined;
  const engine = params.probabilityEngine ?? "ts";
  const second = analyzeSecondRowStatus(marks, classTier, finishOrder, favoriteNumber, engine);

  const favoriteHorseId = results.find((r) => r.mark === "◎")?.horseId;
  const dominantComment =
    results.find((r) => r.horseId === favoriteHorseId)?.predictionShortComment?.trim() ||
    results.find((r) => r.predictionShortComment)?.predictionShortComment?.trim() ||
    "";

  return {
    raceId: params.raceId,
    raceName: params.raceName,
    classTier,
    classTierLabel: classTierLabelJa(classTier),
    venue: params.venue,
    raceNumber: params.raceNumber,
    date: params.date,
    actualResults: finishOrder.slice(0, 3),
    finishLabel: formatFinishWithMarks(finishOrder, aiMarks, horseNameByNumber),
    aiMarks,
    tickets: {
      WIN: ticketSlot(row, "WIN"),
      MAIN_LINE: ticketSlot(row, "MAIN_LINE"),
      WIDE: ticketSlot(row, "WIDE"),
      TRIFECTA_FORM: ticketSlot(row, "TRIFECTA_FORM"),
    },
    totalInvested: row.totalInvested,
    totalPayout: row.totalPayout,
    dominantComment,
    isAnchorHit: second.isAnchorHit,
    isSecondRowDead: second.isSecondRowDead,
    diagnosisLabel: "",
    skippedReason: row.skippedReason,
  };
}

export function finalizeRaceDetailLog(detail: RaceDetailLog): RaceDetailLog {
  return { ...detail, diagnosisLabel: buildDiagnosisLabel(detail) };
}

export function sortRaceDetailsForDisplay(details: RaceDetailLog[]): RaceDetailLog[] {
  return [...details].sort((a, b) => {
    if (a.totalPayout !== b.totalPayout) return b.totalPayout - a.totalPayout;
    if (a.tickets.TRIFECTA_FORM.payout !== b.tickets.TRIFECTA_FORM.payout) {
      return b.tickets.TRIFECTA_FORM.payout - a.tickets.TRIFECTA_FORM.payout;
    }
    return a.raceId.localeCompare(b.raceId);
  });
}
