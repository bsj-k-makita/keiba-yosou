import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import type { RaceDetailLog } from "../../domain/betting/types";
import { sortRaceDetailsForDisplay } from "../../domain/betting/raceDetailLog";

function extractDates(details: readonly RaceDetailLog[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const d of details) {
    if (!d.date || seen.has(d.date)) continue;
    seen.add(d.date);
    out.push(d.date);
  }
  return out.sort((a, b) => b.localeCompare(a));
}

function groupByVenue(
  details: readonly RaceDetailLog[],
  date: string,
): { venue: string; races: RaceDetailLog[] }[] {
  const map = new Map<string, RaceDetailLog[]>();
  for (const r of details) {
    if (r.date !== date) continue;
    const list = map.get(r.venue) ?? [];
    list.push(r);
    map.set(r.venue, list);
  }
  return Array.from(map.entries())
    .map(([venue, races]) => ({
      venue,
      races: sortRaceDetailsForDisplay(races).sort((a, b) => a.raceNumber - b.raceNumber),
    }))
    .sort((a, b) => a.venue.localeCompare(b.venue, "ja"));
}

function formatDateTab(dateStr: string): string {
  const d = new Date(dateStr + "T00:00:00");
  const m = d.getMonth() + 1;
  const day = d.getDate();
  const dow = ["日", "月", "火", "水", "木", "金", "土"][d.getDay()];
  return `${m}/${day}(${dow})`;
}

function formatPayoutShort(slot: RaceDetailLog["tickets"]["WIN"]): string {
  if (slot.isHit) {
    return slot.payout > 0 ? `${slot.payout.toLocaleString()}円` : "0円";
  }
  if (slot.formationHit) return "印的中";
  return "—";
}

function ticketHighlight(slot: RaceDetailLog["tickets"]["WIN"]): boolean {
  return slot.isHit || slot.formationHit;
}

function cardTone(row: RaceDetailLog): "hit" | "miss" {
  if (row.totalPayout > 0) return "hit";
  const t = row.tickets;
  if (t.TRIFECTA_FORM.formationHit || t.MAIN_LINE.formationHit || t.WIN.formationHit) {
    return "hit";
  }
  return "miss";
}

function missStatusLabel(row: RaceDetailLog): string {
  return row.isSecondRowDead ? "2列目全滅" : "不的中";
}

function HitRaceCard({ row }: { row: RaceDetailLog }) {
  const tone = cardTone(row);
  const recovery =
    row.totalInvested > 0 ? Math.round((row.totalPayout / row.totalInvested) * 1000) / 10 : 0;

  return (
    <li>
      <div className={`bt-hit-card bt-hit-card--${tone}`}>
        <Link to={`/race/${row.raceId}`} className="bt-hit-card__link" title={row.raceName}>
          <div className="bt-hit-card__top">
            <div className="bt-hit-card__left">
              <div className="bt-hit-card__r-badge" aria-label={`${row.raceNumber}レース`}>
                <span className="bt-hit-card__r-label">R</span>
                <span className="bt-hit-card__r-num">{row.raceNumber}</span>
              </div>
              {tone === "hit" ? (
                <span className="bt-hit-card__status bt-hit-card__status--hit">
                  {row.totalPayout > 0 ? "🎯 的中" : "印的中"}
                </span>
              ) : (
                <span className="bt-hit-card__status bt-hit-card__status--miss">{missStatusLabel(row)}</span>
              )}
            </div>
            {tone === "hit" && (
              <span className="bt-hit-card__payout">{row.totalPayout.toLocaleString()}円</span>
            )}
            <span className="bt-hit-card__arrow" aria-hidden>
              ›
            </span>
          </div>
          <div className="bt-hit-card__body">
            <div className="bt-hit-card__name-row">
              <span className="bt-hit-card__name">{row.raceName}</span>
              <span className="bt-hit-card__tier">{row.classTierLabel}</span>
            </div>
            <p className="bt-hit-card__finish">{row.finishLabel || "着順未確定"}</p>
            <p className="bt-hit-card__diagnosis">{row.diagnosisLabel}</p>
            <div className="bt-hit-card__tickets">
              <span
                className={
                  ticketHighlight(row.tickets.WIN) ? "bt-hit-card__ticket bt-hit-card__ticket--on" : "bt-hit-card__ticket"
                }
              >
                単勝 {formatPayoutShort(row.tickets.WIN)}
              </span>
              <span
                className={
                  ticketHighlight(row.tickets.MAIN_LINE)
                    ? "bt-hit-card__ticket bt-hit-card__ticket--on"
                    : "bt-hit-card__ticket"
                }
              >
                馬連 {formatPayoutShort(row.tickets.MAIN_LINE)}
              </span>
              <span
                className={
                  ticketHighlight(row.tickets.WIDE) ? "bt-hit-card__ticket bt-hit-card__ticket--on" : "bt-hit-card__ticket"
                }
              >
                ワイド {formatPayoutShort(row.tickets.WIDE)}
              </span>
              <span
                className={
                  ticketHighlight(row.tickets.TRIFECTA_FORM)
                    ? "bt-hit-card__ticket bt-hit-card__ticket--on"
                    : "bt-hit-card__ticket"
                }
              >
                3連複 {formatPayoutShort(row.tickets.TRIFECTA_FORM)}
              </span>
              <span className={`bt-hit-card__recovery${recovery >= 100 ? " bt-hit-card__recovery--plus" : ""}`}>
                回収 {row.totalInvested > 0 ? `${recovery}%` : "—"}
              </span>
            </div>
          </div>
        </Link>
      </div>
    </li>
  );
}


type Props = {
  raceDetails: RaceDetailLog[];
};

export function BacktestHitRacesSection({ raceDetails }: Props) {
  const dates = useMemo(() => extractDates(raceDetails), [raceDetails]);
  const [activeDate, setActiveDate] = useState<string | null>(null);
  const [activeVenue, setActiveVenue] = useState<string | null>(null);
  const [hitsOnly, setHitsOnly] = useState(false);

  useEffect(() => {
    if (dates.length === 0) {
      setActiveDate(null);
      return;
    }
    if (activeDate == null || !dates.includes(activeDate)) {
      setActiveDate(dates[0]!);
      setActiveVenue(null);
    }
  }, [dates, activeDate]);

  const venueGroups = useMemo(() => {
    if (!activeDate) return [];
    return groupByVenue(raceDetails, activeDate);
  }, [raceDetails, activeDate]);

  const venues = useMemo(() => venueGroups.map((g) => g.venue), [venueGroups]);
  const effectiveVenue =
    activeVenue != null && venues.includes(activeVenue) ? activeVenue : (venues[0] ?? null);

  const activeRaces = useMemo(() => {
    const list = venueGroups.find((g) => g.venue === effectiveVenue)?.races ?? [];
    if (!hitsOnly) return list;
    return list.filter((r) => r.totalPayout > 0);
  }, [venueGroups, effectiveVenue, hitsOnly]);

  const hitCount = useMemo(
    () => raceDetails.filter((r) => r.totalPayout > 0).length,
    [raceDetails],
  );

  if (raceDetails.length === 0) return null;

  return (
    <section className="card backtest-hit-races" style={{ marginTop: "1rem", padding: "1rem" }}>
      <div className="backtest-hit-races__head">
        <div>
          <h2>的中レース</h2>
          <p className="app__meta" style={{ margin: 0 }}>
            全{raceDetails.length}レース（払戻あり {hitCount}）。開催日・競馬場で絞り込み（レース選択と同じ操作）。
          </p>
        </div>
        <label className="backtest-hit-races__filter">
          <input
            type="checkbox"
            checked={hitsOnly}
            onChange={(e) => setHitsOnly(e.target.checked)}
          />
          払戻ありのみ
        </label>
      </div>

      <div className="backtest-hit-races__legend" aria-label="カード色の凡例">
        <span className="backtest-hit-races__legend-item">
          <span className="backtest-hit-races__legend-swatch backtest-hit-races__legend-swatch--hit" />
          的中（払戻あり）
        </span>
        <span className="backtest-hit-races__legend-item">
          <span className="backtest-hit-races__legend-swatch backtest-hit-races__legend-swatch--miss" />
          不的中（2列目全滅含む）
        </span>
      </div>

      {dates.length > 0 && (
        <div className="rl-date-tabs" role="tablist" aria-label="開催日">
          {dates.map((d) => (
            <button
              key={d}
              role="tab"
              type="button"
              aria-selected={d === activeDate}
              className={`rl-date-tab${d === activeDate ? " rl-date-tab--active" : ""}`}
              onClick={() => {
                setActiveDate(d);
                setActiveVenue(null);
              }}
            >
              {formatDateTab(d)}
            </button>
          ))}
        </div>
      )}

      {venues.length > 0 && (
        <div className="rl-venue-tabs" role="tablist" aria-label="競馬場">
          {venues.map((v) => (
            <button
              key={v}
              role="tab"
              type="button"
              aria-selected={v === effectiveVenue}
              className={`rl-venue-tab${v === effectiveVenue ? " rl-venue-tab--active" : ""}`}
              onClick={() => setActiveVenue(v)}
            >
              {v}
            </button>
          ))}
        </div>
      )}

      <div className="rl-venues">
        {activeRaces.length === 0 ? (
          <ul className="rl-race-list">
            <li className="rl-empty">
              {hitsOnly ? "この開催で払戻のあったレースはありません。" : "この開催のバックテストデータはありません。"}
            </li>
          </ul>
        ) : (
          <ul className="rl-race-list" aria-label={`${effectiveVenue ?? ""}のレース`}>
            {activeRaces.map((row) => (
              <HitRaceCard key={row.raceId} row={row} />
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
