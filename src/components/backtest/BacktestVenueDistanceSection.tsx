import { useMemo, useState } from "react";
import type { RaceDetailLog } from "../../domain/betting/types";
import type { RaceIndexItem } from "../../lib/race-data/raceEvaluationTypes";
import {
  aggregateVenueDistanceStats,
  filterByMinRaces,
  type RecoveryZone,
  type VenueDistanceBucketStats,
  zoneLabelJa,
} from "../../domain/betting/aggregateVenueDistanceStats";

type TabId = "venue" | "surface" | "detail";

type Props = {
  raceDetails: RaceDetailLog[];
  indexRows: RaceIndexItem[];
};

function zoneClass(zone: RecoveryZone): string {
  return `bt-zone-badge bt-zone-badge--${zone}`;
}

function StatsTable({
  rows,
  showDistance,
  showSurface,
}: {
  rows: VenueDistanceBucketStats[];
  showDistance: boolean;
  showSurface: boolean;
}) {
  if (rows.length === 0) {
    return <p className="bt-venue-stats__empty">該当する区分がありません。</p>;
  }

  return (
    <table className="horse-list bt-venue-stats__table" style={{ width: "100%" }}>
      <thead>
        <tr>
          <th>区分</th>
          {showDistance ? <th>距離</th> : null}
          {showSurface ? <th>馬場</th> : null}
          <th>R</th>
          <th>的中R</th>
          <th>回収率</th>
          <th>◎1着</th>
          <th>◎3着内</th>
          <th>傾向</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.key} className={`bt-venue-stats__row bt-venue-stats__row--${row.zone}`}>
            <td>{row.venue}</td>
            {showDistance ? <td>{row.distanceLabel}</td> : null}
            {showSurface ? <td>{row.surface ?? "—"}</td> : null}
            <td>{row.races}</td>
            <td>
              {row.hitRaces}/{row.betRaces}
              {row.skips > 0 ? (
                <span className="bt-venue-stats__skip" title="見送り">
                  {" "}
                  (+{row.skips})
                </span>
              ) : null}
            </td>
            <td>
              <strong>{row.recoveryRate}%</strong>
            </td>
            <td>{row.anchorHitRate}%</td>
            <td>{row.anchorShowRate}%</td>
            <td>
              <span className={zoneClass(row.zone)}>{zoneLabelJa(row.zone)}</span>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function BacktestVenueDistanceSection({ raceDetails, indexRows }: Props) {
  const [tab, setTab] = useState<TabId>("venue");
  const [minRaces, setMinRaces] = useState(3);

  const aggregation = useMemo(
    () => aggregateVenueDistanceStats(raceDetails, indexRows),
    [raceDetails, indexRows],
  );

  const strongZones = useMemo(
    () =>
      filterByMinRaces(aggregation.byVenueDistanceSurface, 5)
        .filter((r) => r.zone === "strong")
        .slice(0, 5),
    [aggregation.byVenueDistanceSurface],
  );

  const weakZones = useMemo(
    () =>
      filterByMinRaces(aggregation.byVenueDistanceSurface, 5)
        .filter((r) => r.zone === "weak")
        .slice(0, 5),
    [aggregation.byVenueDistanceSurface],
  );

  const tableRows = useMemo(() => {
    if (tab === "venue") return aggregation.byVenue;
    if (tab === "surface") return filterByMinRaces(aggregation.byVenueSurface, minRaces);
    return filterByMinRaces(aggregation.byVenueDistanceSurface, minRaces);
  }, [tab, minRaces, aggregation]);

  if (raceDetails.length === 0) return null;

  return (
    <section className="card bt-venue-stats" style={{ marginTop: "1rem", padding: "1rem" }}>
      <h2>競馬場・距離別の傾向</h2>
      <p className="app__meta" style={{ marginBottom: "0.75rem" }}>
        結果確定 {raceDetails.length}レースの EV推奨券回収を集計。ロジック変更はせず、
        <strong>場×距離×芝ダ</strong>の相性を参考にしてください。
      </p>

      <div className="bt-venue-stats__legend" aria-label="傾向ラベルの凡例">
        <span className={zoneClass("strong")}>強 ≥150%</span>
        <span className={zoneClass("neutral")}>— 100〜149%</span>
        <span className={zoneClass("caution")}>注意 50〜99%</span>
        <span className={zoneClass("weak")}>弱 &lt;50%</span>
      </div>

      {(strongZones.length > 0 || weakZones.length > 0) && (
        <div className="bt-venue-stats__highlights">
          {strongZones.length > 0 && (
            <div className="bt-venue-stats__highlight bt-venue-stats__highlight--strong">
              <p className="bt-venue-stats__highlight-title">回収が伸びやすい帯（5R以上）</p>
              <ul>
                {strongZones.map((z) => (
                  <li key={z.key}>
                    {z.venue} {z.distanceLabel} {z.surface} — <strong>{z.recoveryRate}%</strong>
                    （◎1着 {z.anchorHitRate}%）
                  </li>
                ))}
              </ul>
            </div>
          )}
          {weakZones.length > 0 && (
            <div className="bt-venue-stats__highlight bt-venue-stats__highlight--weak">
              <p className="bt-venue-stats__highlight-title">慎重ゾーン（5R以上・回収50%未満）</p>
              <ul>
                {weakZones.map((z) => (
                  <li key={z.key}>
                    {z.venue} {z.distanceLabel} {z.surface} — <strong>{z.recoveryRate}%</strong>
                    （◎1着 {z.anchorHitRate}%）
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      <div className="bt-venue-stats__toolbar">
        <div className="rl-venue-tabs" role="tablist" aria-label="集計単位">
          {(
            [
              ["venue", "競馬場別"],
              ["surface", "競馬場×芝ダ"],
              ["detail", "競馬場×距離×芝ダ"],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={tab === id}
              className={`rl-venue-tab${tab === id ? " rl-venue-tab--active" : ""}`}
              onClick={() => setTab(id)}
            >
              {label}
            </button>
          ))}
        </div>
        {tab !== "venue" && (
          <label className="bt-venue-stats__min-races">
            最小R数
            <select value={minRaces} onChange={(e) => setMinRaces(Number(e.target.value))}>
              <option value={1}>1</option>
              <option value={3}>3</option>
              <option value={5}>5</option>
              <option value={8}>8</option>
            </select>
          </label>
        )}
      </div>

      <StatsTable
        rows={tableRows}
        showDistance={tab === "detail"}
        showSurface={tab !== "venue"}
      />
    </section>
  );
}
