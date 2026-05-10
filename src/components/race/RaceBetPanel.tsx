import { useCallback, useMemo, useState, type CSSProperties } from "react";
import {
  valueRankFromEffectiveEv,
  type HorseAbility,
  type HorseScoreResult,
  type RaceCondition,
  type InvestmentCommentInput,
} from "../../domain/race-evaluation";
import { buildBetPlan, type BetMode } from "./betBuilder";
import type { RaceEvaluationViewModel } from "../../viewModel/raceEvaluationViewModel";
import { EvHeatmap } from "./EvHeatmap";
import { formatPredictedTop3Percent } from "./predictedTop3Display";
type Props = {
  sorted: HorseScoreResult[];
  horses: HorseAbility[];
  condition: RaceCondition;
  viewModel?: RaceEvaluationViewModel;
  /** 馬場傾向クイック入力から条件を変更するコールバック */
  onConditionChange?: (next: RaceCondition) => void;
};

/** 資金配分率設定 */
type KellyFraction = "full" | "half" | "quarter";
const KELLY_FRACTION_OPTIONS: { key: KellyFraction; label: string; value: number }[] = [
  { key: "full",    label: "攻め",   value: 1.0 },
  { key: "half",    label: "バランス", value: 0.5 },
  { key: "quarter", label: "堅実", value: 0.25 },
];

// value_rank に応じたバッジスタイル
const VALUE_RANK_STYLE: Record<string, { bg: string; color: string; label: string }> = {
  S: { bg: "#c0392b", color: "#fff", label: "S" },
  A: { bg: "#e67e22", color: "#fff", label: "A" },
  B: { bg: "#27ae60", color: "#fff", label: "B" },
  C: { bg: "#4b5d54", color: "#fff", label: "C" },
  D: { bg: "#374151", color: "#f9fafb", label: "D" },
};

/** オッズ補正スコア帯に応じた短文ラベル（value_rank より数値を優先）。 */
function expectationJudgmentLabel(inv: InvestmentCommentInput): { text: string; color?: string } {
  const evPrimary = inv.finalExpectedValue ?? inv.valueScore ?? 0;
  const vr = valueRankFromEffectiveEv(evPrimary);
  if (vr === "S" || vr === "A") {
    return { text: "【スコア高】", color: "#c0392b" };
  }
  if (vr === "B") {
    return { text: "【スコア中】", color: "#27ae60" };
  }
  if (vr === "C") {
    return { text: "【スコア控えめ】" };
  }
  return { text: "【スコア低】" };
}

/**
 * 補正スコアが高い馬向けバッジ（オッズ×確率ベース）。
 */
function EvSpecialBadge({ rank, ev }: { rank: string; ev: number }) {
  if (rank === "S" || ev >= 1.2) {
    return (
      <>
        <span
          className="ev-badge ev-badge--gekiatu"
          title="スコア激アツ: 補正スコアまたは JSON の期待値が 1.2 以上"
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
            title="S帯: 補正スコアが最上位クラス"
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
        title="A帯: 補正スコアが高め"
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
        スコア高
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
  rows.sort((a, b) => a.gate - b.gate || a.horseId.localeCompare(b.horseId));
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
 * 単勝勝率 P：`finalEvaluationScore` 由来の ViewModel（同一レース softmax）のみ。
 */
function winShareProbabilityForEv(row: EvRow, viewModel?: RaceEvaluationViewModel): number {
  const p = viewModel?.byHorseId.get(row.horseId)?.adjustedWinProbability;
  if (p != null && Number.isFinite(p) && p >= 0) return p;
  return row.investment.predictedProbability;
}

function EvSection({
  rows,
  budget,
  kellyFraction,
  viewModel,
}: {
  rows: EvRow[];
  budget: number;
  kellyFraction: number;
  viewModel?: RaceEvaluationViewModel;
}) {
  // 見送りを除いた購入候補
  const candidates = rows.filter((r) => r.investment.betType !== "見送り");
  const runtimeMargin = rows.length >= 16 ? 0.20 : 0.15;
  return (
    <div className="bet-panel__ev-section">
      {/* CSS アニメーション定義（お宝馬バッジ用） */}
      <style>{`
        @keyframes ev-pulse {
          0%, 100% { filter: brightness(1); }
          50% { filter: brightness(1.15); }
        }
      `}</style>

      <h3 className="bet-panel__ev-title">AIオッズ評価（補正スコア）</h3>
      <p className="bet-panel__ev-desc">
        <strong>表示の「3着内率」</strong>は JSON の <strong>predicted_probability</strong> で、単勝確率から変換した参考値です。
        <strong>点数</strong>（補正後スコアの比例）は別系列のため、高得点でもこの％が低いことがあります。
        単勝シェア（期待値計算・ランキング）は <strong>finalEvaluationScore</strong> を softmax した確率のみを使用します。
        <strong>補正スコア</strong>列は enrich が保存した <strong>final_expected_value</strong> です。オッズ歪みブーストは適用しません。
      </p>

      <div className="bet-panel__ev-table-wrap">
        <table className="bet-panel__ev-table">
          <thead>
          <tr>
            <th>馬番</th>
            <th>馬名</th>
            <th>補正スコア</th>
            <th>ランク</th>
            <th>3着内率</th>
            <th>オッズ</th>
            <th>推奨配分</th>
            <th>推奨額</th>
            <th>スコア判断</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const inv = row.investment;
            const winShareP = winShareProbabilityForEv(row, viewModel);
            const computedEv = Math.round((winShareP * inv.actualOdds - runtimeMargin) * 100) / 100;
            const ev =
              inv.finalExpectedValue != null && Number.isFinite(inv.finalExpectedValue)
                ? inv.finalExpectedValue
                : computedEv;
            const adjustedRank = ev >= 1.40 ? "S" : ev >= 1.25 ? "S" : ev >= 1.10 ? "A" : ev >= 1.0 ? "B" : ev >= 0.90 ? "C" : "D";
            const displayRank = adjustedRank;
            const runtimeKelly = viewModel?.byHorseId.get(row.horseId)?.kellyFraction ?? inv.kellyWeight ?? 0;
            const kelly = runtimeKelly * kellyFraction;
            const recommendedAmount = Math.floor((budget * kelly) / 100) * 100;
            const judgment = expectationJudgmentLabel({ ...inv, valueRank: displayRank });

            return (
              <tr key={row.horseId}>
                <td style={{ textAlign: "center" }}>{row.gate}番</td>
                <td>
                  {row.horseName}
                  <EvSpecialBadge rank={displayRank} ev={ev} />
                </td>
                <td
                  className="bet-panel__ev-num"
                  style={{ color: ev >= 1.0 ? "var(--ev-pos)" : "var(--ev-neg)" }}
                >
                  <strong>{ev.toFixed(2)}</strong>
                  <span className="bet-panel__ev-adj">再計算</span>
                </td>
                <td style={{ textAlign: "center" }}>
                  <EvRankBadge rank={displayRank} />
                </td>
                <td
                  style={{ textAlign: "right" }}
                  title="predicted_probability（単勝確率由来・点数とは別ルート）。AI予想・出馬表と同じ。"
                >
                  {formatPredictedTop3Percent(inv)}
                </td>
                <td style={{ textAlign: "right" }}>
                  {inv.actualOdds.toFixed(1)}倍
                  {inv.oddsSource === "estimated" && <span className="bet-panel__ev-est"> 推定</span>}
                </td>
                <td className={kelly > 0 ? "bet-panel__ev-kelly" : undefined}>
                  {kelly > 0 ? `${(kelly * 100).toFixed(1)}%` : "—"}
                </td>
                <td style={{ textAlign: "right", fontWeight: kelly > 0 ? "bold" : "normal" }}>
                  {recommendedAmount > 0 ? `${recommendedAmount.toLocaleString()}円` : "—"}
                </td>
                <td
                  style={{
                    textAlign: "center",
                    ...(judgment.color ? { color: judgment.color } : {}),
                    fontWeight: "bold",
                  }}
                >
                  {judgment.text}
                </td>
              </tr>
            );
          })}
          </tbody>
        </table>
      </div>

      {candidates.length === 0 ? (
        <p className="bet-panel__ev-no-bet">
          補正スコア上、「見送り」以外の馬がいません（推奨割合の対象なし）。
        </p>
      ) : (
        <div className="bet-panel__ev-summary">
          <p>
            購入候補: <strong>{candidates.length}頭</strong>
            {" ／ "}
            合計推奨購入額:
            <strong>
              {" "}
              {candidates
                .reduce((sum, r) => {
                  const runtimeKelly = viewModel?.byHorseId.get(r.horseId)?.kellyFraction ?? r.investment.kellyWeight ?? 0;
                  const kelly = runtimeKelly * kellyFraction;
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
  const currentBias = condition.bias ?? "flat";
  const favN = condition.favoredHorseNumbers?.length ?? 0;
  const disN = condition.disfavoredHorseNumbers?.length ?? 0;

  return (
    <div className="bet-panel__track-bias">
      <h4>⚡ 当日馬場傾向（クイック入力）</h4>
      <p className="bet-panel__track-bias-desc">
        変更するとオッズ補正スコアが即リアルタイム更新されます。馬番ごとの有利・不利は「補正パネル」詳細の 1〜18
        ボタンで指定してください（現在: 有利{favN}件・不利{disN}件）。
      </p>

      {/* 展開バイアス（前残り/差し決着） */}
      <div>
        <span style={{ fontSize: "0.82em", fontWeight: "bold", marginRight: "6px" }}>
          展開傾向:
        </span>
        <div className="bet-panel__chip-row">
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
                borderColor: currentBias === value ? "#e67e22" : "var(--c-border)",
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

export function RaceBetPanel({ sorted, horses, condition, viewModel, onConditionChange }: Props) {
  const [mode, setMode] = useState<BetMode>("conservative");
  const [antiGami, setAntiGami] = useState<boolean>(false);
  const [budgetInput, setBudgetInput] = useState<string>("5000");
  const [kellyFractionKey, setKellyFractionKey] = useState<KellyFraction>("quarter");
  const [copyState, setCopyState] = useState<"idle" | "done" | "failed">("idle");

  const budget = Number.isFinite(Number(budgetInput)) ? Math.max(1000, Math.round(Number(budgetInput))) : 5000;
  const kellyFractionValue = KELLY_FRACTION_OPTIONS.find((o) => o.key === kellyFractionKey)?.value ?? 0.25;

  const plan = useMemo(
    () => buildBetPlan(sorted, horses, condition, mode, budget, antiGami),
    [antiGami, budget, condition, horses, mode, sorted],
  );
  const evRows = useMemo(() => buildEvRows(sorted, horses), [sorted, horses]);
  const copyPayload = useMemo(() => {
    const runtimeMargin = evRows.length >= 16 ? 0.2 : 0.15;
    const lines = evRows
      .map((row) => {
        const winShareP = winShareProbabilityForEv(row, viewModel);
        const odds = row.investment.actualOdds;
        const kelly = (viewModel?.byHorseId.get(row.horseId)?.kellyFraction ?? row.investment.kellyWeight ?? 0) * kellyFractionValue;
        const amount = Math.floor((budget * kelly) / 100) * 100;
        const ev = winShareP * odds - runtimeMargin;
        if (amount <= 0) return null;
        const top3pct = (row.investment.predictedProbability * 100).toFixed(1);
        return {
          gate: row.gate,
          line: `馬番${row.gate}：複勝 ${amount.toLocaleString()}円（スコア ${ev.toFixed(2)} / 3着内 ${top3pct}%）`,
          amount,
        };
      })
      .filter((v): v is { gate: number; line: string; amount: number } => v != null)
      .sort((a, b) => b.amount - a.amount);
    return [
      `総予算: ${budget.toLocaleString()}円`,
      `リスク設定: ${KELLY_FRACTION_OPTIONS.find((o) => o.key === kellyFractionKey)?.label ?? "クォーター"}`,
      ...lines.map((l) => l.line),
    ].join("\n");
  }, [budget, evRows, kellyFractionKey, kellyFractionValue, viewModel]);
  const handleCopyInstructions = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(copyPayload);
      setCopyState("done");
    } catch {
      setCopyState("failed");
    } finally {
      setTimeout(() => setCopyState("idle"), 1800);
    }
  }, [copyPayload]);
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
          <EvSection rows={evRows} budget={budget} kellyFraction={kellyFractionValue} viewModel={viewModel} />
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
        {/* 資金配分セレクター */}
        <div className="bet-panel__control" role="group" aria-label="資金配分スタイル設定">
          <span className="bet-panel__kelly-label">資金配分スタイル（リスク調整）</span>
          <div className="bet-panel__kelly-row">
            {KELLY_FRACTION_OPTIONS.map((opt) => (
              <button
                key={opt.key}
                type="button"
                className={`bet-panel__kelly-opt${kellyFractionKey === opt.key ? " bet-panel__kelly-opt--active" : ""}`}
                onClick={() => setKellyFractionKey(opt.key)}
                title={`${opt.label}: 推奨配分率を×${opt.value}倍に調整（${(opt.value * 100).toFixed(0)}%適用）`}
              >
                {opt.label}
              </button>
            ))}
          </div>
          <p className="bet-panel__kelly-hint">
            {kellyFractionKey === "full" && "攻め配分: 的中時の伸びは大きい一方、ブレも大きい設定です。"}
            {kellyFractionKey === "half" && "バランス配分: 攻めと守りの中間で、迷ったらここから。"}
            {kellyFractionKey === "quarter" && "堅実配分（推奨）: 購入額を抑えて、安定重視で運用する設定です。"}
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
        >
          少額（3千円）堅実配分
        </button>
        <button
          type="button"
          className="bet-panel__quick-btn"
          onClick={() => void handleCopyInstructions()}
        >
          投票指示をコピー
        </button>
      </div>
      {copyState !== "idle" && (
        <p className="bet-panel__copy-hint">
          {copyState === "done" ? "コピーしました。投票画面へ貼り付けできます。" : "コピーに失敗しました。"}
        </p>
      )}

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
        <>
          <EvHeatmap
            rows={evRows.map((row) => ({
              horseId: row.horseId,
              horseName: row.horseName,
              effectiveEv:
                row.investment.finalExpectedValue ??
                viewModel?.byHorseId.get(row.horseId)?.effectiveEv ??
                row.investment.valueScore ??
                null,
            }))}
          />
          <EvSection rows={evRows} budget={budget} kellyFraction={kellyFractionValue} viewModel={viewModel} />
        </>
      )}
    </section>
  );
}
