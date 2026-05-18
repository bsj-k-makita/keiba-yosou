import type { ClassTier } from "../race-evaluation/resolveEffectiveRaceClass";
import type { BetTicketType } from "./types";
import {
  buildOptimizedTrifectaCombinations,
  buildWideCombinations,
  resolvePostProcessFavoriteNumber,
  type MarkedHorseRef,
} from "./bettingRules";

export type FormationHitMap = Record<BetTicketType, boolean>;

function top2Set(finishOrder: readonly number[]): Set<number> {
  return new Set(finishOrder.slice(0, 2));
}

function top3Set(finishOrder: readonly number[]): Set<number> {
  return new Set(finishOrder.slice(0, 3));
}

function combInTop3(comb: number[], top3: Set<number>): boolean {
  return comb.every((n) => top3.has(n));
}

/**
 * 印（◎○▲☆△）と着順から、旧フォーメーション戦略上の的中を判定する。
 * 購入チケット（EV）とは独立。BT画面の「印的中」表示に使う。
 */
export function computeFormationHits(
  marks: readonly MarkedHorseRef[],
  finishOrder: readonly number[],
  classTier: ClassTier,
): FormationHitMap {
  const out: FormationHitMap = {
    WIN: false,
    MAIN_LINE: false,
    WIDE: false,
    TRIFECTA_FORM: false,
  };

  if (finishOrder.length < 2 || marks.length === 0) return out;

  const omaru = resolvePostProcessFavoriteNumber(marks);
  const maru = marks.find((m) => m.mark === "○")?.horseNumber;
  const top2 = top2Set(finishOrder);
  const top3 = top3Set(finishOrder);

  if (omaru != null && finishOrder[0] === omaru) {
    out.WIN = true;
  }

  if (omaru != null && maru != null && top2.has(omaru) && top2.has(maru)) {
    out.MAIN_LINE = true;
  }

  if (omaru != null && finishOrder.length >= 3) {
    const wideCombs = buildWideCombinations(marks, omaru);
    out.WIDE = wideCombs.some((comb) => combInTop3(comb, top3));
  }

  if (finishOrder.length >= 3) {
    const triCombs = buildOptimizedTrifectaCombinations(marks, { classTier });
    out.TRIFECTA_FORM = triCombs.some((comb) => combInTop3(comb, top3));
  }

  return out;
}

export function hasAnyFormationHit(hits: FormationHitMap): boolean {
  return hits.WIN || hits.MAIN_LINE || hits.WIDE || hits.TRIFECTA_FORM;
}
