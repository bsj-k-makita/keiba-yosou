import type { RaceEvaluationData, RaceIndexItem, RaceResultData } from "../../lib/race-data/raceEvaluationTypes";
import { isUsableRaceResult } from "../../lib/race-data/raceResultLoad";
import {
  pickEntryAiWinRate,
  pickEntryStoredAiEffectiveEv,
  pickEntryWinOdds,
} from "./effectiveEv";
import { valueRankFromEffectiveEv } from "./valueRankFromEffectiveEv";
import type { RaceEntryEvaluation } from "../../lib/race-data/raceEvaluationTypes";

export type WeeklyTopEvRaceItem = {
  raceId: string;
  date: string;
  venue: string;
  raceNumber: number;
  raceName?: string;
  /** Python AI ◎ の ai_effective_ev（TOP5の並びにも使用） */
  maxEv: number;
  valueRank: ReturnType<typeof valueRankFromEffectiveEv>;
  /** Python AI ◎（applyAiMarksByEffectiveEv と同じ順位付け） */
  bestHorseNumber: number;
  bestHorseName: string;
  bestHorseJockey?: string;
  bestHorseRate?: number;
  bestHorseOdds?: number;
};

/**
 * Python AI ◎ = ai_effective_ev 降順の1位（同率時は勝率→finalEvaluationScore）。
 * 一覧プレビューの ◎ とズレないよう、保存値 ai_effective_ev を使う。
 */
export function pickAiFavoriteEntryFromEvaluation(
  data: RaceEvaluationData,
): { entry: RaceEntryEvaluation; ev: number } | null {
  const ranked = [...data.entries].sort((a, b) => {
    const evA = pickEntryStoredAiEffectiveEv(a) ?? Number.NEGATIVE_INFINITY;
    const evB = pickEntryStoredAiEffectiveEv(b) ?? Number.NEGATIVE_INFINITY;
    if (evB !== evA) return evB - evA;
    const pA = pickEntryAiWinRate(a) ?? 0;
    const pB = pickEntryAiWinRate(b) ?? 0;
    if (pB !== pA) return pB - pA;
    const scoreA = a.evaluation?.finalEvaluationScore ?? 0;
    const scoreB = b.evaluation?.finalEvaluationScore ?? 0;
    return scoreB - scoreA;
  });

  const top = ranked[0];
  if (top == null) return null;
  const ev = pickEntryStoredAiEffectiveEv(top);
  if (ev == null || !Number.isFinite(ev)) return null;
  return { entry: top, ev };
}

function formatIsoDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** 月曜始まりの当週（anchor を含む） */
export function getWeekDateRange(anchorDate: string): { start: string; end: string } {
  const d = new Date(`${anchorDate}T12:00:00`);
  const dow = d.getDay();
  const mondayOffset = dow === 0 ? -6 : 1 - dow;
  const mon = new Date(d);
  mon.setDate(d.getDate() + mondayOffset);
  const sun = new Date(mon);
  sun.setDate(mon.getDate() + 6);
  return { start: formatIsoDate(mon), end: formatIsoDate(sun) };
}

export function isDateInWeek(date: string, anchorDate: string): boolean {
  const { start, end } = getWeekDateRange(anchorDate);
  return date >= start && date <= end;
}

export function filterRacesInWeek(
  rows: readonly RaceIndexItem[],
  anchorDate: string,
): RaceIndexItem[] {
  return rows.filter((r) => isDateInWeek(r.date, anchorDate));
}

/**
 * 当週のこれから開催するレース（今日を含むカレンダー週内かつ race.date >= today）。
 * 例: 5/20 時点 → 5/23〜5/24 のみ（5/17 など過去開催日は除外）。
 */
export function filterUpcomingRacesInCalendarWeek(
  rows: readonly RaceIndexItem[],
  todayIso: string,
): RaceIndexItem[] {
  const { start, end } = getWeekDateRange(todayIso);
  return rows.filter((r) => r.date >= todayIso && r.date >= start && r.date <= end);
}

/** 開催日一覧から TOP5 見出し用ラベルを生成 */
export function formatWeekScopeLabelFromRows(
  rows: readonly Pick<RaceIndexItem, "date">[],
): string {
  const dates = [...new Set(rows.map((r) => r.date))].sort();
  if (dates.length === 0) return "";
  const fmt = (iso: string) => iso.slice(5).replace("-", "/");
  if (dates.length === 1) return fmt(dates[0]!);
  return `${fmt(dates[0]!)}〜${fmt(dates[dates.length - 1]!)}`;
}

/** 当週TOP5の対象レース日付ラベル（実際に含まれる開催日の min〜max） */
export function formatUpcomingWeekScopeLabel(
  rows: readonly RaceIndexItem[],
  todayIso: string,
): string {
  const scoped = filterUpcomingRacesInCalendarWeek(rows, todayIso);
  const label = formatWeekScopeLabelFromRows(scoped);
  if (label) return label;
  const { start, end } = getWeekDateRange(todayIso);
  return `${start.slice(5).replace("-", "/")}〜${end.slice(5).replace("-", "/")}`;
}

/** 結果確定済み（着順3頭以上）のレースを除外 */
export async function filterUnconfirmedUpcomingRaces(
  rows: readonly RaceIndexItem[],
  todayIso: string,
  loadResult: (raceId: string) => Promise<RaceResultData | null>,
): Promise<RaceIndexItem[]> {
  const upcoming = filterUpcomingRacesInCalendarWeek(rows, todayIso);
  const checks = await Promise.all(
    upcoming.map(async (row) => {
      const result = await loadResult(row.raceId);
      return { row, confirmed: isUsableRaceResult(result) };
    }),
  );
  return checks.filter((c) => !c.confirmed).map((c) => c.row);
}

export function computeRaceMaxEvFromEvaluation(
  data: RaceEvaluationData,
): Omit<WeeklyTopEvRaceItem, "raceId" | "date" | "venue" | "raceNumber" | "raceName"> | null {
  const favorite = pickAiFavoriteEntryFromEvaluation(data);
  if (favorite == null) return null;

  const { entry, ev } = favorite;
  return {
    maxEv: Math.round(ev * 1000) / 1000,
    valueRank: valueRankFromEffectiveEv(ev),
    bestHorseNumber: entry.horseNumber,
    bestHorseName: entry.horseName,
    bestHorseJockey: entry.jockey,
    bestHorseRate: pickEntryAiWinRate(entry),
    bestHorseOdds: pickEntryWinOdds(entry),
  };
}

export async function fetchWeeklyTopEvRaces(
  rows: readonly RaceIndexItem[],
  todayIso: string,
  loadEvaluation: (raceId: string) => Promise<RaceEvaluationData | null>,
  topN = 5,
  loadResult?: (raceId: string) => Promise<RaceResultData | null>,
): Promise<WeeklyTopEvRaceItem[]> {
  const weekRows =
    loadResult != null
      ? await filterUnconfirmedUpcomingRaces(rows, todayIso, loadResult)
      : filterUpcomingRacesInCalendarWeek(rows, todayIso);
  const items: WeeklyTopEvRaceItem[] = [];

  await Promise.all(
    weekRows.map(async (meta) => {
      const data = await loadEvaluation(meta.raceId);
      if (data == null) return;
      const peak = computeRaceMaxEvFromEvaluation(data);
      if (peak == null) return;
      items.push({
        raceId: meta.raceId,
        date: meta.date,
        venue: meta.venue,
        raceNumber: meta.raceNumber,
        raceName: meta.raceName ?? data.raceInfo.raceName,
        ...peak,
      });
    }),
  );

  items.sort((a, b) => b.maxEv - a.maxEv || a.date.localeCompare(b.date) || a.raceNumber - b.raceNumber);
  return items.slice(0, topN);
}
