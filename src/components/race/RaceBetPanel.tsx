import { useMemo, useState, type CSSProperties } from "react";
import type { HorseAbility, HorseScoreResult, RaceCondition, InvestmentCommentInput } from "../../domain/race-evaluation";
import { buildBetPlan, type BetMode } from "./betBuilder";

type Props = {
  sorted: HorseScoreResult[];
  horses: HorseAbility[];
  condition: RaceCondition;
  /** 馬場傾向クイック入力から条件を変更するコールバック */
  onConditionChange?: (next: RaceCondition) => void;
};

/** ケリー分率設定 */
type KellyFraction = "full" | "half" | "quarter";
const KELLY_FRACTION_OPTIONS: { key: KellyFraction; label: string; value: number }[] = [
  { key: "full",    label: "フルケリー",   value: 1.0 },
  { key: "half",    label: "ハーフ",       value: 0.5 },
  { key: "quarter", label: "クォーター",   value: 0.25 },
];

// value_rank に応じたバッジスタイル
const VALUE_RANK_STYLE: Record<string, { bg: string; color: string; label: string }> = {
  S: { bg: "#c0392b", color: "#fff", label: "S" },
  A: { bg: "#e67e22", color: "#fff", label: "A" },
  B: { bg: "#27ae60", color: "#fff", label: "B" },
  C: { bg: "#7f8c8d", color: "#fff", label: "C" },
  D: { bg: "#bdc3c7", color: "#555", label: "D" },
};

/**
 * 期待値ヒートマップ: EVに応じた行の背景色グラデーション。
 * EV ≥ 1.25  → 濃緑（「激アツ」バッジ付与）
 * 1.10 ≤ EV < 1.25 → 薄緑
 * 1.00 ≤ EV < 1.10 → 極薄緑
 * EV < 1.00  → 彩度を落としたグレー
 */
function evHeatmapStyle(ev: number, valueRank: string): CSSProperties {
  if (ev >= 1.25 || valueRank === "S") {
    return { background: "rgba(39,174,96,0.20)", borderLeft: "4px solid #1e8449" };
  }
  if (ev >= 1.10) {
    return { background: "rgba(39,174,96,0.10)", borderLeft: "3px solid #27ae60" };
  }
  if (ev >= 1.00) {
    return { background: "rgba(39,174,96,0.05)", borderLeft: "3px solid #a9dfbf" };
  }
  return { background: "rgba(127,140,141,0.06)", borderLeft: "3px solid transparent" };
}

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

/**
 * 期待値バッジ: ランクに応じた「お宝馬」「期待値高」バッジを返す。
 * S: お宝馬（点滅アニメーション付き）
 * A: 期待値高
 * B: 期待値あり
 */
function EvSpecialBadge({ rank, ev }: { rank: string; ev: number }) {
  // EV ≥ 1.25 → 激アツ（Sランク相当 or EV数値で判定）
  if (rank === "S" || ev >= 1.25) {
    return (
      <>
        <span
          className="ev-badge ev-badge--gekiatu"
          title="EV 激アツ: EV 1.25以上の最高評価"
          style={{
            display: "inline-block",
            padding: "0.1em 0.5em",
            borderRadius: "3px",
            background: "#1e8449",
            color: "#fff",
            fontWeight: "bold",
            fontSize: "0.75em",
            marginLeft: "0.3em",
            animation: "ev-pulse 1.4s ease-in-out infinite",
          }}
        >
          🔥激アツ
        </span>
        {rank === "S" && (
          <span
            className="ev-badge ev-badge--treasure"
            title="EV Sランク: 最高評価の期待値馬"
            style={{
              display: "inline-block",
              padding: "0.1em 0.4em",
              borderRadius: "3px",
              background: "#c0392b",
              color: "#fff",
              fontWeight: "bold",
              fontSize: "0.75em",
              marginLeft: "0.2em",
              animation: "ev-pulse 1.4s ease-in-out infinite",
            }}
          >
            ★お宝馬
          </span>
        )}
      </>
    );
  }
  if (rank === "A") {
    return (
      <span
        className="ev-badge ev-badge--high"
        title="EV Aランク: 高い期待値"
        style={{
          display: "inline-block",
          padding: "0.1em 0.4em",
          borderRadius: "3px",
          background: "#e67e22",
          color: "#fff",
          fontWeight: "bold",
          fontSize: "0.75em",
          marginLeft: "0.3em",
        }}
      >
        期待値高
      </span>
    );
  }
  return null;
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

/**
 * ランタイムでトラックバイアスを確率に反映して調整済みEVを返す。
 * buildTime に計算された predictedProbability に枠番・脚質バイアスを乗じて再計算。
 *
 * P_adj = P × gateBiasMultiplier × styleBiasMultiplier（正規化は省略）
 * EV_adj = P_adj × O - margin
 */
function calcRuntimeAdjustedEv(
  inv: InvestmentCommentInput,
  gate: number,
  fieldSize: number,
  condition: RaceCondition,
  evMargin: number,
): { ev: number; adjusted: boolean } {
  const userTrackBias = condition.userTrackBias ?? 0;
  const biasSetting = condition.bias ?? "flat";

  if (Math.abs(userTrackBias) < 0.05 && biasSetting === "flat") {
    return { ev: inv.valueScore ?? 0, adjusted: false };
  }

  const size = Math.max(8, fieldSize);
  const relativePos = gate > 0 ? (gate - 1) / Math.max(size - 1, 1) : 0.5;
  const MAX_CORRECTION = 0.15;
  const gateCorrection = -userTrackBias * (relativePos - 0.5) * MAX_CORRECTION * 2;
  const gateMult = Math.max(0.75, Math.min(1.30, 1.0 + gateCorrection));

  // HorseAbility の runningStyle は inv に含まれないため、
  // スタイルバイアスはゲートバイアスのみで近似（展開傾向は条件設定パネル側で反映済み）
  const styleMult = 1.0;

  const adjProb = Math.min(inv.predictedProbability * gateMult * styleMult, 0.99);
  const adjEv = Math.round((adjProb * inv.actualOdds - evMargin) * 100) / 100;

  return { ev: adjEv, adjusted: true };
}

function EvSection({
  rows,
  budget,
  kellyFraction,
  condition,
}: {
  rows: EvRow[];
  budget: number;
  kellyFraction: number;
  condition: RaceCondition;
}) {
  // 見送りを除いた購入候補
  const candidates = rows.filter((r) => r.investment.betType !== "見送り");
  const fieldSize = rows.length;

  // 動的EVマージン（ランタイム推定: 馬場条件からは判定不能なため、頭数のみ反映）
  const runtimeMargin = fieldSize >= 16 ? 0.20 : 0.15;
  const biasActive = Math.abs(condition.userTrackBias ?? 0) >= 0.05 || condition.bias !== "flat";

  return (
    <div className="bet-panel__ev-section">
      {/* CSS アニメーション定義（お宝馬バッジ用） */}
      <style>{`
        @keyframes ev-pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.5; }
        }
      `}</style>

      <h3 className="bet-panel__ev-title">AIオッズ評価（実質期待値）</h3>
      <p className="bet-panel__ev-desc">
        実質期待値 = (予測確率 × オッズ) − マージン（頭数16+: 0.20、通常: 0.15）。
        ★ヒートマップ: 🔥激アツ(EV≥1.25・濃緑)、薄緑(EV≥1.10)、淡緑(EV≥1.00)、グレー(EV&lt;1.00)。
        {biasActive && (
          <strong style={{ color: "#2980b9" }}> ⚡ 馬場バイアス補正適用中（枠番補正）</strong>
        )}
      </p>

      <table className="bet-panel__ev-table" style={{ width: "100%", borderCollapse: "collapse" }}>
        <thead>
          <tr>
            <th>馬番</th>
            <th>馬名</th>
            <th>EV{biasActive ? "（補正）" : ""}</th>
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
            // ランタイム補正済みEV（馬場バイアス考慮）
            const { ev, adjusted } = calcRuntimeAdjustedEv(inv, row.gate, fieldSize, condition, runtimeMargin);
            const adjustedRank = ev >= 1.40 ? "S" : ev >= 1.25 ? "S" : ev >= 1.10 ? "A" : ev >= 1.0 ? "B" : ev >= 0.90 ? "C" : "D";
            const displayRank = adjusted ? adjustedRank : inv.valueRank;
            const kelly = (inv.kellyWeight ?? 0) * kellyFraction;
            const recommendedAmount = Math.floor((budget * kelly) / 100) * 100;
            const isBuy = inv.betType !== "見送り";
            const judgment = expectationJudgmentLabel({ ...inv, valueRank: displayRank });

            return (
              <tr
                key={row.horseId}
                style={{
                  opacity: isBuy ? 1 : 0.45,
                  ...evHeatmapStyle(ev, displayRank),
                }}
              >
                <td style={{ textAlign: "center" }}>{row.gate}番</td>
                <td>
                  {row.horseName}
                  <EvSpecialBadge rank={displayRank} ev={ev} />
                </td>
                <td style={{ textAlign: "right", fontWeight: "bold", color: ev >= 1.0 ? "#27ae60" : "#e74c3c" }}>
                  {ev.toFixed(2)}
                  {adjusted && (
                    <span style={{ fontSize: "0.7em", color: "#2980b9", marginLeft: "0.2em" }}>↑補</span>
                  )}
                </td>
                <td style={{ textAlign: "center" }}>
                  <EvRankBadge rank={displayRank} />
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
                  const kelly = (r.investment.kellyWeight ?? 0) * kellyFraction;
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

/**
 * 当日馬場傾向クイック入力パネル。
 * 条件設定パネル（RaceAdjustmentPanel）と同じ condition を共有し、
 * 買い目タブ内で素早くバイアスを切り替えられるショートカットUI。
 */
function TrackBiasQuickPanel({
  condition,
  onConditionChange,
}: {
  condition: RaceCondition;
  onConditionChange: (next: RaceCondition) => void;
}) {
  const userBias = condition.userTrackBias ?? 0;
  const currentBias = condition.bias ?? "flat";

  function biasLabel(v: number): string {
    if (v <= -0.8) return "内有利(強)";
    if (v <= -0.3) return "内有利(弱)";
    if (v >= 0.8) return "外有利(強)";
    if (v >= 0.3) return "外有利(弱)";
    return "フラット";
  }

  return (
    <div
      className="bet-panel__track-bias"
      style={{
        padding: "10px 12px",
        background: "var(--surface-2, #f8f9fa)",
        borderRadius: "6px",
        marginBottom: "12px",
        border: "1px solid var(--border, #dee2e6)",
      }}
    >
      <h4 style={{ margin: "0 0 8px", fontSize: "0.9em", fontWeight: "bold" }}>
        ⚡ 当日馬場傾向（クイック入力）
      </h4>
      <p style={{ margin: "0 0 8px", fontSize: "0.78em", color: "#6c757d" }}>
        変更するとEVが即リアルタイム補正されます。詳細は「条件設定」パネルで調整。
      </p>

      {/* 枠バイアス（内外） */}
      <div style={{ marginBottom: "8px" }}>
        <span style={{ fontSize: "0.82em", fontWeight: "bold", marginRight: "6px" }}>
          枠バイアス: {biasLabel(userBias)}
        </span>
        <div style={{ display: "flex", gap: "6px", flexWrap: "wrap", marginTop: "4px" }}>
          {(
            [
              { label: "内有利（強）", value: -1.0 },
              { label: "内有利",       value: -0.5 },
              { label: "フラット",     value: 0 },
              { label: "外有利",       value: 0.5 },
              { label: "外有利（強）", value: 1.0 },
            ] as const
          ).map(({ label, value }) => (
            <button
              key={value}
              type="button"
              onClick={() => onConditionChange({ ...condition, userTrackBias: value })}
              style={{
                padding: "3px 8px",
                fontSize: "0.78em",
                borderRadius: "4px",
                border: "1px solid",
                cursor: "pointer",
                fontWeight: Math.abs(userBias - value) < 0.05 ? "bold" : "normal",
                background: Math.abs(userBias - value) < 0.05 ? "#2980b9" : "transparent",
                color: Math.abs(userBias - value) < 0.05 ? "#fff" : "inherit",
                borderColor: Math.abs(userBias - value) < 0.05 ? "#2980b9" : "#ced4da",
              }}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* 展開バイアス（前残り/差し決着） */}
      <div>
        <span style={{ fontSize: "0.82em", fontWeight: "bold", marginRight: "6px" }}>
          展開傾向:
        </span>
        <div style={{ display: "flex", gap: "6px", flexWrap: "wrap", marginTop: "4px" }}>
          {(
            [
              { label: "前残り",     value: "front_favor" },
              { label: "フラット",   value: "flat" },
              { label: "差し決着",   value: "closer_favor" },
            ] as const
          ).map(({ label, value }) => (
            <button
              key={value}
              type="button"
              onClick={() => onConditionChange({ ...condition, bias: value })}
              style={{
                padding: "3px 8px",
                fontSize: "0.78em",
                borderRadius: "4px",
                border: "1px solid",
                cursor: "pointer",
                fontWeight: currentBias === value ? "bold" : "normal",
                background: currentBias === value ? "#e67e22" : "transparent",
                color: currentBias === value ? "#fff" : "inherit",
                borderColor: currentBias === value ? "#e67e22" : "#ced4da",
              }}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

export function RaceBetPanel({ sorted, horses, condition, onConditionChange }: Props) {
  const [mode, setMode] = useState<BetMode>("conservative");
  const [antiGami, setAntiGami] = useState<boolean>(false);
  const [budgetInput, setBudgetInput] = useState<string>("5000");
  const [kellyFractionKey, setKellyFractionKey] = useState<KellyFraction>("quarter");

  const budget = Number.isFinite(Number(budgetInput)) ? Math.max(1000, Math.round(Number(budgetInput))) : 5000;
  const kellyFractionValue = KELLY_FRACTION_OPTIONS.find((o) => o.key === kellyFractionKey)?.value ?? 0.25;

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

        {onConditionChange && (
          <TrackBiasQuickPanel condition={condition} onConditionChange={onConditionChange} />
        )}
        {evRows.length > 0 && (
          <EvSection
            rows={evRows}
            budget={budget}
            kellyFraction={kellyFractionValue}
            condition={condition}
          />
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

      {/* 馬場傾向クイック入力 */}
      {onConditionChange && (
        <TrackBiasQuickPanel condition={condition} onConditionChange={onConditionChange} />
      )}

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
        {/* ケリー分率セレクター */}
        <div className="bet-panel__control" role="group" aria-label="ケリー分率設定">
          <span style={{ fontSize: "0.85em", display: "block", marginBottom: "4px" }}>
            ケリー分率（リスク調整）
          </span>
          <div style={{ display: "flex", gap: "6px" }}>
            {KELLY_FRACTION_OPTIONS.map((opt) => (
              <button
                key={opt.key}
                type="button"
                onClick={() => setKellyFractionKey(opt.key)}
                style={{
                  padding: "4px 10px",
                  fontSize: "0.82em",
                  borderRadius: "4px",
                  border: "1px solid",
                  cursor: "pointer",
                  fontWeight: kellyFractionKey === opt.key ? "bold" : "normal",
                  background: kellyFractionKey === opt.key ? "#2980b9" : "transparent",
                  color: kellyFractionKey === opt.key ? "#fff" : "inherit",
                  borderColor: kellyFractionKey === opt.key ? "#2980b9" : "#ced4da",
                }}
                title={`${opt.label}: ケリー比率を×${opt.value}倍に調整（${(opt.value * 100).toFixed(0)}%適用）`}
              >
                {opt.label}
              </button>
            ))}
          </div>
          <p style={{ fontSize: "0.75em", color: "#6c757d", margin: "4px 0 0" }}>
            {kellyFractionKey === "full" && "フルケリー: 理論上最大効率。ドローダウンが大きいため上級者向け。"}
            {kellyFractionKey === "half" && "ハーフケリー: フルの半分。ドローダウンを抑えながら効率的な複利成長。"}
            {kellyFractionKey === "quarter" && "クォーターケリー（推奨）: 保守的設定。長期安定運用に最適。"}
          </p>
        </div>

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
        <button
          type="button"
          className="bet-panel__quick-btn"
          onClick={() => {
            setBudgetInput("3000");
            setKellyFractionKey("quarter");
          }}
          style={{ marginLeft: "6px" }}
        >
          少額（3千円）クォーターケリー
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
        <EvSection
          rows={evRows}
          budget={budget}
          kellyFraction={kellyFractionValue}
          condition={condition}
        />
      )}
    </section>
  );
}
