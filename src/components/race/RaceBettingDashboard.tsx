import { useCallback, useMemo, useState } from "react";
import type { HorseAbility, HorseScoreResult, RaceCondition } from "../../domain/race-evaluation";
import { classTierLabelJa } from "../../domain/race-evaluation/resolveEffectiveRaceClass";
import {
  buildRaceBettingContext,
  buildTicketsCopyText,
} from "../../domain/betting/buildRaceBettingContext";
import type { BetTicket } from "../../domain/betting/types";
import {
  probabilityEngineLabel,
  type ProbabilityEngine,
} from "../../lib/pipeline/probabilityEngine";
import { NO_EV_REGIME_BANNER_TEXT } from "../../lib/pipeline/aiEvRegime";

type Props = {
  results: HorseScoreResult[];
  horses: HorseAbility[];
  condition: RaceCondition;
  betAmount?: number;
  adjustedProbabilities?: ReadonlyMap<string, number>;
  isSkippableRace?: boolean;
  probabilityEngine?: ProbabilityEngine;
  noAiEvRegime?: boolean;
};

function ticketLabel(type: BetTicket["ticketType"]): string {
  if (type === "WIN") return "単勝◎";
  if (type === "MAIN_LINE") return "馬連◎○";
  if (type === "WIDE") return "ワイド◎-印";
  return "3連複";
}

function estimateWinReturn(odds: number | undefined, betAmount: number): string {
  if (odds == null || !Number.isFinite(odds) || odds <= 0) return "オッズ未取得";
  const yen = Math.round((betAmount / 100) * odds * 100);
  return `想定払戻 ${yen.toLocaleString()}円（単勝 ${odds.toFixed(1)}倍）`;
}

export function RaceBettingDashboard({
  results,
  horses,
  condition,
  betAmount = 100,
  adjustedProbabilities,
  isSkippableRace,
  probabilityEngine = "ts",
  noAiEvRegime = false,
}: Props) {
  const [copied, setCopied] = useState(false);
  const ctx = useMemo(
    () =>
      buildRaceBettingContext(results, horses, condition, betAmount, {
        adjustedProbabilities,
        isSkippableRace,
        probabilityEngine,
        noAiEvRegime,
      }),
    [
      results,
      horses,
      condition,
      betAmount,
      adjustedProbabilities,
      isSkippableRace,
      probabilityEngine,
      noAiEvRegime,
    ],
  );

  const copyText = useMemo(() => (ctx ? buildTicketsCopyText(ctx) : ""), [ctx]);

  const totalInvested = useMemo(() => {
    if (!ctx) return 0;
    return ctx.evTickets.reduce((s, t) => s + t.combinations.length * t.betAmount, 0);
  }, [ctx]);

  const handleCopy = useCallback(async () => {
    if (!copyText) return;
    try {
      await navigator.clipboard.writeText(copyText);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      // ignore
    }
  }, [copyText]);

  if (ctx == null || ctx.marks.length === 0) {
    return (
      <section className="betting-dashboard" aria-label="買い目ダッシュボード">
        <p className="app__meta">印が付いた馬がいないため、買い目を生成できません。</p>
      </section>
    );
  }

  const evPointCount = ctx.evTickets.reduce((s, t) => s + t.combinations.length, 0);
  const isEvSkip = evPointCount === 0;

  const fav = ctx.favoriteNumber;
  const winOdds = fav != null ? ctx.winOddsByNumber.get(fav) : undefined;

  return (
    <section className="betting-dashboard" aria-label="買い目ダッシュボード">
      {noAiEvRegime ? (
        <div className="ai-no-ev-banner ai-no-ev-banner--inline" role="status">
          <p className="ai-no-ev-banner__text">{NO_EV_REGIME_BANNER_TEXT}</p>
        </div>
      ) : null}
      <header className="betting-dashboard__head">
        <div>
          <h2 className="app__section-title app__section-title--pop">今回の買い目ダッシュボード</h2>
          <p className="app__meta">
            EV推奨券のみ表示。クラス: {classTierLabelJa(ctx.classTier)}
            {isEvSkip ? " / EV推奨なし（見送り）" : ` / EV推奨 ${evPointCount}点`}
            {" / 勝率: "}
            {probabilityEngineLabel(probabilityEngine)}
            {probabilityEngine === "ai" ? "（ai_*）" : ""}
          </p>
        </div>
        {!isEvSkip ? (
          <div className="betting-dashboard__actions">
            <button type="button" className="betting-dashboard__copy" onClick={() => void handleCopy()}>
              {copied ? "コピー済み" : "買い目をコピー"}
            </button>
            <span className="betting-dashboard__total">
              合計 <strong>{totalInvested.toLocaleString()}円</strong>（1点{betAmount}円）
            </span>
          </div>
        ) : null}
      </header>

      {isEvSkip ? (
        <p className="result-analysis-view__ev-skip">
          投資: 0円 / 払戻: 0円 / 回収率: 0%（見送り判定成功）
        </p>
      ) : (
        ctx.evTickets.map((ticket) => {
          const invested = ticket.combinations.length * ticket.betAmount;
          const comboPreview = ticket.combinations
            .slice(0, 12)
            .map((c) => c.join("-"))
            .join(" / ");
          const comboMore =
            ticket.combinations.length > 12
              ? ` …他${ticket.combinations.length - 12}点`
              : "";

          return (
            <article key={ticket.ticketType} className="bet-card">
              <h3 className="bet-card__title">【{ticketLabel(ticket.ticketType)}】</h3>
              <p className="bet-card__combos">
                {comboPreview}
                {comboMore}
              </p>
              <div className="bet-card__stats">
                <span>購入点数: {ticket.combinations.length}点</span>
                <span>投資額: {invested.toLocaleString()}円</span>
                {ticket.ticketType === "WIN" && (
                  <span className="bet-card__odds">{estimateWinReturn(winOdds, ticket.betAmount)}</span>
                )}
              </div>
            </article>
          );
        })
      )}
    </section>
  );
}
