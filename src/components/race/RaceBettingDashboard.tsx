import { useCallback, useMemo, useState } from "react";
import type { HorseAbility, HorseScoreResult, RaceCondition } from "../../domain/race-evaluation";
import { classTierLabelJa } from "../../domain/race-evaluation/resolveEffectiveRaceClass";
import {
  buildRaceBettingContext,
  buildTicketsCopyText,
  formatHorseList,
} from "../../domain/betting/buildRaceBettingContext";
import type { BetTicket } from "../../domain/betting/types";

type Props = {
  results: HorseScoreResult[];
  horses: HorseAbility[];
  condition: RaceCondition;
  betAmount?: number;
};

function ticketLabel(type: BetTicket["ticketType"]): string {
  if (type === "WIN") return "単勝◎";
  if (type === "MAIN_LINE") return "馬連◎○▲（3点BOX）";
  if (type === "WIDE") return "ワイド◎-印";
  return "3連複フォーメーション";
}

function estimateWinReturn(odds: number | undefined, betAmount: number): string {
  if (odds == null || !Number.isFinite(odds) || odds <= 0) return "オッズ未取得";
  const yen = Math.round((betAmount / 100) * odds * 100);
  return `想定払戻 ${yen.toLocaleString()}円（単勝 ${odds.toFixed(1)}倍）`;
}

export function RaceBettingDashboard({ results, horses, condition, betAmount = 100 }: Props) {
  const [copied, setCopied] = useState(false);
  const ctx = useMemo(
    () => buildRaceBettingContext(results, horses, condition, betAmount),
    [results, horses, condition, betAmount],
  );

  const copyText = useMemo(() => (ctx ? buildTicketsCopyText(ctx) : ""), [ctx]);

  const totalInvested = useMemo(() => {
    if (!ctx) return 0;
    return ctx.tickets.reduce((s, t) => s + t.combinations.length * t.betAmount, 0);
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

  if (ctx == null) {
    return (
      <section className="betting-dashboard" aria-label="買い目ダッシュボード">
        <p className="app__meta">印が付いた馬がいないため、買い目を生成できません。</p>
      </section>
    );
  }

  const fav = ctx.favoriteNumber;
  const favName = fav != null ? ctx.horseNameByNumber.get(fav) : undefined;
  const winOdds = fav != null ? ctx.winOddsByNumber.get(fav) : undefined;

  return (
    <section className="betting-dashboard" aria-label="買い目ダッシュボード">
      <header className="betting-dashboard__head">
        <div>
          <h2 className="app__section-title app__section-title--pop">今回の買い目ダッシュボード</h2>
          <p className="app__meta">
            最終印（4角振替・ポートフォリオ補正後）から定型ルールで生成。クラス:{" "}
            {classTierLabelJa(ctx.classTier)}
          </p>
        </div>
        <div className="betting-dashboard__actions">
          <button type="button" className="betting-dashboard__copy" onClick={() => void handleCopy()}>
            {copied ? "コピー済み" : "買い目をコピー"}
          </button>
          <span className="betting-dashboard__total">
            合計 <strong>{totalInvested.toLocaleString()}円</strong>（1点{betAmount}円）
          </span>
        </div>
      </header>

      <div className="bet-card bet-card--formation">
        <h3 className="bet-card__title">3連複フォーメ（1-M-N型）</h3>
        <p className="bet-card__formation">
          1列目: {fav != null ? `${fav}番${favName ?? ""}(◎)` : "—"} ➔ 2列目:{" "}
          {formatHorseList(ctx.secondRow, ctx.horseNameByNumber) || "—"} ➔ 3列目:{" "}
          {formatHorseList(ctx.thirdRow, ctx.horseNameByNumber) || "—"}
        </p>
      </div>

      {ctx.tickets.map((ticket) => {
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
      })}
    </section>
  );
}
