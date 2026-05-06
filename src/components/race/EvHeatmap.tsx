type HeatmapRow = {
  horseId: string;
  horseName: string;
  effectiveEv: number | null;
};

type Props = {
  rows: HeatmapRow[];
};

export function EvHeatmap({ rows }: Props) {
  if (rows.length === 0) return null;
  return (
    <div className="ev-heatmap" aria-label="オッズ補正スコアヒートマップ">
      <h4 className="ev-heatmap__title">スコアヒートマップ</h4>
      <div className="ev-heatmap__grid">
        {rows.map((row) => {
          const ev = row.effectiveEv;
          const hot = ev != null && ev > 1.25;
          const danger = ev != null && ev < 1.0;
          return (
            <div
              key={row.horseId}
              className={`ev-heatmap__cell${hot ? " ev-heatmap__cell--hot" : danger ? " ev-heatmap__cell--cool" : ""}`}
            >
              <span className="ev-heatmap__name">{row.horseName}</span>
              <span className="ev-heatmap__ev">{ev == null ? "—" : ev.toFixed(2)}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
