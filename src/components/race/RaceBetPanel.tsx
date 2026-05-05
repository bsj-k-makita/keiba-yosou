import { useMemo, useState, type CSSProperties } from "react";
import type { HorseAbility, HorseScoreResult, RaceCondition, InvestmentCommentInput } from "../../domain/race-evaluation";
import { buildBetPlan, type BetMode } from "./betBuilder";

type Props = {
  sorted: HorseScoreResult[];
  horses: HorseAbility[];
  condition: RaceCondition;
};

// value_rank に応じたバッジスタイル
const VALUE_RANK_STYLE: Record<string, { bg: string; color: string; label: string }> = {
  S: { bg: "#c0392b", color: "#fff", label: "S" },
  A: { bg: "#e67e22", color: "#fff", label: "A" },
  B: { bg: "#27ae60", color: "#fff", label: "B" },
  C: { bg: "#7f8c8d", color: "#fff", label: "C" },
  D: { bg: "#bdc3c7", color: "#555", label: "D" },
};

/** EVテーブル右列。実質期待値の帯（valueRank）に合わせ、ランク列と同じ物差しで表記する。 */
function expectationJudgmentLabel(inv: InvestmentCommentInput): { text: string; color: string } {
  const vr = inv.valueRank;
  if (vr === "S" || vr === "A") {
    return { text: "【期待値高】", color: "#c0392b" };
  }
  if (vr === "B") {
    return { text: "【期待値あり】", color: "#27ae60" };
  }
  if (vr === "C") {
    return { text: "【期待値控えめ】", color: "#7f8c8d" };
  }
  return { text: "【期待値低】", color: "#95a5a6" };
}

type EvRow = {
  horseId: string;
  horseName: string;
  gate: number;
  investment: InvestmentCommentInput;
};

function buildEvRows(sorted: HorseScoreResult[], horses: HorseAbility[]): EvRow[] {
  const horseMap = new Map(horses.map((h) => [h.horseId, h]));
  const rows: EvRow[] = [];
  for (const result of sorted) {
    const horse = horseMap.get(result.horseId);
    if (horse?.investment == null) continue;
    rows.push({
      horseId: result.horseId,
      horseName: horse.horseName,
      gate: (horse as HorseAbility & { gate?: number }).gate ?? 0,
      investment: horse.investment,
    });
  }
  return rows;
}

function EvRankBadge({ rank }: { rank: string }) {
  const style = VALUE_RANK_STYLE[rank] ?? VALUE_RANK_STYLE["D"]!;
  return (
    <span
      style={{
        display: "inline-block",
        minWidth: "1.6em",
        padding: "0.1em 0.4em",
        borderRadius: "3px",
        background: style.bg,
        color: style.color,
        fontWeight: "bold",
        fontSize: "0.85em",
        textAlign: "center",
      }}
    >
      {style.label}
    </span>
  );
}

function EvSection({
  rows,
  budget,
}: {
  rows: EvRow[];
  budget: number;
}) {
  // 見送りを除いた購入候補
  const candidates = rows.filter((r) => r.investment.betType !== "見送り");

  return (
    <div className="bet-panel__ev-section">
      <h3 className="bet-panel__ev-title">AIオッズ評価（実質期待値）</h3>
      <p className="bet-panel__ev-desc">
        実質期待値 = (予測確率 × オッズ) − 0.15 ／ ケリー投資比率は全資金に対する割合。
        期待値判断列は左のランク（S〜D）と同じ帯で【期待値高】などと表示します（上部の買い目選定とは別ロジックです）。
      </p>
      <table className="bet-panel__ev-table">
        <thead>
          <tr>
            <th>馬番</th>
            <th>馬名</th>
            <th>EV</th>
            <th>ランク</th>
            <th>確率</th>
            <th>オッズ</th>
            <th>ケリー%</th>
            <th>推奨額</th>
            <th>期待値判断</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const inv = row.investment;
            const ev = inv.valueScore ?? 0;
            const kelly = inv.kellyWeight ?? 0;
            const recommendedAmount = Math.floor((budget * kelly) / 100) * 100;
            const isBuy = inv.betType !== "見送り";
            const judgment = expectationJudgmentLabel(inv);
            return (
              <tr
                key={row.horseId}
                style={{ opacity: isBuy ? 1 : 0.45 }}
              >
                <td style={{ textAlign: "center" }}>{row.gate}番</td>
                <td>{row.horseName}</td>
                <td style={{ textAlign: "right", fontWeight: "bold", color: ev >= 1.0 ? "#27ae60" : "#e74c3c" }}>
                  {ev.toFixed(2)}
                </td>
                <td style={{ textAlign: "center" }}>
                  <EvRankBadge rank={inv.valueRank} />
                </td>
                <td style={{ textAlign: "right" }}>
                  {(inv.predictedProbability * 100).toFixed(1)}%
                </td>
                <td style={{ textAlign: "right" }}>
                  {inv.actualOdds.toFixed(1)}倍
                  {inv.oddsSource === "estimated" && (
                    <span style={{ fontSize: "0.75em", color: "#95a5a6" }}> 推定</span>
                  )}
                </td>
                <td style={{ textAlign: "right", color: kelly > 0 ? "#2980b9" : "#bdc3c7" }}>
                  {kelly > 0 ? `${(kelly * 100).toFixed(1)}%` : "—"}
                </td>
                <td style={{ textAlign: "right", fontWeight: kelly > 0 ? "bold" : "normal" }}>
                  {recommendedAmount > 0 ? `${recommendedAmount.toLocaleString()}円` : "—"}
                </td>
                <td style={{ textAlign: "center", color: judgment.color, fontWeight: "bold" }}>
                  {judgment.text}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      {candidates.length === 0 ? (
        <p className="bet-panel__ev-no-bet">
          ケリー配分・買い区分の対象馬（データ上「見送り」以外）がありません。
        </p>
      ) : (
        <div className="bet-panel__ev-summary">
          <p>
            購入候補: <strong>{candidates.length}頭</strong>
            {" ／ "}
            合計推奨投資:
            <strong>
              {" "}
              {candidates
                .reduce((sum, r) => {
                  const kelly = r.investment.kellyWeight ?? 0;
                  return sum + Math.floor((budget * kelly) / 100) * 100;
                }, 0)
                .toLocaleString()}
              円
            </strong>
          </p>
        </div>
      )}
    </div>
  );
}

export function RaceBetPanel({ sorted, horses, condition }: Props) {
  const [mode, setMode] = useState<BetMode>("conservative");
  const [antiGami, setAntiGami] = useState<boolean>(false);
  const [budgetInput, setBudgetInput] = useState<string>("5000");
  const budget = Number.isFinite(Number(budgetInput)) ? Math.max(1000, Math.round(Number(budgetInput))) : 5000;
  const plan = useMemo(
    () => buildBetPlan(sorted, horses, condition, mode, budget, antiGami),
    [antiGami, budget, condition, horses, mode, sorted],
  );
  const evRows = useMemo(() => buildEvRows(sorted, horses), [sorted, horses]);
  const planKey = `${condition.pace}-${mode}-${antiGami}-${plan?.totalStake ?? 0}-${plan?.tickets
    .flatMap((t) => t.items.map((i) => i.combo))
    .join("|")}`;

  if (plan == null) {
    return (
      <section className="bet-panel" aria-label="買い目提案">
        <h2 className="app__section-title">買い目提案</h2>
        <p className="bet-panel__lead">買い目提案に必要な評価データが不足しています。</p>
        {evRows.length > 0 && (
          <EvSection rows={evRows} budget={budget} />
        )}
      </section>
    );
  }

  return (
    <section className="bet-panel" aria-label="買い目提案">
      <h2 className="app__section-title">買い目提案</h2>
      <p className="bet-panel__lead">
        軸馬は <strong>{plan.axisHorse.horseName}</strong>（最終{plan.axisHorse.finalRank ?? plan.axisHorse.adjustedRank ?? "-"}位）です。
      </p>

      <div className="bet-panel__controls">
        <label className="bet-panel__control">
          モード
          <select value={mode} onChange={(e) => setMode(e.target.value as BetMode)}>
            <option value="conservative">守り（回収重視）</option>
            <option value="aggressive">攻め（高配当重視）</option>
          </select>
        </label>
        <label className="bet-panel__control">
          予算（円）
          <input
            type="number"
            min={1000}
            step={100}
            value={budgetInput}
            onChange={(e) => setBudgetInput(e.target.value)}
          />
        </label>
        <label className="bet-panel__control bet-panel__control--check">
          <input
            type="checkbox"
            checked={antiGami}
            onChange={(e) => setAntiGami(e.target.checked)}
          />
          トリガミ防止配分（推定オッズで均等払戻を狙う）
        </label>
      </div>

      <div className="bet-panel__quick-actions">
        <button
          type="button"
          className="bet-panel__quick-btn"
          onClick={() => {
            setBudgetInput("10000");
            setAntiGami(true);
          }}
        >
          資金1万円を最適分配
        </button>
      </div>

      <div className="bet-panel__summary">
        <p>総投資: <strong>{plan.totalStake.toLocaleString()}円</strong></p>
        <p>残額: <strong>{plan.remaining.toLocaleString()}円</strong></p>
        <p>展開反映: <strong>{condition.pace}</strong>（ペース変更で買い目を再構成）</p>
      </div>

      <div className="bet-panel__tickets" key={planKey}>
        {plan.tickets.map((ticket) => (
          <article key={ticket.type} className="bet-ticket">
            <div className="bet-ticket__head">
              <h3>{ticket.type}</h3>
              <div
                className="bet-ticket__donut"
                style={{ ["--p" as string]: `${Math.round((ticket.totalStake / Math.max(plan.totalStake, 1)) * 100)}%` } as CSSProperties}
                aria-label={`投資配分 ${Math.round((ticket.totalStake / Math.max(plan.totalStake, 1)) * 100)}%`}
                title={`投資配分 ${Math.round((ticket.totalStake / Math.max(plan.totalStake, 1)) * 100)}%`}
              >
                <span>{Math.round((ticket.totalStake / Math.max(plan.totalStake, 1)) * 100)}%</span>
              </div>
            </div>
            <p className="bet-ticket__meta">
              {ticket.points}点 / 合計{" "}
              <strong>{ticket.totalStake.toLocaleString()}円</strong>
            </p>
            <p className="bet-ticket__meta">
              推定払戻レンジ:{" "}
              <strong>
                {ticket.minEstimatedReturn.toLocaleString()}円〜{ticket.maxEstimatedReturn.toLocaleString()}円
              </strong>
            </p>
            <p className="bet-ticket__note">{ticket.note}</p>
            <ul className="bet-ticket__list">
              {ticket.items.map((item) => (
                <li key={`${ticket.type}-${item.combo}`}>
                  <span>{item.combo}</span>
                  <span>{item.stake.toLocaleString()}円</span>
                  <span className="bet-ticket__odds">推定{item.estimatedOdds.toFixed(1)}倍</span>
                </li>
              ))}
            </ul>
          </article>
        ))}
      </div>

      {evRows.length > 0 && (
        <EvSection rows={evRows} budget={budget} />
      )}
    </section>
  );
}
