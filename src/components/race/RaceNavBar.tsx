import { Link } from "react-router-dom";
import type { RaceIndexItem } from "../../lib/race-data";

type Props = {
  current: RaceIndexItem;
  raceIndex: RaceIndexItem[];
};

function uniqueInOrder(values: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const v of values) {
    if (seen.has(v)) continue;
    seen.add(v);
    out.push(v);
  }
  return out;
}

function formatDateTab(dateStr: string): string {
  const d = new Date(`${dateStr}T00:00:00`);
  const m = d.getMonth() + 1;
  const day = d.getDate();
  const dow = ["日", "月", "火", "水", "木", "金", "土"][d.getDay()];
  return `${m}/${day}(${dow})`;
}

function pickRaceIdForTarget(
  raceIndex: RaceIndexItem[],
  date: string,
  venue: string,
  preferredRaceNumber: number,
  currentRaceId: string,
): string | null {
  const target = raceIndex
    .filter((r) => r.date === date && r.venue === venue)
    .sort((a, b) => a.raceNumber - b.raceNumber);
  if (target.length === 0) return null;
  const exact = target.find((r) => r.raceNumber === preferredRaceNumber);
  if (exact) return exact.raceId;
  const currentHit = target.find((r) => r.raceId === currentRaceId);
  if (currentHit) return currentHit.raceId;
  return target[0]!.raceId;
}

/** 開催日・競馬場・レース番号（ヘッダ直上の固定ナビ） */
export function RaceTopNav({ current, raceIndex }: Props) {
  const dates = uniqueInOrder(raceIndex.map((r) => r.date));
  const venues = uniqueInOrder(
    raceIndex.filter((r) => r.date === current.date).map((r) => r.venue),
  );
  const sorted = raceIndex
    .filter((r) => r.date === current.date && r.venue === current.venue)
    .sort((a, b) => a.raceNumber - b.raceNumber);
  const idx = sorted.findIndex((r) => r.raceId === current.raceId);
  const prev = idx > 0 ? sorted[idx - 1] : null;
  const next = idx >= 0 && idx < sorted.length - 1 ? sorted[idx + 1] : null;

  return (
    <nav className="race-nav race-nav--top" aria-label="レース選択">
      <div className="race-nav__inner race-nav__inner--top">
        <div className="race-nav__date-tabs" role="tablist" aria-label="開催日">
          {dates.map((date) => {
            const targetRaceId = pickRaceIdForTarget(
              raceIndex,
              date,
              current.venue,
              current.raceNumber,
              current.raceId,
            );
            if (targetRaceId == null) return null;
            return (
              <Link
                key={date}
                to={`/race/${targetRaceId}`}
                className={`race-nav__date-tab${date === current.date ? " race-nav__date-tab--active" : ""}`}
                aria-current={date === current.date ? "page" : undefined}
              >
                {formatDateTab(date)}
              </Link>
            );
          })}
        </div>

        <div className="race-nav__venue-tabs" role="tablist" aria-label="競馬場">
          {venues.map((venue) => {
            const targetRaceId = pickRaceIdForTarget(
              raceIndex,
              current.date,
              venue,
              current.raceNumber,
              current.raceId,
            );
            if (targetRaceId == null) return null;
            return (
              <Link
                key={venue}
                to={`/race/${targetRaceId}`}
                className={`race-nav__venue-tab${venue === current.venue ? " race-nav__venue-tab--active" : ""}`}
                aria-current={venue === current.venue ? "page" : undefined}
              >
                {venue}
              </Link>
            );
          })}
        </div>

        <div className="race-nav__race-row">
          {prev ? (
            <Link className="race-nav__arrow race-nav__arrow--prev" to={`/race/${prev.raceId}`}>
              ◀ {prev.raceNumber}R
            </Link>
          ) : (
            <span className="race-nav__arrow race-nav__arrow--disabled">◀</span>
          )}

          <div className="race-nav__tabs" role="tablist" aria-label="レース番号">
            {sorted.map((r) => (
              <Link
                key={r.raceId}
                to={`/race/${r.raceId}`}
                className={`race-nav__tab${r.raceId === current.raceId ? " race-nav__tab--active" : ""}`}
                aria-current={r.raceId === current.raceId ? "page" : undefined}
              >
                {r.raceNumber}R
              </Link>
            ))}
          </div>

          {next ? (
            <Link className="race-nav__arrow race-nav__arrow--next" to={`/race/${next.raceId}`}>
              {next.raceNumber}R ▶
            </Link>
          ) : (
            <span className="race-nav__arrow race-nav__arrow--disabled">▶</span>
          )}
        </div>
      </div>
    </nav>
  );
}
