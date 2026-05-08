import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  getHorsesFromRaceData,
  fetchRaceResultByApi,
  getRaceEvaluationById,
  getRaceIndex,
  getRaceResultById,
  type RaceResultPlace,
  type RaceIndexItem,
  type RaceGradeLabel,
} from "../../lib/race-data";
import { buildRacePreviewDataFromRace, evaluateRace, type RacePreviewBadgeType } from "../../domain/race-evaluation";
import { NetkeibaRaceLinks } from "../../components/race/NetkeibaRaceLinks";

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
    const scored = evaluateRace(horses, evalData.condition);
    const top3 = new Set(
      result.places
        .filter((p: RaceResultPlace) => p.place >= 1 && p.place <= 3)
        .map((p: RaceResultPlace) => p.horseId)
        .filter((id: string) => id.length > 0),
    );
    if (top3.size === 0) continue;

    for (const m of marks) {
      const picked = scored.find((s) => s.mark === m.mark);
      if (!picked) continue;
      m.total += 1;
      if (top3.has(picked.horseId)) m.hit += 1;
    }

    sampleSize += 1;
    if (sampleSize >= limit) break;
  }

  return { sampleSize, marks };
}

function formatHitRate(mark: MarkSummary): string {
  if (mark.total === 0) return "--";
  return `${((mark.hit / mark.total) * 100).toFixed(0)}%`;
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
  const [hitStats, setHitStats] = useState<ListHitStats | null>(null);
  const [hitStatsLoading, setHitStatsLoading] = useState(true);
  const [bulkLoading, setBulkLoading] = useState(false);
  const [bulkMessage, setBulkMessage] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    void (async () => {
      setErr(null);
      try {
        const list = await getRaceIndex();
        if (!live) return;
        setRows(list);
        if (activeDate == null && list.length > 0) {
          setActiveDate(list[0]!.date);
        }
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
    void computeListHitStats(rows, 30).then((stats) => {
      if (!live) return;
      setHitStats(stats);
      setHitStatsLoading(false);
    });
    return () => {
      live = false;
    };
  }, [rows]);

  const dates = useMemo(() => (rows ? extractDates(rows) : []), [rows]);

  const venueGroups = useMemo(() => {
    if (!rows || !activeDate) return [];
    return groupByVenue(rows.filter((r) => r.date === activeDate));
  }, [rows, activeDate]);

  const venues = useMemo(() => venueGroups.map((g) => g.venue), [venueGroups]);
  const effectiveVenue = activeVenue != null && venues.includes(activeVenue)
    ? activeVenue
    : (venues[0] ?? null);

  function handleDateChange(d: string) {
    setActiveDate(d);
    setActiveVenue(null);
  }

  const activeRaces = venueGroups.find((g) => g.venue === effectiveVenue)?.races ?? [];

  async function handleBulkFetchResults() {
    if (activeRaces.length === 0 || bulkLoading) return;
    setBulkLoading(true);
    setBulkMessage(null);
    const settled = await Promise.allSettled(
      activeRaces.map(async (r) => {
        const data = await fetchRaceResultByApi(r.raceId);
        return data != null;
      }),
    );
    const success = settled.filter((s) => s.status === "fulfilled" && s.value).length;
    const notFound = settled.filter((s) => s.status === "fulfilled" && !s.value).length;
    const failed = settled.filter((s) => s.status === "rejected").length;
    setBulkMessage(`取得完了: 成功${success}件 / 未掲載${notFound}件 / 失敗${failed}件`);
    if (rows != null && rows.length > 0) {
      setHitStatsLoading(true);
      const stats = await computeListHitStats(rows, 30);
      setHitStats(stats);
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
            const results = evaluateRace(horses, race.condition);
            const preview = buildRacePreviewDataFromRace(horses, results);
            if (!preview.hasGapSignals) return null;
            return [
              raceId,
              {
                badgeLabel: preview.badgeLabel,
                badgeTone: previewBadgeTone(preview.badgeType),
                previewText: preview.previewText,
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

  if (err != null) {
    return (
      <div className="rl-page rl-page--loading" role="alert">
        <p className="rl-error">{err}</p>
      </div>
    );
  }

  if (rows == null) {
    return (
      <div className="rl-page rl-page--loading" aria-busy="true">
        <div className="rl-spinner" aria-hidden="true">
          <span>🏇</span>
        </div>
        <p className="rl-loading-text">レース一覧を読み込み中…</p>
      </div>
    );
  }

  return (
    <div className="rl-page">
      {/* ヒーローバナー */}
      <div className="rl-hero rl-hero--has-image" role="banner">
        <div className="rl-hero__inner">
          <div className="rl-hero__content">
            <p className="rl-hero__eyebrow">AI競馬予想</p>
            <h1 className="rl-hero__title">今週のレースを<br />AIが分析</h1>
            <p className="rl-hero__sub">データサイエンスで勝利をつかもう</p>
          </div>
          <section className="rl-hit-summary rl-hit-summary--hero" aria-label="直近30レース的中率サマリー">
            <div className="rl-hit-summary__head">
              <p className="rl-hit-summary__title">
                {hitStats != null && hitStats.sampleSize > 0
                  ? `直近${hitStats.sampleSize}R 的中率`
                  : "AI的中率"}
              </p>
              <button
                type="button"
                className="rl-hit-summary__fetch-btn"
                onClick={() => void handleBulkFetchResults()}
                disabled={bulkLoading || activeRaces.length === 0}
              >
                {bulkLoading ? "取得中…" : "結果取得"}
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
                  本命馬券内率: <strong>{formatHitRate(hitStats.marks[0]!)}</strong>
                </p>
                <div className="rl-hit-summary__rows">
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

      {/* 日付タブ */}
      <div className="rl-date-tabs" role="tablist" aria-label="開催日">
        {dates.map((d) => (
          <button
            key={d}
            role="tab"
            aria-selected={d === activeDate}
            className={`rl-date-tab${d === activeDate ? " rl-date-tab--active" : ""}`}
            onClick={() => handleDateChange(d)}
            type="button"
          >
            {formatDateTab(d)}
          </button>
        ))}
      </div>

      {/* 競馬場タブ */}
      {venues.length > 0 && (
        <div className="rl-venue-tabs" role="tablist" aria-label="競馬場">
          {venues.map((v) => (
            <button
              key={v}
              role="tab"
              aria-selected={v === effectiveVenue}
              className={`rl-venue-tab${v === effectiveVenue ? " rl-venue-tab--active" : ""}`}
              onClick={() => setActiveVenue(v)}
              type="button"
            >
              {v}
            </button>
          ))}
        </div>
      )}

      {/* レースカードグリッド */}
      <div className="rl-venues">
        {activeRaces.length === 0 ? (
          <ul className="rl-race-list">
            <li className="rl-empty">この日の開催はありません。</li>
          </ul>
        ) : (
          <ul className="rl-race-list" aria-label={`${effectiveVenue ?? ""}のレース`}>
            {activeRaces.map((item) => (
              <li key={item.raceId}>
                {(() => {
                  const dynamicPreview = previewMap[item.raceId];
                  const fallbackBadge = confidenceBadge(item.raceName);
                  const badge = dynamicPreview
                    ? { label: dynamicPreview.badgeLabel, tone: dynamicPreview.badgeTone }
                    : fallbackBadge;
                  const gradeBadge =
                    raceGradeBadgeFromIndex(item.raceGrade) ?? raceGradeFromName(item.raceName);
                  return (
                <div
                  className={`rl-race-card-wrap${isFeaturedRow(item) ? " rl-race-card-wrap--featured" : ""}`}
                >
                <Link
                  to={`/race/${item.raceId}`}
                  className="rl-race-row"
                  title={item.raceName ?? item.raceId}
                >
                  <div className="rl-race-row__top">
                    <div className="rl-race-row__left">
                      {/* R番号バッジ */}
                      <div className="rl-race-row__r-badge" aria-label={`${item.raceNumber}レース`}>
                        <span className="rl-race-row__r-label">R</span>
                        <span className="rl-race-row__r-num">{item.raceNumber}</span>
                      </div>
                      <div className="rl-race-row__lead">
                        {badge ? (
                          <span className={`rl-race-row__feature rl-race-row__feature--${badge.tone}`}>{badge.label}</span>
                        ) : null}
                      </div>
                    </div>
                    <span className="rl-race-row__arrow" aria-hidden>›</span>
                  </div>

                  {/* レース情報 */}
                  <div className="rl-race-row__info">
                    <div className="rl-race-row__name-row">
                      <span className="rl-race-row__name" title={item.raceName}>
                        {item.raceName ?? `${item.raceNumber}R`}
                      </span>
                      {gradeBadge ? (
                        <span className={`rl-race-grade rl-race-grade--${gradeBadge.variant}`}>{gradeBadge.label}</span>
                      ) : null}
                    </div>
                    {dynamicPreview?.previewText ? (
                      <p className="rl-race-row__preview">{dynamicPreview.previewText}</p>
                    ) : null}
                    <div className="rl-race-row__meta">
                      <span className={surfaceBadgeClass(item.surface)}>
                        {raceIcon(item.surface)} {surfaceShort(item.surface)} {item.distance}m
                      </span>
                    </div>
                  </div>
                </Link>
                <NetkeibaRaceLinks raceId={item.raceId} variant="cardBar" />
                </div>
                  );
                })()}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
