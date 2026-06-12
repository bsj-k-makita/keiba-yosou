import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  getHorsesFromRaceData,
  getRaceEvaluationById,
  getRaceIndex,
  getRaceResultById,
  ensureRaceResultFetched,
  type RaceIndexItem,
  type RaceGradeLabel,
} from "../../lib/race-data";
import { buildRacePreviewDataFromRace, evaluateRace, type RacePreviewBadgeType } from "../../domain/race-evaluation";
import { analyzeMarkHits } from "../../domain/race-evaluation/markHitAnalysis";
import { ensureFrontendDisplayMarks } from "../../lib/race-display/ensureFrontendDisplayMarks";
import {
  applyAiMarksByEffectiveEv,
  raceHasFullAiBackfill,
} from "../../lib/pipeline/aiMarkAssignment";
import { clearStaleMarkSnapshotsFromLocalStorage } from "../../lib/race-data/markSnapshotStorage";
import { RaceListCard } from "../../components/race/RaceListCard";
import {
  mergeListBettingRecoveryStats,
  type RaceBettingOutcome,
} from "../../domain/betting/computeRaceBettingOutcome";
import { computeRaceBettingOutcomeById } from "../../lib/race-data/computeRaceBettingOutcomeById";
import { aggregateVenueDistanceStats } from "../../domain/betting/aggregateVenueDistanceStats";
import type { RaceDetailLog } from "../../domain/betting/types";
import {
  fetchWeeklyTopEvRaces,
  formatUpcomingWeekScopeLabel,
  formatWeekScopeLabelFromRows,
  isDateInWeek,
  type WeeklyTopEvRaceItem,
} from "../../domain/race-evaluation/weeklyTopEvRaces";
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

/** 一覧カードの強調枠（インポート済みグレード or 名前ヒューリスティック） */
function isFeaturedRow(item: RaceIndexItem): boolean {
  if (item.raceGrade != null) return true;
  return isFeaturedRaceByName(item.raceName);
}

function cardToneForFeatured(outcome: RaceBettingOutcome | undefined): boolean {
  if (outcome?.status === "resolved") return false;
  return true;
}

function isFeaturedRaceByName(raceName?: string): boolean {
  if (!raceName) return false;
  if (raceGradeFromName(raceName) != null) return true;
  const name = raceName.toUpperCase();
  return name.includes("重賞");
}

function raceIcon(surface: "芝" | "ダート"): string {
  return surface === "芝" ? "🌿" : "🏇";
}

function confidenceBadge(raceName?: string): { label: string; tone: "high" | "mid" } | null {
  const n = (raceName ?? "").toUpperCase();
  if (n.includes("G1") || n.includes("Ｇ１") || n.includes("GI") || n.includes("JPN1")) {
    return { label: "勝負レース!", tone: "high" };
  }
  if (
    n.includes("G2") || n.includes("Ｇ２") || n.includes("JPN2") ||
    n.includes("G3") || n.includes("Ｇ３") || n.includes("JPN3") ||
    n.includes("重賞")
  ) {
    return { label: "AI注目", tone: "mid" };
  }
  return null;
}

type RaceCardPreview = {
  badgeLabel: string;
  badgeTone: "high" | "mid" | "warning" | "success";
  previewText: string;
  honmeiHorseName?: string;
};

type MarkSummary = {
  mark: "◎" | "○" | "▲";
  hit: number;
  total: number;
};

type ListHitStats = {
  sampleSize: number;
  marks: MarkSummary[];
};

type ListBettingStats = {
  sampleSize: number;
  recoveryRate: number;
  hitRaces: number;
  totalInvested: number;
  totalPayout: number;
};

type FavoriteConditionMatch = {
  venue: string;
  distance: number;
  surface: "芝" | "ダート";
  recoveryRate: number;
  raceNumbers: number[];
};

type ResultFilter = "all" | "pending" | "resolved";
type SurfaceFilter = "all" | "芝" | "ダート";
type RaceSortMode = "mission" | "number" | "ev";

function previewBadgeTone(type: RacePreviewBadgeType): RaceCardPreview["badgeTone"] {
  if (type === "warning") return "warning";
  if (type === "success") return "success";
  return "mid";
}

async function computeListHitStats(rows: RaceIndexItem[], limit = 30): Promise<ListHitStats> {
  const marks: MarkSummary[] = [
    { mark: "◎", hit: 0, total: 0 },
    { mark: "○", hit: 0, total: 0 },
    { mark: "▲", hit: 0, total: 0 },
  ];
  let sampleSize = 0;

  for (const row of rows) {
    const result = await getRaceResultById(row.raceId);
    if (result == null || result.places.length < 3) continue;
    const evalData = await getRaceEvaluationById(row.raceId);
    if (evalData == null) continue;
    const horses = getHorsesFromRaceData(evalData);
    const scored = ensureFrontendDisplayMarks(
      evaluateRace(horses, evalData.condition),
      horses,
      evalData.condition,
    );
    const { winners, rows } = analyzeMarkHits(result.places, scored, horses);
    if (winners.size === 0) continue;

    for (const m of marks) {
      const row = rows.find((r) => r.mark === m.mark);
      if (!row) continue;
      m.total += 1;
      if (row.hit) m.hit += 1;
    }

    sampleSize += 1;
    if (sampleSize >= limit) break;
  }

  return { sampleSize, marks };
}

async function computeListBettingStats(rows: RaceIndexItem[], limit = 30): Promise<ListBettingStats> {
  const outcomes: RaceBettingOutcome[] = [];
  for (const row of rows) {
    const o = await computeRaceBettingOutcomeById(row.raceId);
    if (o?.status !== "resolved") continue;
    outcomes.push(o);
    if (outcomes.length >= limit) break;
  }
  const merged = mergeListBettingRecoveryStats(outcomes);
  return {
    sampleSize: merged.sampleSize,
    recoveryRate: merged.recoveryRate,
    hitRaces: merged.hitRaces,
    totalInvested: merged.totalInvested,
    totalPayout: merged.totalPayout,
  };
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

/** ◎〜▲ の試行をまとめた全体複勝圏（3着以内）的中率 */
function formatPooledHitRate(marks: MarkSummary[]): string {
  let hit = 0;
  let total = 0;
  for (const m of marks) {
    hit += m.hit;
    total += m.total;
  }
  if (total === 0) return "--";
  return `${((hit / total) * 100).toFixed(0)}%`;
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

function buildSyntheticRaceDetailLog(item: RaceIndexItem, outcome: RaceBettingOutcome): RaceDetailLog {
  const emptyTicket = { invested: 0, payout: 0, isHit: false };
  return {
    raceId: item.raceId,
    raceName: item.raceName ?? `${item.raceNumber}R`,
    classTier: "CONDITIONAL_LOWER",
    classTierLabel: "集計",
    venue: item.venue,
    raceNumber: item.raceNumber,
    date: item.date,
    actualResults: [],
    finishLabel: "",
    aiMarks: {},
    tickets: {
      WIN: { ...emptyTicket },
      MAIN_LINE: { ...emptyTicket },
      WIDE: { ...emptyTicket },
      TRIFECTA_FORM: { ...emptyTicket },
    },
    totalInvested: outcome.totalInvested,
    totalPayout: outcome.totalPayout,
    dominantComment: "",
    isAnchorHit: outcome.isHit,
    isSecondRowDead: outcome.isSecondRowDead,
    diagnosisLabel: "",
  };
}

export function RacesListPage() {
  const [rows, setRows] = useState<RaceIndexItem[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [activeDate, setActiveDate] = useState<string | null>(null);
  const [activeVenue, setActiveVenue] = useState<string | null>(null);
  const [previewMap, setPreviewMap] = useState<Record<string, RaceCardPreview>>({});
  const [outcomeMap, setOutcomeMap] = useState<Record<string, RaceBettingOutcome>>({});
  const [hitStats, setHitStats] = useState<ListHitStats | null>(null);
  const [bettingStats, setBettingStats] = useState<ListBettingStats | null>(null);
  const [hitStatsLoading, setHitStatsLoading] = useState(true);
  const [bulkLoading, setBulkLoading] = useState(false);
  const [bulkMessage, setBulkMessage] = useState<string | null>(null);
  const [weeklyTopEv, setWeeklyTopEv] = useState<WeeklyTopEvRaceItem[] | null>(null);
  const [weeklyTopEvLoading, setWeeklyTopEvLoading] = useState(false);
  const [historicalOutcomeMap, setHistoricalOutcomeMap] = useState<Record<string, RaceBettingOutcome>>({});
  const [resultFilter, setResultFilter] = useState<ResultFilter>("all");
  const [surfaceFilter, setSurfaceFilter] = useState<SurfaceFilter>("all");
  const [sortMode, setSortMode] = useState<RaceSortMode>("mission");
  const [focusMissionOnly, setFocusMissionOnly] = useState(false);

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

  useEffect(() => {
    if (rows == null || rows.length === 0) return;
    let live = true;
    setHitStatsLoading(true);
    void Promise.all([computeListHitStats(rows, 30), computeListBettingStats(rows, 30)]).then(
      ([markStats, betStats]) => {
        if (!live) return;
        setHitStats(markStats);
        setBettingStats(betStats);
        setHitStatsLoading(false);
      },
    );
    return () => {
      live = false;
    };
  }, [rows]);

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
  const weekRangeLabel = useMemo(() => {
    if (weeklyTopEv != null && weeklyTopEv.length > 0) {
      return formatWeekScopeLabelFromRows(weeklyTopEv);
    }
    if (rows == null) return "";
    return formatUpcomingWeekScopeLabel(rows, todayIso);
  }, [weeklyTopEv, rows, todayIso]);

  useEffect(() => {
    if (rows == null) return;
    let live = true;
    setWeeklyTopEvLoading(true);
    void fetchWeeklyTopEvRaces(rows, todayIso, getRaceEvaluationById, 5, getRaceResultById).then((top) => {
      if (!live) return;
      setWeeklyTopEv(top);
      setWeeklyTopEvLoading(false);
    });
    return () => {
      live = false;
    };
  }, [rows, todayIso]);

  useEffect(() => {
    if (rows == null || rows.length === 0) return;
    let live = true;
    const historyRows = rows.slice(0, 180);
    void computeOutcomeMapForRaceIds(historyRows.map((r) => r.raceId)).then((map) => {
      if (!live) return;
      setHistoricalOutcomeMap(map);
    });
    return () => {
      live = false;
    };
  }, [rows]);

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
      const [markStats, betStats, refreshedOutcomeMap] = await Promise.all([
        computeListHitStats(rows, 30),
        computeListBettingStats(rows, 30),
        computeOutcomeMapForRaceIds(racesOnActiveDate.map((r) => r.raceId)),
      ]);
      if (!cancelled) {
        setHitStats(markStats);
        setBettingStats(betStats);
        if (Object.keys(refreshedOutcomeMap).length > 0) {
          setOutcomeMap((prev) => ({ ...prev, ...refreshedOutcomeMap }));
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [activeDate, racesOnActiveDate, rows]);

  const venues = useMemo(() => venueGroups.map((g) => g.venue), [venueGroups]);
  const effectiveVenue = activeVenue != null && venues.includes(activeVenue)
    ? activeVenue
    : (venues[0] ?? null);

  function handleDateChange(d: string) {
    setActiveDate(d);
    setActiveVenue(null);
    setFocusMissionOnly(false);
  }

  const activeRaces = venueGroups.find((g) => g.venue === effectiveVenue)?.races ?? [];
  const priorityScoreByRaceId = useMemo(() => {
    const scoreByRaceId = new Map<string, number>();
    for (const race of activeRaces) {
      const preview = previewMap[race.raceId];
      const outcome = outcomeMap[race.raceId];
      const previewScore =
        preview == null
          ? 0
          : preview.badgeTone === "high"
            ? 5
            : preview.badgeTone === "warning"
              ? 4
              : preview.badgeTone === "success"
                ? 3
                : 2;
      const unresolvedScore = outcome?.status === "resolved" ? 0 : 2;
      const gradeScore = race.raceGrade != null ? 2 : raceGradeFromName(race.raceName) != null ? 1 : 0;
      scoreByRaceId.set(race.raceId, previewScore + unresolvedScore + gradeScore);
    }
    return scoreByRaceId;
  }, [activeRaces, outcomeMap, previewMap]);
  const missionRaces = useMemo(() => {
    return [...activeRaces]
      .sort((a, b) => {
        const sa = priorityScoreByRaceId.get(a.raceId) ?? 0;
        const sb = priorityScoreByRaceId.get(b.raceId) ?? 0;
        if (sa !== sb) return sb - sa;
        return a.raceNumber - b.raceNumber;
      })
      .slice(0, 3);
  }, [activeRaces, priorityScoreByRaceId]);
  const missionRaceIdSet = useMemo(
    () => new Set(missionRaces.map((race) => race.raceId)),
    [missionRaces],
  );
  const filteredActiveRaces = useMemo(() => {
    return activeRaces.filter((race) => {
      if (surfaceFilter !== "all" && race.surface !== surfaceFilter) return false;
      const outcome = outcomeMap[race.raceId];
      const resolved = outcome?.status === "resolved";
      if (resultFilter === "pending" && resolved) return false;
      if (resultFilter === "resolved" && !resolved) return false;
      if (focusMissionOnly && missionRaceIdSet.size > 0 && !missionRaceIdSet.has(race.raceId)) return false;
      return true;
    });
  }, [activeRaces, focusMissionOnly, missionRaceIdSet, outcomeMap, resultFilter, surfaceFilter]);
  const orderedActiveRaces = useMemo(() => {
    return [...filteredActiveRaces].sort((a, b) => {
      if (sortMode === "number") return a.raceNumber - b.raceNumber;
      if (sortMode === "ev") {
        const sa = priorityScoreByRaceId.get(a.raceId) ?? 0;
        const sb = priorityScoreByRaceId.get(b.raceId) ?? 0;
        if (sa !== sb) return sb - sa;
        return a.raceNumber - b.raceNumber;
      }
      const aMission = missionRaceIdSet.has(a.raceId) ? 1 : 0;
      const bMission = missionRaceIdSet.has(b.raceId) ? 1 : 0;
      if (aMission !== bMission) return bMission - aMission;
      return a.raceNumber - b.raceNumber;
    });
  }, [filteredActiveRaces, missionRaceIdSet, priorityScoreByRaceId, sortMode]);
  const pendingRaceCount = useMemo(
    () => activeRaces.filter((race) => outcomeMap[race.raceId]?.status !== "resolved").length,
    [activeRaces, outcomeMap],
  );
  const favoriteConditionMatch = useMemo<FavoriteConditionMatch | null>(() => {
    if (rows == null || activeDate == null || activeRaces.length === 0) return null;
    const detailLogs: RaceDetailLog[] = [];
    for (const row of rows) {
      if (row.date >= activeDate) continue;
      const outcome = historicalOutcomeMap[row.raceId];
      if (outcome == null || outcome.status !== "resolved" || outcome.totalInvested <= 0) continue;
      detailLogs.push(buildSyntheticRaceDetailLog(row, outcome));
    }
    if (detailLogs.length === 0) return null;
    const aggregation = aggregateVenueDistanceStats(detailLogs, rows);
    const favoriteConditions = aggregation.byVenueDistanceSurface
      .filter((bucket) =>
        bucket.betRaces >= 3 &&
        bucket.recoveryRate > 100 &&
        bucket.distance != null &&
        (bucket.surface === "芝" || bucket.surface === "ダート"),
      )
      .sort((a, b) => b.recoveryRate - a.recoveryRate || b.betRaces - a.betRaces);
    if (favoriteConditions.length === 0) return null;
    for (const condition of favoriteConditions) {
      const matched = activeRaces.filter(
        (race) =>
          race.venue === condition.venue &&
          race.distance === condition.distance &&
          race.surface === condition.surface,
      );
      if (matched.length > 0) {
        return {
          venue: condition.venue,
          distance: condition.distance ?? 0,
          surface: condition.surface as "芝" | "ダート",
          recoveryRate: condition.recoveryRate,
          raceNumbers: matched.map((race) => race.raceNumber).sort((a, b) => a - b),
        };
      }
    }
    return null;
  }, [activeDate, activeRaces, historicalOutcomeMap, rows]);

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
      setHitStatsLoading(true);
      const [markStats, betStats, refreshedOutcomeMap] = await Promise.all([
        computeListHitStats(rows, 30),
        computeListBettingStats(rows, 30),
        computeOutcomeMapForRaceIds(racesOnActiveDate.map((r) => r.raceId)),
      ]);
      setHitStats(markStats);
      setBettingStats(betStats);
      if (Object.keys(refreshedOutcomeMap).length > 0) {
        setOutcomeMap((prev) => ({ ...prev, ...refreshedOutcomeMap }));
      }
      setHitStatsLoading(false);
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
            const preview = buildRacePreviewDataFromRace(horses, results);
            const honmei = results.find((r) => r.mark === "◎");
            const previewText =
              preview.previewText ||
              (honmei?.horseName ? `◎ ${honmei.horseName}` : "");
            if (honmei == null && !preview.hasGapSignals) return null;
            return [
              raceId,
              {
                badgeLabel: preview.badgeLabel,
                badgeTone: previewBadgeTone(preview.badgeType),
                previewText,
                honmeiHorseName: honmei?.horseName,
              },
            ];
          } catch {
            // 1レース分の解析失敗では一覧全体を落とさない。
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
      <div className="rl-page rl-page--loading min-h-screen bg-zinc-950 text-zinc-200" role="alert">
        <p className="rl-error">{err}</p>
      </div>
    );
  }

  if (rows == null) {
    return (
      <div className="rl-page rl-page--loading min-h-screen bg-zinc-950 text-zinc-200" aria-busy="true">
        <div className="rl-spinner" aria-hidden="true">
          <span>🏇</span>
        </div>
        <p className="rl-loading-text">レース一覧を読み込み中…</p>
      </div>
    );
  }

  return (
    <div className="rl-page rl-page--game min-h-screen bg-zinc-950 text-zinc-200">
      {/* ヒーローバナー */}
      <div className="rl-hero rl-hero--game border-b border-zinc-800 bg-zinc-950" role="banner">
        <div className="rl-hero__inner">
          <div className="rl-hero__content">
            <p className="rl-hero__eyebrow">AI競馬予想</p>
            <h1 className="rl-hero__title">今週のレースを<br />AIが分析</h1>
            <p className="rl-hero__sub">データサイエンスで勝利をつかもう</p>
            {favoriteConditionMatch ? (
              <p className="rl-hero__favorite-banner border border-amber-700/40 bg-amber-500/10 text-amber-200" role="status">
                🔥 あなたの得意条件：{favoriteConditionMatch.venue}
                {favoriteConditionMatch.surface}
                {favoriteConditionMatch.distance}m
                {" / "}
                本日{favoriteConditionMatch.raceNumbers.map((n) => `${n}R`).join("・")}が該当
                {" / "}
                過去回収率 {favoriteConditionMatch.recoveryRate}%
              </p>
            ) : null}
          </div>
          <div className="rl-hero__aside">
          <section
            className="rl-hit-summary rl-ev-week-top rl-hit-summary--hero rl-panel--game border border-zinc-800 bg-zinc-900/80 text-zinc-200"
            aria-label="当週の期待値レースTOP5"
          >
            <p className="rl-hit-summary__title">
              当週の期待値レース TOP5
              {weekRangeLabel ? (
                <span className="rl-ev-week-top__range">（{weekRangeLabel}）</span>
              ) : null}
            </p>
            {weeklyTopEvLoading ? (
              <p className="rl-hit-summary__empty">集計中…</p>
            ) : weeklyTopEv == null || weeklyTopEv.length === 0 ? (
              <p className="rl-hit-summary__empty">AI予測データ不足</p>
            ) : (
              <ol className="rl-ev-week-top__list">
                {weeklyTopEv.map((item, idx) => (
                  <li key={item.raceId} className="rl-ev-week-top__item">
                    <Link to={`/race/${item.raceId}`} className="rl-ev-week-top__link">
                      <span className="rl-ev-week-top__rank">{idx + 1}</span>
                      <span className="rl-ev-week-top__meta">
                        <span className="rl-ev-week-top__race">
                          {formatDateTab(item.date).replace(/\(.+\)/, "")} {item.venue}
                          {item.raceNumber}R {item.raceName ?? ""}
                        </span>
                        <span className="rl-ev-week-top__horse">
                          ◎ {item.bestHorseNumber}番 {item.bestHorseName}
                          {item.bestHorseJockey ? `(${item.bestHorseJockey})` : ""}
                          {item.bestHorseOdds != null ? ` · ${item.bestHorseOdds.toFixed(1)}倍` : ""}
                        </span>
                      </span>
                      <span className="rl-ev-week-top__ev">
                        <span className={`rl-ev-week-top__badge rl-ev-week-top__badge--${item.valueRank.toLowerCase()}`}>
                          {item.valueRank}
                        </span>
                        <strong>{item.maxEv.toFixed(2)}</strong>
                      </span>
                    </Link>
                  </li>
                ))}
              </ol>
            )}
            <p className="rl-hit-summary__sub">※表示馬は Python AI の◎。結果未確定・当週開催の全Rから上位5件</p>
          </section>
          <section className="rl-hit-summary rl-hit-summary--hero rl-panel--game border border-zinc-800 bg-zinc-900/80 text-zinc-200" aria-label="直近30レース的中率サマリー">
            <div className="rl-hit-summary__head">
              <p className="rl-hit-summary__title">
                {hitStats != null && hitStats.sampleSize > 0
                  ? `直近${hitStats.sampleSize}R 的中率`
                  : "AI的中率"}
              </p>
              <button
                type="button"
                className="rl-hit-summary__fetch-btn border border-zinc-700 bg-zinc-800 text-zinc-200 hover:bg-zinc-700 disabled:opacity-50"
                onClick={() => void handleBulkFetchResults()}
                disabled={bulkLoading || racesOnActiveDate.length === 0}
                title="選択中の開催日について、全競馬場のレース結果をまとめて取得します"
              >
                {bulkLoading ? "取得中…" : "全日・全場 結果取得"}
              </button>
            </div>
            {bulkMessage ? <p className="rl-hit-summary__status">{bulkMessage}</p> : null}
            {hitStatsLoading ? (
              <p className="rl-hit-summary__empty">集計中…</p>
            ) : hitStats == null || hitStats.sampleSize === 0 ? (
              <p className="rl-hit-summary__empty">結果データ不足</p>
            ) : (
              <>
                <p className="rl-hit-summary__favorite">
                  全体複勝圏（◎〜▲）: <strong>{formatPooledHitRate(hitStats.marks)}</strong>
                </p>
                {bettingStats != null && bettingStats.sampleSize > 0 && (
                  <p className="rl-hit-summary__favorite">
                    馬券回収率（全券種）: <strong>{bettingStats.recoveryRate}%</strong>
                    <span className="rl-hit-summary__sub" style={{ display: "block", marginTop: "0.25rem" }}>
                      的中 {bettingStats.hitRaces}/{bettingStats.sampleSize}R · 投資{" "}
                      {bettingStats.totalInvested.toLocaleString()}円 → 払戻{" "}
                      {bettingStats.totalPayout.toLocaleString()}円
                    </span>
                  </p>
                )}
                <p className="rl-hit-summary__sub">※直近{hitStats.sampleSize}レースは全日程・全競馬場混在のグローバル順（結果があるレースから最大30件）</p>
                <div className="rl-hit-summary__rows" aria-label="印別内訳">
                  {hitStats.marks.map((m) => {
                    const rate = m.total > 0 ? (m.hit / m.total) * 100 : 0;
                    return (
                      <div className="rl-hit-summary__row" key={m.mark}>
                        <span className="rl-hit-summary__mark">{m.mark}</span>
                        <div className="rl-hit-summary__track">
                          <div className="rl-hit-summary__fill" style={{ width: `${Math.max(0, Math.min(100, rate))}%` }} />
                        </div>
                        <span className="rl-hit-summary__value">{rate.toFixed(0)}%</span>
                      </div>
                    );
                  })}
                </div>
              </>
            )}
          </section>
          </div>
        </div>
      </div>

      <RaceDateTabs
        dates={dates}
        activeDate={activeDate}
        todayIso={todayIso}
        formatDateTab={formatDateTab}
        onDateChange={handleDateChange}
      />

      {/* 競馬場タブ */}
      {venues.length > 0 && (
        <div className="rl-venue-tabs border-b border-zinc-800 bg-zinc-950/80 px-2 py-2" role="tablist" aria-label="競馬場">
          {venues.map((v) => (
            <button
              key={v}
              role="tab"
              aria-selected={v === effectiveVenue}
              className={`rl-venue-tab border border-zinc-800 bg-zinc-900 text-zinc-300 hover:bg-zinc-800 hover:text-zinc-100${v === effectiveVenue ? " rl-venue-tab--active border-cyan-500/70 bg-zinc-800 text-cyan-300" : ""}`}
              onClick={() => setActiveVenue(v)}
              type="button"
            >
              {v}
            </button>
          ))}
        </div>
      )}

      <div className="backtest-hit-races__legend rl-page__legend rounded-xl border border-zinc-800 bg-zinc-900/70 text-zinc-300" aria-label="カード色の凡例">
        <span className="backtest-hit-races__legend-item">
          <span className="backtest-hit-races__legend-swatch backtest-hit-races__legend-swatch--hit" />
          的中（払戻あり）
        </span>
        <span className="backtest-hit-races__legend-item">
          <span className="backtest-hit-races__legend-swatch backtest-hit-races__legend-swatch--miss" />
          不的中（2列目全滅含む）
        </span>
        <span className="backtest-hit-races__legend-item">
          <span className="backtest-hit-races__legend-swatch backtest-hit-races__legend-swatch--neutral" />
          結果未確定
        </span>
      </div>
      <section className="rl-mission-board rounded-xl border border-zinc-800 bg-zinc-900/70 text-zinc-100" aria-label="本日の出撃候補">
        <div className="rl-mission-board__head">
          <h2>本日の出撃候補</h2>
          <p>先に見るべきレースを優先表示</p>
        </div>
        {missionRaces.length === 0 ? (
          <p className="rl-mission-board__empty">候補レースを集計中です。</p>
        ) : (
          <ul className="rl-mission-board__list">
            {missionRaces.map((race, idx) => {
              const preview = previewMap[race.raceId];
              return (
                <li key={race.raceId}>
                  <Link to={`/race/${race.raceId}`} className="rl-mission-board__link">
                    <span className="rl-mission-board__rank">{idx + 1}</span>
                    <span className="rl-mission-board__meta">
                      {race.raceNumber}R {race.raceName ?? ""}
                    </span>
                    <span className="rl-mission-board__note">
                      {preview?.badgeLabel ?? "注目シグナル集計中"}
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </section>
      <section className="rl-view-toolbar rounded-xl border border-zinc-800 bg-zinc-900/70 text-zinc-100" aria-label="表示フィルタ">
        <div className="rl-view-toolbar__head">
          <h2>表示コントロール</h2>
          <p>
            表示 {orderedActiveRaces.length}/{activeRaces.length}R ・ 未確定 {pendingRaceCount}R
          </p>
        </div>
        <div className="rl-view-toolbar__controls">
          <label>
            券種状態
            <select value={resultFilter} onChange={(e) => setResultFilter(e.target.value as ResultFilter)}>
              <option value="all">すべて</option>
              <option value="pending">結果未確定のみ</option>
              <option value="resolved">結果確定のみ</option>
            </select>
          </label>
          <label>
            馬場
            <select value={surfaceFilter} onChange={(e) => setSurfaceFilter(e.target.value as SurfaceFilter)}>
              <option value="all">芝・ダート</option>
              <option value="芝">芝のみ</option>
              <option value="ダート">ダートのみ</option>
            </select>
          </label>
          <label>
            並び順
            <select value={sortMode} onChange={(e) => setSortMode(e.target.value as RaceSortMode)}>
              <option value="mission">出撃候補優先</option>
              <option value="ev">期待値シグナル順</option>
              <option value="number">R番号順</option>
            </select>
          </label>
          <label className="rl-view-toolbar__check">
            <input
              type="checkbox"
              checked={focusMissionOnly}
              onChange={(e) => setFocusMissionOnly(e.target.checked)}
            />
            出撃候補のみ表示
          </label>
        </div>
      </section>

      {/* レースカードグリッド */}
      <div className="rl-venues bg-zinc-950">
        {activeRaces.length === 0 ? (
          <ul className="rl-race-list">
            <li className="rl-empty rounded-xl border border-zinc-800 bg-zinc-900 text-zinc-400">この日の開催はありません。</li>
          </ul>
        ) : orderedActiveRaces.length === 0 ? (
          <ul className="rl-race-list">
            <li className="rl-empty rounded-xl border border-zinc-800 bg-zinc-900 text-zinc-400">
              フィルタ条件に一致するレースがありません。
            </li>
          </ul>
        ) : (
          <ul className="rl-race-list" aria-label={`${effectiveVenue ?? ""}のレース`}>
            {orderedActiveRaces.map((item) => {
              const dynamicPreview = previewMap[item.raceId];
              const fallbackBadge = confidenceBadge(item.raceName);
              const badge = dynamicPreview
                ? { label: dynamicPreview.badgeLabel, tone: dynamicPreview.badgeTone }
                : fallbackBadge;
              const gradeBadge =
                raceGradeBadgeFromIndex(item.raceGrade) ?? raceGradeFromName(item.raceName);
              const outcome = outcomeMap[item.raceId];

              return (
                <li key={item.raceId}>
                  <RaceListCard
                    item={item}
                    outcome={outcome}
                    previewBadge={badge}
                    gradeBadge={gradeBadge}
                    previewText={dynamicPreview?.previewText}
                    honmeiHorseName={dynamicPreview?.honmeiHorseName}
                    featured={(isFeaturedRow(item) || missionRaceIdSet.has(item.raceId)) && cardToneForFeatured(outcome)}
                    surfaceBadgeClass={surfaceBadgeClass}
                    surfaceShort={surfaceShort}
                    raceIcon={raceIcon}
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
