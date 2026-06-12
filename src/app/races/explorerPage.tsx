import { useEffect, useMemo, useState } from "react";
import { RaceListCard } from "../../components/race/RaceListCard";
import type { RaceBettingOutcome } from "../../domain/betting/computeRaceBettingOutcome";
import { computeRaceBettingOutcomeById } from "../../lib/race-data/computeRaceBettingOutcomeById";
import { getRaceIndex, type RaceGradeLabel, type RaceIndexItem } from "../../lib/race-data";

type SurfaceFilter = "all" | "芝" | "ダート";
type StatusFilter = "all" | "pending" | "resolved";

function extractDates(rows: RaceIndexItem[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const row of rows) {
    if (seen.has(row.date)) continue;
    seen.add(row.date);
    out.push(row.date);
  }
  return out;
}

function groupByVenue(rows: RaceIndexItem[]): { venue: string; races: RaceIndexItem[] }[] {
  const map = new Map<string, RaceIndexItem[]>();
  for (const row of rows) {
    const list = map.get(row.venue) ?? [];
    list.push(row);
    map.set(row.venue, list);
  }
  return [...map.entries()].map(([venue, races]) => ({
    venue,
    races: races.sort((a, b) => a.raceNumber - b.raceNumber),
  }));
}

function formatDateTab(dateStr: string): string {
  const d = new Date(dateStr + "T00:00:00");
  const m = d.getMonth() + 1;
  const day = d.getDate();
  const dow = ["日", "月", "火", "水", "木", "金", "土"][d.getDay()];
  return `${m}/${day}(${dow})`;
}

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

function surfaceBadgeClass(surface: string): string {
  return surface === "芝" ? "race-badge race-badge--turf" : "race-badge race-badge--dirt";
}

function surfaceShort(surface: string): string {
  return surface === "芝" ? "芝" : "ダ";
}

function raceIcon(surface: "芝" | "ダート"): string {
  return surface === "芝" ? "🌿" : "🏇";
}

export function RacesExplorerPage() {
  const [rows, setRows] = useState<RaceIndexItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [activeDate, setActiveDate] = useState<string | null>(null);
  const [activeVenue, setActiveVenue] = useState<string | null>(null);
  const [surfaceFilter, setSurfaceFilter] = useState<SurfaceFilter>("all");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [searchText, setSearchText] = useState("");
  const [outcomeMap, setOutcomeMap] = useState<Record<string, RaceBettingOutcome>>({});

  useEffect(() => {
    let live = true;
    void (async () => {
      setError(null);
      try {
        const list = await getRaceIndex();
        if (!live) return;
        setRows(list);
        if (list.length > 0) setActiveDate(list[0]?.date ?? null);
      } catch {
        if (live) {
          setError("レース一覧の読み込みに失敗しました。");
          setRows(null);
        }
      }
    })();
    return () => {
      live = false;
    };
  }, []);

  const dates = useMemo(() => extractDates(rows ?? []), [rows]);
  const venueGroups = useMemo(() => {
    if (rows == null || activeDate == null) return [];
    return groupByVenue(rows.filter((r) => r.date === activeDate));
  }, [rows, activeDate]);
  const venues = useMemo(() => venueGroups.map((g) => g.venue), [venueGroups]);
  const effectiveVenue = useMemo(() => {
    if (activeVenue != null && venues.includes(activeVenue)) return activeVenue;
    return venues[0] ?? null;
  }, [activeVenue, venues]);
  const venueRaces = useMemo(
    () => venueGroups.find((v) => v.venue === effectiveVenue)?.races ?? [],
    [effectiveVenue, venueGroups],
  );

  useEffect(() => {
    if (venueRaces.length === 0) return;
    let live = true;
    void (async () => {
      const entries = await Promise.all(
        venueRaces.map(async (race): Promise<[string, RaceBettingOutcome] | null> => {
          try {
            const outcome = await computeRaceBettingOutcomeById(race.raceId);
            return outcome != null ? [race.raceId, outcome] : null;
          } catch {
            return null;
          }
        }),
      );
      if (!live) return;
      const next = Object.fromEntries(entries.filter((e): e is [string, RaceBettingOutcome] => e != null));
      setOutcomeMap((prev) => ({ ...prev, ...next }));
    })();
    return () => {
      live = false;
    };
  }, [venueRaces]);

  const filteredRaces = useMemo(() => {
    const keyword = searchText.trim().toLowerCase();
    return venueRaces.filter((race) => {
      if (surfaceFilter !== "all" && race.surface !== surfaceFilter) return false;
      const resolved = outcomeMap[race.raceId]?.status === "resolved";
      if (statusFilter === "pending" && resolved) return false;
      if (statusFilter === "resolved" && !resolved) return false;
      if (keyword.length > 0) {
        const target = `${race.raceNumber} ${race.raceName ?? ""}`.toLowerCase();
        if (!target.includes(keyword)) return false;
      }
      return true;
    });
  }, [outcomeMap, searchText, statusFilter, surfaceFilter, venueRaces]);

  if (error != null) {
    return (
      <div className="rx-page" role="alert">
        <p className="rx-error">{error}</p>
      </div>
    );
  }

  if (rows == null) {
    return (
      <div className="rx-page" aria-busy="true">
        <p className="rx-loading">レース一覧を読み込み中...</p>
      </div>
    );
  }

  return (
    <div className="rx-page">
      <header className="rx-head">
        <h1>レース探索</h1>
        <p>日付・競馬場・条件で絞り込み、見たいレースへ最短で移動します。</p>
      </header>

      <section className="rx-tabs" role="tablist" aria-label="開催日">
        {dates.map((date) => (
          <button
            key={date}
            type="button"
            role="tab"
            aria-selected={date === activeDate}
            className={`rx-tab${date === activeDate ? " is-active" : ""}`}
            onClick={() => {
              setActiveDate(date);
              setActiveVenue(null);
            }}
          >
            {formatDateTab(date)}
          </button>
        ))}
      </section>

      {venues.length > 0 ? (
        <section className="rx-tabs rx-tabs--venue" role="tablist" aria-label="競馬場">
          {venues.map((venue) => (
            <button
              key={venue}
              type="button"
              role="tab"
              aria-selected={venue === effectiveVenue}
              className={`rx-tab${venue === effectiveVenue ? " is-active" : ""}`}
              onClick={() => setActiveVenue(venue)}
            >
              {venue}
            </button>
          ))}
        </section>
      ) : null}

      <section className="rx-filters" aria-label="探索フィルタ">
        <label>
          馬場
          <select value={surfaceFilter} onChange={(e) => setSurfaceFilter(e.target.value as SurfaceFilter)}>
            <option value="all">芝・ダート</option>
            <option value="芝">芝のみ</option>
            <option value="ダート">ダートのみ</option>
          </select>
        </label>
        <label>
          結果状態
          <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as StatusFilter)}>
            <option value="all">すべて</option>
            <option value="pending">未確定のみ</option>
            <option value="resolved">確定のみ</option>
          </select>
        </label>
        <label>
          レース名検索
          <input
            value={searchText}
            onChange={(e) => setSearchText(e.target.value)}
            placeholder="例: 皐月賞"
          />
        </label>
      </section>

      <p className="rx-count">表示 {filteredRaces.length} / {venueRaces.length} レース</p>

      <ul className="rx-list" aria-label="レースカード一覧">
        {filteredRaces.length === 0 ? (
          <li className="rx-empty">条件に一致するレースがありません。</li>
        ) : (
          filteredRaces.map((item) => (
            <li key={item.raceId}>
              <RaceListCard
                item={item}
                outcome={outcomeMap[item.raceId]}
                gradeBadge={raceGradeBadgeFromIndex(item.raceGrade) ?? raceGradeFromName(item.raceName)}
                surfaceBadgeClass={surfaceBadgeClass}
                surfaceShort={surfaceShort}
                raceIcon={raceIcon}
              />
            </li>
          ))
        )}
      </ul>
    </div>
  );
}
