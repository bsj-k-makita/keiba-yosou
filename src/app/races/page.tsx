import { useEffect, useMemo, useState } from "react";
import {
  getHorsesFromRaceData,
  getRaceEvaluationById,
  getRaceIndex,
  ensureRaceResultFetched,
  type RaceIndexItem,
  type RaceGradeLabel,
} from "../../lib/race-data";
import { evaluateRace } from "../../domain/race-evaluation";
import { ensureFrontendDisplayMarks } from "../../lib/race-display/ensureFrontendDisplayMarks";
import {
  applyAiMarksByEffectiveEv,
  raceHasFullAiBackfill,
} from "../../lib/pipeline/aiMarkAssignment";
import { clearStaleMarkSnapshotsFromLocalStorage } from "../../lib/race-data/markSnapshotStorage";
import { RaceListCard } from "../../components/race/RaceListCard";
import type { RaceBettingOutcome } from "../../domain/betting/computeRaceBettingOutcome";
import { computeRaceBettingOutcomeById } from "../../lib/race-data/computeRaceBettingOutcomeById";
import { isDateInWeek } from "../../domain/race-evaluation/weeklyTopEvRaces";
import { RaceDateTabs } from "../../components/race/RaceDateTabs";

function surfaceBadgeClass(surface: string): string {
  return surface === "芝" ? "race-badge race-badge--turf" : "race-badge race-badge--dirt";
}

function surfaceShort(surface: string): string {
  return surface === "芝" ? "芝" : "ダ";
}

/** index の raceGrade（インポート由来）をバッジに */
function raceGradeBadgeFromIndex(
  raceGrade: RaceGradeLabel | undefined,
): { label: string; variant: string } | null {
  const map: Record<RaceGradeLabel, { label: string; variant: string }> = {
    G1: { label: "G1", variant: "g1" },
    G2: { label: "G2", variant: "g2" },
    G3: { label: "G3", variant: "g3" },
    L: { label: "L", variant: "listed" },
    S: { label: "S", variant: "stakes" },
  };
  if (raceGrade != null && map[raceGrade]) return map[raceGrade];
  return null;
}

/** レース名からグレード（G1–G3）を推定。表記ゆれ（GⅠ・全角括弧・JPN）に対応（フォールバック） */
function raceGradeFromName(
  raceName?: string,
): { label: string; variant: "g1" | "g2" | "g3" } | null {
  if (!raceName?.trim()) return null;
  const s = raceName.normalize("NFKC");
  const g3 =
    /\bG3\b|GⅢ|（\s*G3\s*）|\(\s*G3\s*\)|JPN\s*3|ＪＰＮ\s*３|（GⅢ）|\(GⅢ\)/i.test(s) ||
    /[（(]G3[）)]/.test(raceName);
  if (g3) return { label: "G3", variant: "g3" };
  const g2 =
    /\bG2\b|GⅡ|（\s*G2\s*）|\(\s*G2\s*\)|JPN\s*2|ＪＰＮ\s*２|（GⅡ）|\(GⅡ\)/i.test(s) ||
    /[（(]G2[）)]/.test(raceName);
  if (g2) return { label: "G2", variant: "g2" };
  const g1 =
    /\bG1\b|GⅠ|（\s*G1\s*）|\(\s*G1\s*\)|（\s*GI\s*）|\(\s*GI\s*\)|JPN\s*1|ＪＰＮ\s*１|（GⅠ）|\(GⅠ\)|（GI）|\(GI\)/i.test(s) ||
    /[（(]G1[）)]|[（(]GI[）)]/i.test(raceName);
  if (g1) return { label: "G1", variant: "g1" };
  return null;
}

type RaceCardPreview = {
  honmeiHorseName?: string;
};

type SurfaceFilter = "all" | "芝" | "ダート";

const VENUE_DISPLAY_ORDER = [
  "札幌", "函館", "福島", "新潟", "中山", "東京", "中京", "京都", "阪神", "小倉",
  "笠松", "名古屋", "園田", "姫路", "高知", "佐賀",
] as const;

function sortVenues(venues: readonly string[]): string[] {
  return [...venues].sort((a, b) => {
    const ia = VENUE_DISPLAY_ORDER.indexOf(a as (typeof VENUE_DISPLAY_ORDER)[number]);
    const ib = VENUE_DISPLAY_ORDER.indexOf(b as (typeof VENUE_DISPLAY_ORDER)[number]);
    if (ia === -1 && ib === -1) return a.localeCompare(b, "ja");
    if (ia === -1) return 1;
    if (ib === -1) return -1;
    return ia - ib;
  });
}

async function computeOutcomeMapForRaceIds(
  raceIds: readonly string[],
): Promise<Record<string, RaceBettingOutcome>> {
  const entries = await Promise.all(
    raceIds.map(async (raceId): Promise<[string, RaceBettingOutcome] | null> => {
      try {
        const outcome = await computeRaceBettingOutcomeById(raceId);
        return outcome != null ? [raceId, outcome] : null;
      } catch {
        return null;
      }
    }),
  );
  return Object.fromEntries(entries.filter((v): v is [string, RaceBettingOutcome] => v != null));
}

/** index.json の日付一覧（降順） */
function extractDates(rows: RaceIndexItem[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const r of rows) {
    if (!seen.has(r.date)) { seen.add(r.date); out.push(r.date); }
  }
  return out;
}

/** 競馬場ごとにグループ化 */
function groupByVenue(rows: RaceIndexItem[]): { venue: string; races: RaceIndexItem[] }[] {
  const map = new Map<string, RaceIndexItem[]>();
  for (const r of rows) {
    const list = map.get(r.venue) ?? [];
    list.push(r);
    map.set(r.venue, list);
  }
  return Array.from(map.entries()).map(([venue, races]) => ({
    venue,
    races: races.sort((a, b) => a.raceNumber - b.raceNumber),
  }));
}

/** ローカル日付 YYYY-MM-DD（当週TOP5の「今日」基準） */
function formatLocalTodayIso(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** "2026-04-26" → "4/26(土)" */
function formatDateTab(dateStr: string): string {
  const d = new Date(dateStr + "T00:00:00");
  const m = d.getMonth() + 1;
  const day = d.getDate();
  const dow = ["日", "月", "火", "水", "木", "金", "土"][d.getDay()];
  return `${m}/${day}(${dow})`;
}

export function RacesListPage() {
  const [rows, setRows] = useState<RaceIndexItem[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [activeDate, setActiveDate] = useState<string | null>(null);
  const [activeVenue, setActiveVenue] = useState<string | null>(null);
  const [previewMap, setPreviewMap] = useState<Record<string, RaceCardPreview>>({});
  const [outcomeMap, setOutcomeMap] = useState<Record<string, RaceBettingOutcome>>({});
  const [bulkLoading, setBulkLoading] = useState(false);
  const [bulkMessage, setBulkMessage] = useState<string | null>(null);
  const [surfaceFilter, setSurfaceFilter] = useState<SurfaceFilter>("all");

  useEffect(() => {
    clearStaleMarkSnapshotsFromLocalStorage();
  }, []);

  useEffect(() => {
    let live = true;
    void (async () => {
      setErr(null);
      try {
        const list = await getRaceIndex();
        if (!live) return;
        setRows(list);
      } catch {
        if (live) { setErr("一覧の読み込みに失敗しました。"); setRows(null); }
      }
    })();
    return () => { live = false; };
  }, []);

  const dates = useMemo(() => (rows ? extractDates(rows) : []), [rows]);

  const todayIso = useMemo(() => formatLocalTodayIso(), []);

  useEffect(() => {
    if (rows == null || rows.length === 0) return;
    const allDates = extractDates(rows);
    if (activeDate != null && allDates.includes(activeDate)) return;
    const weekDates = allDates.filter((d) => isDateInWeek(d, todayIso));
    const next =
      (weekDates.includes(todayIso) ? todayIso : undefined) ??
      weekDates.find((d) => d >= todayIso) ??
      weekDates[0] ??
      allDates[0] ??
      null;
    if (next != null) setActiveDate(next);
  }, [rows, activeDate, todayIso]);

  const venueGroups = useMemo(() => {
    if (!rows || !activeDate) return [];
    return groupByVenue(rows.filter((r) => r.date === activeDate));
  }, [rows, activeDate]);

  /** 選択中日の全競馬場レース（的中率の一括結果取得用） */
  const racesOnActiveDate = useMemo(() => {
    if (!rows || !activeDate) return [];
    return rows.filter((r) => r.date === activeDate);
  }, [rows, activeDate]);

  /** 選択開催日のレース結果をバックグラウンドで自動取得 */
  useEffect(() => {
    if (racesOnActiveDate.length === 0) return;
    let cancelled = false;
    void (async () => {
      for (const r of racesOnActiveDate) {
        if (cancelled) return;
        await ensureRaceResultFetched(r.raceId);
        await new Promise((resolve) => setTimeout(resolve, 300));
      }
      if (cancelled || rows == null) return;
      const refreshedOutcomeMap = await computeOutcomeMapForRaceIds(
        racesOnActiveDate.map((r) => r.raceId),
      );
      if (!cancelled && Object.keys(refreshedOutcomeMap).length > 0) {
        setOutcomeMap((prev) => ({ ...prev, ...refreshedOutcomeMap }));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [activeDate, racesOnActiveDate, rows]);

  const venues = useMemo(
    () => sortVenues(venueGroups.map((g) => g.venue)),
    [venueGroups],
  );
  const effectiveVenue = activeVenue != null && venues.includes(activeVenue)
    ? activeVenue
    : (venues[0] ?? null);

  function handleDateChange(d: string) {
    setActiveDate(d);
    setActiveVenue(null);
  }

  const activeRaces = venueGroups.find((g) => g.venue === effectiveVenue)?.races ?? [];
  const orderedActiveRaces = useMemo(() => {
    return activeRaces
      .filter((race) => surfaceFilter === "all" || race.surface === surfaceFilter)
      .sort((a, b) => a.raceNumber - b.raceNumber);
  }, [activeRaces, surfaceFilter]);

  async function handleBulkFetchResults() {
    if (racesOnActiveDate.length === 0 || bulkLoading) return;
    setBulkLoading(true);
    setBulkMessage(null);
    const settled = await Promise.allSettled(
      racesOnActiveDate.map(async (r) => {
        const data = await ensureRaceResultFetched(r.raceId);
        return data != null;
      }),
    );
    const success = settled.filter((s) => s.status === "fulfilled" && s.value).length;
    const notFound = settled.filter((s) => s.status === "fulfilled" && !s.value).length;
    const failed = settled.filter((s) => s.status === "rejected").length;
    setBulkMessage(
      `全日程・全競馬場 ${racesOnActiveDate.length}件: 成功${success} / 未掲載${notFound} / 失敗${failed}`,
    );
    if (rows != null && rows.length > 0) {
      const refreshedOutcomeMap = await computeOutcomeMapForRaceIds(
        racesOnActiveDate.map((r) => r.raceId),
      );
      if (Object.keys(refreshedOutcomeMap).length > 0) {
        setOutcomeMap((prev) => ({ ...prev, ...refreshedOutcomeMap }));
      }
    }
    setBulkLoading(false);
  }

  useEffect(() => {
    if (activeRaces.length === 0) return;
    const missing = activeRaces
      .map((r) => r.raceId)
      .filter((raceId) => previewMap[raceId] == null);
    if (missing.length === 0) return;

    let live = true;
    void (async () => {
      const entries = await Promise.all(
        missing.map(async (raceId): Promise<[string, RaceCardPreview] | null> => {
          try {
            const race = await getRaceEvaluationById(raceId);
            if (race == null) return null;
            const horses = getHorsesFromRaceData(race);
            const evaluated = evaluateRace(horses, race.condition);
            const useAiMarks = raceHasFullAiBackfill(horses);
            const results = useAiMarks
              ? applyAiMarksByEffectiveEv(evaluated, horses)
              : ensureFrontendDisplayMarks(evaluated, horses, race.condition);
            const honmei = results.find((r) => r.mark === "◎");
            if (honmei?.horseName == null) return null;
            return [raceId, { honmeiHorseName: honmei.horseName }];
          } catch {
            return null;
          }
        }),
      );
      if (!live) return;
      const nextEntries = entries.filter((v): v is [string, RaceCardPreview] => v != null);
      if (nextEntries.length === 0) return;
      setPreviewMap((prev) => ({ ...prev, ...Object.fromEntries(nextEntries) }));
    })();

    return () => {
      live = false;
    };
  }, [activeRaces, previewMap]);

  useEffect(() => {
    if (activeRaces.length === 0) return;

    let live = true;
    void (async () => {
      const entries = await Promise.all(
        activeRaces.map(async (race): Promise<[string, RaceBettingOutcome] | null> => {
          try {
            const o = await computeRaceBettingOutcomeById(race.raceId);
            return o != null ? [race.raceId, o] : null;
          } catch {
            return null;
          }
        }),
      );
      if (!live) return;
      const next = entries.filter((v): v is [string, RaceBettingOutcome] => v != null);
      if (next.length === 0) return;
      setOutcomeMap((prev) => ({ ...prev, ...Object.fromEntries(next) }));
    })();

    return () => {
      live = false;
    };
  }, [activeRaces]);

  if (err != null) {
    return (
      <div className="rl-page rl-page--simple rl-page--loading" role="alert">
        <p className="rl-error">{err}</p>
      </div>
    );
  }

  if (rows == null) {
    return (
      <div className="rl-page rl-page--simple rl-page--loading" aria-busy="true">
        <p className="rl-loading-text">読み込み中…</p>
      </div>
    );
  }

  return (
    <div className="rl-page rl-page--simple rl-page--full-width">
      <header className="rl-simple-head">
        <div>
          <h1>レース一覧</h1>
          {activeDate ? (
            <p className="rl-simple-head__sub">
              {formatDateTab(activeDate)}
              {effectiveVenue ? ` · ${effectiveVenue}` : ""}
              {" · "}
              {orderedActiveRaces.length}/{activeRaces.length}R
            </p>
          ) : null}
        </div>
        <button
          type="button"
          className="rl-simple-btn"
          onClick={() => void handleBulkFetchResults()}
          disabled={bulkLoading || racesOnActiveDate.length === 0}
        >
          {bulkLoading ? "取得中…" : "結果取得"}
        </button>
      </header>
      {bulkMessage ? <p className="rl-simple-message">{bulkMessage}</p> : null}

      <RaceDateTabs
        dates={dates}
        activeDate={activeDate}
        todayIso={todayIso}
        formatDateTab={formatDateTab}
        onDateChange={handleDateChange}
      />

      {venues.length > 0 ? (
        <div className="rl-simple-tabs rl-simple-tabs--venue" role="tablist" aria-label="競馬場">
          {venues.map((v) => (
            <button
              key={v}
              type="button"
              role="tab"
              aria-selected={v === effectiveVenue}
              className={`rl-simple-tab${v === effectiveVenue ? " is-active" : ""}`}
              onClick={() => setActiveVenue(v)}
            >
              {v}
            </button>
          ))}
        </div>
      ) : null}

      <div className="rl-simple-filters">
        <label>
          馬場
          <select value={surfaceFilter} onChange={(e) => setSurfaceFilter(e.target.value as SurfaceFilter)}>
            <option value="all">すべて</option>
            <option value="芝">芝</option>
            <option value="ダート">ダート</option>
          </select>
        </label>
      </div>

      <div className="rl-venues">
        {activeRaces.length === 0 ? (
          <p className="rl-empty">この日の開催はありません。</p>
        ) : orderedActiveRaces.length === 0 ? (
          <p className="rl-empty">条件に一致するレースがありません。</p>
        ) : (
          <ul className="rl-race-list rl-race-list--grid-2x6" aria-label={`${effectiveVenue ?? ""}のレース`}>
            {orderedActiveRaces.map((item) => {
              const dynamicPreview = previewMap[item.raceId];
              const gradeBadge =
                raceGradeBadgeFromIndex(item.raceGrade) ?? raceGradeFromName(item.raceName);
              const outcome = outcomeMap[item.raceId];

              return (
                <li key={item.raceId}>
                  <RaceListCard
                    item={item}
                    outcome={outcome}
                    gradeBadge={gradeBadge}
                    honmeiHorseName={dynamicPreview?.honmeiHorseName}
                    surfaceBadgeClass={surfaceBadgeClass}
                    surfaceShort={surfaceShort}
                  />
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
