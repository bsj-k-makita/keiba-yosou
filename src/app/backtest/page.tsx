import { Link } from "react-router-dom";
import type { BacktestSummary } from "../../domain/betting/types";

const summaryLoaders = import.meta.glob<{ default: BacktestSummary }>(
  "../../data/backtest_summary.json",
  { eager: true },
);

function loadSummary(): BacktestSummary | null {
  const key = Object.keys(summaryLoaders)[0];
  if (!key) return null;
  return summaryLoaders[key]!.default;
}

export default function BacktestDashboardPage() {
  const summary = loadSummary();

  return (
    <div className="app" style={{ padding: "1.5rem", maxWidth: 960 }}>
      <p>
        <Link to="/races">← レース一覧</Link>
      </p>
      <h1>馬券回収率バックテスト</h1>
      <p className="app__lead">
        定型ルール（単勝◎ / 馬連◎○▲ / 3連複◎-○▲-△☆）の一括検証結果。馬連・3連複は単勝オッズからの推定払戻です。
      </p>

      {summary == null && (
        <p style={{ color: "var(--color-danger, #c44)" }}>
          backtest_summary.json がありません。ターミナルで{" "}
          <code>npm run backtest:bets</code> を実行してください。
        </p>
      )}

      {summary != null && (
        <>
          <p style={{ fontSize: "0.9rem", opacity: 0.8 }}>
            生成: {new Date(summary.generatedAt).toLocaleString("ja-JP")}
          </p>

          <section className="card" style={{ marginBottom: "1rem", padding: "1rem" }}>
            <h2>全体</h2>
            <ul>
              <li>対象レース: {summary.totalRacesMatched}（スキップ {summary.totalRacesSkipped}）</li>
              <li>総投資: {summary.totalInvestedSum.toLocaleString()}円</li>
              <li>総払戻: {summary.totalPayoutSum.toLocaleString()}円</li>
              <li>
                <strong>総回収率: {summary.totalRecoveryRate}%</strong>
              </li>
            </ul>
          </section>

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
                {(["WIN", "MAIN_LINE", "TRIFECTA_FORM"] as const).map((t) => {
                  const row = summary.byTicketType[t];
                  const label =
                    t === "WIN" ? "単勝◎" : t === "MAIN_LINE" ? "馬連◎○▲" : "3連複フォーメ";
                  return (
                    <tr key={t}>
                      <td>{label}</td>
                      <td>{row.invested.toLocaleString()}</td>
                      <td>{row.payout.toLocaleString()}</td>
                      <td>{row.rate}%</td>
                      <td>{row.accuracy}%</td>
                      <td>{row.estimatedPayout ? "推定払戻" : "単勝実オッズ"}</td>
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
        </>
      )}
    </div>
  );
}
