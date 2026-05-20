import { useMemo } from "react";
import { Link } from "react-router-dom";
import { collectRaceDetailsForHitList } from "../../domain/betting/runFullBacktest";
import {
  BET_TICKET_TYPES,
  type BacktestEngineComparison,
  type BacktestSummary,
} from "../../domain/betting/types";
import { BacktestHitRacesSection } from "../../components/backtest/BacktestHitRacesSection";
import {
  classTierLabelJa,
  type ClassTier,
  CLASS_TIER_RANK,
} from "../../domain/race-evaluation/resolveEffectiveRaceClass";

const summaryLoaders = import.meta.glob<{ default: BacktestSummary }>(
  "../../data/backtest_summary.json",
  { eager: true },
);

const comparisonLoaders = import.meta.glob<{ default: BacktestEngineComparison }>(
  "../../data/backtest_comparison.json",
  { eager: true },
);

function loadSummary(): BacktestSummary | null {
  const key = Object.keys(summaryLoaders)[0];
  if (!key) return null;
  return summaryLoaders[key]!.default;
}

function loadComparison(): BacktestEngineComparison | null {
  const key = Object.keys(comparisonLoaders)[0];
  if (!key) return null;
  return comparisonLoaders[key]!.default;
}

function ticketLabel(t: (typeof BET_TICKET_TYPES)[number]): string {
  if (t === "WIN") return "単勝◎";
  if (t === "MAIN_LINE") return "馬連◎○▲";
  if (t === "WIDE") return "ワイド◎-印";
  return "3連複フォーメ";
}

export default function BacktestDashboardPage() {
  const summary = loadSummary();
  const comparison = loadComparison();
  const hitListDetails = useMemo(() => {
    const fromJson = summary?.raceDetailsForHitList;
    if (fromJson != null && fromJson.length > 0) return fromJson;
    return collectRaceDetailsForHitList();
  }, [summary]);

  return (
    <div className="app" style={{ padding: "1.5rem", maxWidth: 1200 }}>
      <p>
        <Link to="/races">← レース一覧</Link>
      </p>
      <h1>馬券回収率バックテスト（Python AI）</h1>
      <p className="app__lead">
        集計対象は <strong>EV推奨券（evTickets）</strong> のみ。閾値を通過した買い目にだけ投資します。
        馬連・ワイド・3連複は netkeiba 確定払戻。集計は <code>ai_*</code> バックフィル済みレースのみ。
      </p>

      {comparison == null ? (
        <p style={{ fontSize: "0.9rem", marginBottom: "1rem", opacity: 0.85 }}>
          TSとの比較表: <code>npm run backtest:bets</code> で{" "}
          <code>backtest_comparison.json</code> も同時生成されます。
        </p>
      ) : (
        <section className="card" style={{ marginBottom: "1rem", padding: "1rem" }}>
          <h2>参考: TS印との比較（同一レース集合）</h2>
          <p style={{ fontSize: "0.88rem", opacity: 0.85, marginBottom: "0.75rem" }}>
            生成: {new Date(comparison.generatedAt).toLocaleString("ja-JP")} · 比較{" "}
            {comparison.comparableRaceCount}レース（全結果あり {comparison.totalResultRaceCount}）— 同一レース集合で
            TS評価の印と AI（ai_effective_ev 順・方針B）の印をそれぞれ検証
          </p>
          <table className="horse-list" style={{ width: "100%", marginBottom: "0.75rem" }}>
            <thead>
              <tr>
                <th>指標</th>
                <th>TS評価の印</th>
                <th>Python AIの印</th>
                <th>差分 (AI−TS)</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>総回収率</td>
                <td>
                  <strong>{comparison.ts.totalRecoveryRate}%</strong>
                </td>
                <td>
                  <strong>{comparison.ai.totalRecoveryRate}%</strong>
                </td>
                <td>
                  {(comparison.ai.totalRecoveryRate - comparison.ts.totalRecoveryRate).toFixed(1)} pt
                </td>
              </tr>
              <tr>
                <td>総投資</td>
                <td>{comparison.ts.totalInvestedSum.toLocaleString()}円</td>
                <td>{comparison.ai.totalInvestedSum.toLocaleString()}円</td>
                <td>—</td>
              </tr>
              <tr>
                <td>総払戻</td>
                <td>{comparison.ts.totalPayoutSum.toLocaleString()}円</td>
                <td>{comparison.ai.totalPayoutSum.toLocaleString()}円</td>
                <td>—</td>
              </tr>
              <tr>
                <td>◎単勝的中率</td>
                <td>{comparison.ts.favoriteMark?.winRate ?? "—"}%</td>
                <td>{comparison.ai.favoriteMark?.winRate ?? "—"}%</td>
                <td>
                  {comparison.ts.favoriteMark != null && comparison.ai.favoriteMark != null
                    ? `${(comparison.ai.favoriteMark.winRate - comparison.ts.favoriteMark.winRate).toFixed(1)} pt`
                    : "—"}
                </td>
              </tr>
            </tbody>
          </table>
          <table className="horse-list" style={{ width: "100%" }}>
            <thead>
              <tr>
                <th>券種</th>
                <th>TS回収率</th>
                <th>AI回収率</th>
                <th>差分</th>
              </tr>
            </thead>
            <tbody>
              {BET_TICKET_TYPES.map((t) => (
                <tr key={t}>
                  <td>{ticketLabel(t)}</td>
                  <td>{comparison.ts.byTicketType[t].rate}%</td>
                  <td>{comparison.ai.byTicketType[t].rate}%</td>
                  <td>
                    {comparison.recoveryRateDeltaByTicket[t] >= 0 ? "+" : ""}
                    {comparison.recoveryRateDeltaByTicket[t].toFixed(1)} pt
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      {summary == null && (
        <p style={{ color: "var(--color-danger, #c44)" }}>
          backtest_summary.json がありません。{" "}
          <code>npm run fetch-results:payouts</code> →{" "}
          <code>python3 scripts/backfill-ai-predictions.py</code> →{" "}
          <code>npm run backtest:bets</code> を実行してください。
        </p>
      )}

      {summary != null && (
        <>
          <p style={{ fontSize: "0.9rem", opacity: 0.8 }}>
            生成: {new Date(summary.generatedAt).toLocaleString("ja-JP")}
            {summary.probabilityEngine === "ai" ? " · エンジン: Python AI" : ""}
          </p>

          <section className="card" style={{ marginBottom: "1rem", padding: "1rem" }}>
            <h2>全体（EV推奨券）</h2>
            <ul>
              <li>
                対象レース: {summary.totalRacesMatched}
                {summary.totalResultRaceCount != null
                  ? `（AIバックフィル済み / 全結果あり ${summary.totalResultRaceCount}）`
                  : ""}
                （スキップ {summary.totalRacesSkipped}・EV0点含む）
              </li>
              <li>総投資: {summary.totalInvestedSum.toLocaleString()}円</li>
              <li>総払戻: {summary.totalPayoutSum.toLocaleString()}円</li>
              <li>
                <strong>総回収率: {summary.totalRecoveryRate}%</strong>
              </li>
            </ul>
          </section>

          {summary.favoriteMark != null && (
            <section className="card" style={{ marginBottom: "1rem", padding: "1rem" }}>
              <h2>◎印の的中（診断）</h2>
              <p style={{ fontSize: "0.9rem", marginBottom: "0.75rem" }}>
                最終処理後の◎馬が何着に来たか。3連複のボトルネック切り分け用。
              </p>
              <ul>
                <li>集計レース: {summary.favoriteMark.races}</li>
                <li>
                  単勝的中（1着）: {summary.favoriteMark.winHits} / {summary.favoriteMark.races}（
                  <strong>{summary.favoriteMark.winRate}%</strong>）
                </li>
                <li>
                  複勝的中（3着内）: {summary.favoriteMark.showHits} / {summary.favoriteMark.races}（
                  <strong>{summary.favoriteMark.showRate}%</strong>）
                </li>
              </ul>
              {summary.favoriteMark.showRate >= 30 &&
                summary.byTicketType.TRIFECTA_FORM.rate < 15 && (
                  <p style={{ fontSize: "0.85rem", marginTop: "0.5rem", opacity: 0.9 }}>
                    3着内率は十分だが3連複回収が低い → 2列目選定（同型崩れ）が主因の可能性大。
                  </p>
                )}
              {summary.favoriteMark.showRate < 22 && (
                <p style={{ fontSize: "0.85rem", marginTop: "0.5rem", opacity: 0.9 }}>
                  3着内率が低い → 3連複の軸◎自体の見直しが先決。
                </p>
              )}
              {summary.secondRowDead != null && summary.secondRowDead.anchorSurvivedRaces > 0 && (
                <div style={{ marginTop: "1rem", paddingTop: "0.75rem", borderTop: "1px solid rgba(0,0,0,0.08)" }}>
                  <h3 style={{ fontSize: "1rem", margin: "0 0 0.5rem" }}>2列目全滅率</h3>
                  <p style={{ fontSize: "0.9rem", margin: 0 }}>
                    ◎生存レース数: {summary.secondRowDead.anchorSurvivedRaces} / そのうち2列目全滅:{" "}
                    {summary.secondRowDead.secondRowDeadCount}回（
                    <strong>{summary.secondRowDead.secondRowDeadRate}%</strong>）
                  </p>
                  {summary.secondRowDead.secondRowDeadRate >= 50 && (
                    <p style={{ fontSize: "0.85rem", marginTop: "0.5rem", opacity: 0.9 }}>
                      対策：2列目のキャラクター分散または相手重複の間引きをさらに強化してください。
                    </p>
                  )}
                </div>
              )}
            </section>
          )}

          <section className="card" style={{ marginBottom: "1rem", padding: "1rem" }}>
            <h2>券種別</h2>
            <table className="horse-list" style={{ width: "100%" }}>
              <thead>
                <tr>
                  <th>券種</th>
                  <th>投資</th>
                  <th>払戻</th>
                  <th>回収率</th>
                  <th>的中率</th>
                  <th>備考</th>
                </tr>
              </thead>
              <tbody>
                {BET_TICKET_TYPES.map((t) => {
                  const row = summary.byTicketType[t];
                  const label =
                    t === "WIN"
                      ? "単勝◎"
                      : t === "MAIN_LINE"
                        ? "馬連◎○▲"
                        : t === "WIDE"
                          ? "ワイド◎-印"
                          : "3連複フォーメ";
                  return (
                    <tr key={t}>
                      <td>{label}</td>
                      <td>{row.invested.toLocaleString()}</td>
                      <td>{row.payout.toLocaleString()}</td>
                      <td>{row.rate}%</td>
                      <td>{row.accuracy}%</td>
                      <td>{row.estimatedPayout ? "払戻データなし" : "確定払戻"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </section>

          <section className="card" style={{ padding: "1rem" }}>
            <h2>クラス別</h2>
            <table className="horse-list" style={{ width: "100%" }}>
              <thead>
                <tr>
                  <th>区分</th>
                  <th>レース数</th>
                  <th>投資</th>
                  <th>払戻</th>
                  <th>回収率</th>
                </tr>
              </thead>
              <tbody>
                {(
                  [
                    ["MAIDEN_NEW", "未勝利・新馬"],
                    ["OPEN_GRADE", "OP・重賞"],
                    ["OTHER", "その他"],
                  ] as const
                ).map(([key, label]) => {
                  const row = summary.byClassLevel[key];
                  return (
                    <tr key={key}>
                      <td>{label}</td>
                      <td>{row.races}</td>
                      <td>{row.invested.toLocaleString()}</td>
                      <td>{row.payout.toLocaleString()}</td>
                      <td>{row.rate}%</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </section>

          {summary.byClassTier != null && (
            <section className="card" style={{ marginTop: "1rem", padding: "1rem" }}>
              <h2>クラス階層（Tier）</h2>
              <table className="horse-list" style={{ width: "100%" }}>
                <thead>
                  <tr>
                    <th>Tier</th>
                    <th>レース数</th>
                    <th>投資</th>
                    <th>払戻</th>
                    <th>回収率</th>
                  </tr>
                </thead>
                <tbody>
                  {(Object.keys(CLASS_TIER_RANK) as ClassTier[])
                    .sort((a, b) => CLASS_TIER_RANK[a] - CLASS_TIER_RANK[b])
                    .map((tier) => {
                      const row = summary.byClassTier[tier];
                      if (row.races === 0) return null;
                      return (
                        <tr key={tier}>
                          <td>{classTierLabelJa(tier)}</td>
                          <td>{row.races}</td>
                          <td>{row.invested.toLocaleString()}</td>
                          <td>{row.payout.toLocaleString()}</td>
                          <td>{row.rate}%</td>
                        </tr>
                      );
                    })}
                </tbody>
              </table>
            </section>
          )}

          {hitListDetails.length > 0 && (
            <BacktestHitRacesSection
              raceDetails={hitListDetails}
              aiComparableRaceCount={summary.totalRacesMatched}
            />
          )}
        </>
      )}
    </div>
  );
}
