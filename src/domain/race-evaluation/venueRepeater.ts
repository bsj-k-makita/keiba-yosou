import type { HorseAbility, RaceCondition } from "./abilityTypes";

/** 競馬場名のゆらぎを吸収して比較用キーにする */
const VENUE_SHORT = [
  "札幌",
  "函館",
  "福島",
  "新潟",
  "東京",
  "中山",
  "阪神",
  "京都",
  "中京",
  "小倉",
] as const;

function resolveVenueKey(text: string): string | null {
  const t = text.replace(/競馬場|競馬|\s+/g, "").trim();
  for (const v of VENUE_SHORT) {
    if (t.includes(v)) return v;
  }
  return null;
}

function venuesAlign(conditionVenue: string, pastVenue: string | undefined): boolean {
  if (pastVenue == null || pastVenue.length === 0) return false;
  const a = resolveVenueKey(conditionVenue);
  const b = resolveVenueKey(pastVenue);
  if (a != null && b != null) return a === b;
  return false;
}

/**
 * 今回の開催場での過去好走が十分あるとき、構造消しの閾値を 1 段ゆるめる（誤消し緩和）。
 * - 同一競馬場で複勝圏が複数本、または同一場での勝ちがあれば救済
 */
export function venueRepeaterDismissRescue(horse: HorseAbility, condition: RaceCondition): boolean {
  const venue = `${condition.courseKey ?? ""} ${condition.venue ?? ""}`;
  const runs = horse.pastRuns ?? [];
  let placeHits = 0;
  let wins = 0;
  for (const r of runs.slice(0, 8)) {
    if (!venuesAlign(venue, r.venue)) continue;
    const p = r.place ?? 99;
    if (p === 1) wins += 1;
    if (p >= 1 && p <= 3) placeHits += 1;
  }
  if (wins >= 1) return true;
  if (placeHits >= 2) return true;
  return false;
}
