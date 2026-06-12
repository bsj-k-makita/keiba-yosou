import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { getRaceEvaluationById, getRaceIndex, getRaceResultById, type RaceIndexItem } from "../../lib/race-data";
import { fetchWeeklyTopEvRaces, type WeeklyTopEvRaceItem } from "../../domain/race-evaluation/weeklyTopEvRaces";
import { computeRaceBettingOutcomeById } from "../../lib/race-data/computeRaceBettingOutcomeById";

type HomeStats = {
  sampleSize: number;
  recoveryRate: number;
  hitRaces: number;
};

type JraVisualAsset = {
  key: string;
  imageUrl: string;
  label: string;
};

const JRA_VISUAL_ASSETS_2026: JraVisualAsset[] = [
  { key: "2026-6", imageUrl: "https://own.jra.jp/gallery/digital_contents/img/jra2026-6_1920x1080.jpg", label: "June Visual" },
  { key: "2026-5", imageUrl: "https://own.jra.jp/gallery/digital_contents/img/jra2026-5_1920x1080.jpg", label: "May Visual" },
  { key: "2026-4", imageUrl: "https://own.jra.jp/gallery/digital_contents/img/jra2026-4_1920x1080.jpg", label: "April Visual" },
  { key: "2026-3", imageUrl: "https://own.jra.jp/gallery/digital_contents/img/jra2026-3_1920x1080.jpg", label: "March Visual" },
  { key: "2026-2", imageUrl: "https://own.jra.jp/gallery/digital_contents/img/jra2026-2_1920x1080.jpg", label: "February Visual" },
  { key: "2026-1", imageUrl: "https://own.jra.jp/gallery/digital_contents/img/jra2026-1_1920x1080.jpg", label: "January Visual" },
];

function formatLocalTodayIso(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function formatDateLabel(dateStr: string): string {
  const d = new Date(dateStr + "T00:00:00");
  const m = d.getMonth() + 1;
  const day = d.getDate();
  const dow = ["日", "月", "火", "水", "木", "金", "土"][d.getDay()];
  return `${m}/${day}(${dow})`;
}

function buildMissionRaces(rows: RaceIndexItem[], weeklyTop: WeeklyTopEvRaceItem[] | null): RaceIndexItem[] {
  if (rows.length === 0) return [];
  const firstDate = rows[0]?.date ?? "";
  const sameDay = rows
    .filter((r) => r.date === firstDate)
    .sort((a, b) => a.raceNumber - b.raceNumber);
  const topIds = new Set((weeklyTop ?? []).slice(0, 3).map((w) => w.raceId));
  const fromTop = sameDay.filter((r) => topIds.has(r.raceId));
  if (fromTop.length >= 3) return fromTop.slice(0, 3);
  const merged = [...fromTop];
  for (const race of sameDay) {
    if (merged.some((m) => m.raceId === race.raceId)) continue;
    merged.push(race);
    if (merged.length >= 3) break;
  }
  return merged;
}

async function loadHomeStats(rows: RaceIndexItem[]): Promise<HomeStats> {
  let sampleSize = 0;
  let hitRaces = 0;
  let invested = 0;
  let payout = 0;
  for (const row of rows.slice(0, 40)) {
    const outcome = await computeRaceBettingOutcomeById(row.raceId);
    if (outcome == null || outcome.status !== "resolved") continue;
    sampleSize += 1;
    if (outcome.isHit) hitRaces += 1;
    invested += outcome.totalInvested;
    payout += outcome.totalPayout;
  }
  return {
    sampleSize,
    hitRaces,
    recoveryRate: invested > 0 ? Math.round((payout / invested) * 100) : 0,
  };
}

export function HomePage() {
  const [rows, setRows] = useState<RaceIndexItem[] | null>(null);
  const [weeklyTopEv, setWeeklyTopEv] = useState<WeeklyTopEvRaceItem[] | null>(null);
  const [stats, setStats] = useState<HomeStats | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const todayIso = useMemo(() => formatLocalTodayIso(), []);

  useEffect(() => {
    let live = true;
    void (async () => {
      setLoading(true);
      setError(null);
      try {
        const indexRows = await getRaceIndex();
        if (!live) return;
        setRows(indexRows);
        const [topEvRows, statRows] = await Promise.all([
          fetchWeeklyTopEvRaces(indexRows, todayIso, getRaceEvaluationById, 5, getRaceResultById),
          loadHomeStats(indexRows),
        ]);
        if (!live) return;
        setWeeklyTopEv(topEvRows);
        setStats(statRows);
      } catch {
        if (!live) return;
        setError("TOPのデータ取得に失敗しました。");
      } finally {
        if (live) setLoading(false);
      }
    })();
    return () => {
      live = false;
    };
  }, [todayIso]);

  const missionRaces = useMemo(() => buildMissionRaces(rows ?? [], weeklyTopEv), [rows, weeklyTopEv]);
  const firstRaceId = missionRaces[0]?.raceId ?? weeklyTopEv?.[0]?.raceId ?? null;

  if (loading) {
    return (
      <div className="home-page" aria-busy="true">
        <p className="home-loading">TOPデータを読み込み中...</p>
      </div>
    );
  }

  if (error != null) {
    return (
      <div className="home-page" role="alert">
        <p className="home-error">{error}</p>
        <Link to="/races" className="home-link">レース一覧へ</Link>
      </div>
    );
  }

  return (
    <div className="home-page">
      <header className="home-hero">
        <div className="home-hero__main">
          <p className="home-hero__kicker">MISSION CONTROL</p>
          <h1>今日の勝負レースを、最短で。</h1>
          <p className="home-hero__lead">
            注目レースを先に見て、理由を確認し、すぐ買い目まで進める導線を用意しました。
          </p>
          <div className="home-hero__cta">
            {firstRaceId ? (
              <Link to={`/race/${firstRaceId}`} className="home-btn home-btn--primary">
                今すぐ本命レースを見る
              </Link>
            ) : null}
            <Link to="/races" className="home-btn">全レースを探索</Link>
            <Link to="/backtest" className="home-btn">検証ラボへ</Link>
          </div>
        </div>
        <figure className="home-hero__kv" aria-hidden>
          <img
            src={JRA_VISUAL_ASSETS_2026[0]?.imageUrl}
            alt=""
            decoding="async"
            loading="lazy"
          />
        </figure>
      </header>

      <section className="home-grid">
        <article className="home-card">
          <h2>本日の出撃候補</h2>
          {missionRaces.length === 0 ? (
            <p className="home-muted">候補を集計中です。</p>
          ) : (
            <ol className="home-list">
              {missionRaces.map((race, idx) => (
                <li key={race.raceId}>
                  <Link to={`/race/${race.raceId}`}>
                    <span>{idx + 1}. {race.venue} {race.raceNumber}R</span>
                    <strong>{race.raceName ?? `${race.raceNumber}R`}</strong>
                  </Link>
                </li>
              ))}
            </ol>
          )}
        </article>

        <article className="home-card">
          <h2>当週 EV ランキング</h2>
          {weeklyTopEv == null || weeklyTopEv.length === 0 ? (
            <p className="home-muted">AI予測データ不足</p>
          ) : (
            <ol className="home-list">
              {weeklyTopEv.slice(0, 5).map((item, idx) => (
                <li key={item.raceId}>
                  <Link to={`/race/${item.raceId}`}>
                    <span>{idx + 1}. {formatDateLabel(item.date)} {item.venue} {item.raceNumber}R</span>
                    <strong>◎ {item.bestHorseNumber}番 {item.bestHorseName} / EV {item.maxEv.toFixed(2)}</strong>
                  </Link>
                </li>
              ))}
            </ol>
          )}
        </article>

        <article className="home-card">
          <h2>直近パフォーマンス</h2>
          {stats == null || stats.sampleSize === 0 ? (
            <p className="home-muted">結果データを集計中です。</p>
          ) : (
            <div className="home-kpis">
              <p><span>対象レース</span><strong>{stats.sampleSize}R</strong></p>
              <p><span>的中レース</span><strong>{stats.hitRaces}R</strong></p>
              <p><span>回収率</span><strong>{stats.recoveryRate}%</strong></p>
            </div>
          )}
          <p className="home-note">まずは「出撃候補」から順番に確認すると判断が速くなります。</p>
        </article>
      </section>

      <section className="home-visual-rail" aria-label="JRA公式イメージ装飾">
        <ul className="home-visual-rail__list">
          {JRA_VISUAL_ASSETS_2026.slice(0, 4).map((item) => (
            <li key={item.key}>
              <img src={item.imageUrl} alt={item.label} loading="lazy" decoding="async" />
            </li>
          ))}
        </ul>
        <p className="home-visual-rail__note">
          Images: JRA official digital contents
          <a href="https://own.jra.jp/gallery/digital_contents/" target="_blank" rel="noopener noreferrer">
             参照元
          </a>
        </p>
      </section>
    </div>
  );
}
