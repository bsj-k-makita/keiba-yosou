import { useCallback, useEffect, useMemo, useState } from "react";
import type { HorseAbility, HorseScoreResult, RaceCondition } from "../../domain/race-evaluation";
import { resolvePlaceToHorseId } from "../../domain/race-evaluation/markHitAnalysis";
import { getEffectiveEvaluationSignals } from "../../domain/race-evaluation/resolveEvaluationSignals";
import {
  buildRaceBettingContext,
  buildTicketsCopyText,
} from "../../domain/betting/buildRaceBettingContext";
import { buildPayoutFallbackOddsMap } from "../../domain/betting/bettingRules";
import { calculateRacePayout, checkOfficialHit } from "../../domain/betting/payoutCalculator";
import { ticketResultText } from "../../domain/betting/ticketOutcomeDisplay";
import { BET_TICKET_TYPES, type BetTicket, type BetTicketType } from "../../domain/betting/types";
import type { ProbabilityEngine } from "../../lib/pipeline/probabilityEngine";
import { ensureRaceResultFetched } from "../../lib/race-data";
import type { RaceResultData } from "../../lib/race-data/raceEvaluationTypes";

type Props = {
  raceId: string;
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
  return "3連複フォーメ";
}

function buildProbByGate(horses: HorseAbility[]): Map<number, number> {
  const probByGate = new Map<number, number>();
  for (const h of horses) {
    const gate = (h as HorseAbility & { gate?: number }).gate;
    if (gate == null || !Number.isFinite(gate)) continue;
    const g = Math.round(gate);
    const fromAi = h.aiPredictedWinRate;
    if (fromAi != null && fromAi > 0) {
      probByGate.set(g, fromAi);
      continue;
    }
    const winOdds = getEffectiveEvaluationSignals(h)?.winOdds;
    if (winOdds != null && winOdds > 0) probByGate.set(g, 1 / winOdds);
  }
  return probByGate;
}

function estimateWinReturn(odds: number | undefined, betAmount: number): string {
  if (odds == null || !Number.isFinite(odds) || odds <= 0) return "オッズ未取得";
  const yen = Math.round((betAmount / 100) * odds * 100);
  return `想定払戻 ${yen.toLocaleString()}円（単勝 ${odds.toFixed(1)}倍）`;
}

function isHitByFinishOrder(type: BetTicketType, comb: number[], finishOrder: number[]): boolean {
  if (type === "WIN") return finishOrder[0] === comb[0];
  if (type === "MAIN_LINE") {
    const top2 = new Set(finishOrder.slice(0, 2));
    return top2.has(comb[0]!) && top2.has(comb[1]!);
  }
  if (type === "WIDE") {
    const top3 = new Set(finishOrder.slice(0, 3));
    return top3.has(comb[0]!) && top3.has(comb[1]!);
  }
  const top3 = new Set(finishOrder.slice(0, 3));
  return top3.has(comb[0]!) && top3.has(comb[1]!) && top3.has(comb[2]!);
}

type PayoutTableProps = {
  payoutRow: NonNullable<ReturnType<typeof calculateRacePayout>>;
  ticketGroups: Map<BetTicketType, BetTicket[]>;
  finishOrder: number[];
  officialPayouts: RaceResultData["payouts"] | undefined;
};

function PayoutSummaryTable({
  payoutRow,
  ticketGroups,
  finishOrder,
  officialPayouts,
}: PayoutTableProps) {
  return (
    <table className="horse-list result-analysis-view__table" style={{ marginTop: "0.75rem" }}>
      <thead>
        <tr>
          <th>券種</th>
          <th>投資</th>
          <th>払戻</th>
          <th>回収率</th>
          <th>結果</th>
        </tr>
      </thead>
      <tbody>
        {BET_TICKET_TYPES.filter((type) => payoutRow.byType[type].invested > 0).map((type) => {
          const d = payoutRow.byType[type];
          const isHit = d.hitCount > 0;
          const groupedTickets = ticketGroups.get(type) ?? [];
          const combinations = groupedTickets.flatMap((t) => t.combinations);
          const hasOfficialPool =
            type === "WIN"
              ? (officialPayouts?.WIN.length ?? 0) > 0
              : type === "MAIN_LINE"
                ? (officialPayouts?.REN.length ?? 0) > 0
                : type === "WIDE"
                  ? (officialPayouts?.WREN.length ?? 0) > 0
                  : (officialPayouts?.TRI.length ?? 0) > 0;
          return (
            <tr
              key={type}
              className={
                isHit ? "result-analysis-view__row--hit" : "result-analysis-view__row--miss"
              }
            >
              <td>
                {ticketLabel(type)}
                <div className="result-analysis-view__comb-list">
                  {combinations.map((comb, idx) => (
                    <span
                      key={`${type}-${comb.join("-")}-${idx}`}
                      className={`result-analysis-view__comb-chip${
                        checkOfficialHit(type, comb, officialPayouts) ||
                        (!hasOfficialPool && isHitByFinishOrder(type, comb, finishOrder))
                          ? " result-analysis-view__comb-chip--hit"
                          : ""
                      }`}
                    >
                      {comb.join("-")}
                    </span>
                  ))}
                </div>
              </td>
              <td>{d.invested.toLocaleString()}円</td>
              <td>{d.payout.toLocaleString()}円</td>
              <td className={d.rate >= 100 ? "result-analysis-view__rate--plus" : ""}>{d.rate}%</td>
              <td>{ticketResultText(isHit, d.payout)}</td>
            </tr>
          );
        })}
        <tr className="result-analysis-view__row--total">
          <td>合計</td>
          <td>{payoutRow.totalInvested.toLocaleString()}円</td>
          <td>{payoutRow.totalPayout.toLocaleString()}円</td>
          <td
            className={
              payoutRow.totalInvested > 0 &&
              payoutRow.totalPayout / payoutRow.totalInvested >= 1
                ? "result-analysis-view__rate--plus"
                : ""
            }
          >
            {payoutRow.totalInvested > 0
              ? Math.round((payoutRow.totalPayout / payoutRow.totalInvested) * 1000) / 10
              : 0}
            %
          </td>
          <td>{payoutRow.totalPayout > 0 ? "🎯" : "—"}</td>
        </tr>
      </tbody>
    </table>
  );
}

export function RaceBettingDashboard({
  raceId,
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
  const [autoResult, setAutoResult] = useState<RaceResultData | null>(null);
  const [resultLoading, setResultLoading] = useState(true);
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
    return ctx.formationTickets.reduce((s, t) => s + t.combinations.length * t.betAmount, 0);
  }, [ctx]);

  useEffect(() => {
    setResultLoading(true);
    void (async () => {
      const data = await ensureRaceResultFetched(raceId);
      setAutoResult(data);
      setResultLoading(false);
    })();
  }, [raceId]);

  const finishOrder = useMemo(() => {
    if (!ctx || !autoResult || autoResult.places.length < 3) return [];
    const sorted = [...autoResult.places].sort((a, b) => a.place - b.place);
    const out: number[] = [];
    for (const p of sorted) {
      const hid = resolvePlaceToHorseId(p, horses);
      const num =
        (hid != null ? ctx.horseNumberById.get(hid) : undefined) ??
        ((p as { horseNumber?: number }).horseNumber != null &&
        Number.isFinite((p as { horseNumber?: number }).horseNumber)
          ? (p as { horseNumber?: number }).horseNumber
          : undefined);
      if (num != null) out.push(num);
    }
    return out;
  }, [ctx, autoResult, horses]);

  const payoutRow = useMemo(() => {
    if (!ctx || finishOrder.length < 3 || ctx.formationTickets.length === 0) return null;
    const probByGate = buildProbByGate(horses);
    return calculateRacePayout(ctx.formationTickets, {
      raceId,
      classLevel: ctx.classLevel,
      finishOrder,
      winOddsByNumber: ctx.winOddsByNumber,
      officialPayouts: autoResult?.payouts,
      fallbackExoticOdds: buildPayoutFallbackOddsMap(horses, autoResult?.payouts, probByGate),
    });
  }, [ctx, finishOrder, raceId, autoResult?.payouts, horses]);

  const ticketGroups = useMemo(() => {
    const byType = new Map<BetTicketType, BetTicket[]>();
    for (const type of BET_TICKET_TYPES) byType.set(type, []);
    for (const ticket of ctx?.formationTickets ?? []) {
      byType.get(ticket.ticketType)?.push(ticket);
    }
    return byType;
  }, [ctx]);

  const markByNumber = useMemo(() => {
    const map = new Map<number, string>();
    if (!ctx) return map;
    for (const m of ctx.marks) map.set(m.horseNumber, m.mark);
    return map;
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

  if (ctx.formationTickets.length === 0) {
    return (
      <section className="betting-dashboard" aria-label="買い目ダッシュボード">
        <p className="app__meta">◎印がないため、買い目を生成できません。</p>
      </section>
    );
  }

  const pointCount = ctx.formationTickets.reduce((s, t) => s + t.combinations.length, 0);
  const fav = ctx.favoriteNumber;
  const winOdds = fav != null ? ctx.winOddsByNumber.get(fav) : undefined;

  return (
    <section className="betting-dashboard" aria-label="買い目ダッシュボード">
      <header className="betting-dashboard__head">
        <div>
          <h2 className="app__section-title app__section-title--pop">今回の買い目ダッシュボード</h2>
          <p className="app__meta">
            単勝・馬連・ワイド・3連複（各{betAmount}円） / {pointCount}点 / 合計投資{" "}
            <strong>{totalInvested.toLocaleString()}円</strong>
          </p>
        </div>
        <div className="betting-dashboard__actions">
          <button type="button" className="betting-dashboard__copy" onClick={() => void handleCopy()}>
            {copied ? "コピー済み" : "買い目をコピー"}
          </button>
        </div>
      </header>

      {ctx.formationTickets.map((ticket) => {
        const invested = ticket.combinations.length * ticket.betAmount;
        const comboPreview = ticket.combinations
          .slice(0, 12)
          .map((c) =>
            c
              .map((n) => {
                const mark = markByNumber.get(n);
                return mark ? `${n}(${mark})` : `${n}`;
              })
              .join("-"),
          )
          .join(" / ");
        const comboMore =
          ticket.combinations.length > 12 ? ` …他${ticket.combinations.length - 12}点` : "";

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

      {resultLoading ? (
        <p className="app__meta">結果を確認中…</p>
      ) : payoutRow == null ? (
        <p className="app__meta">結果未確定のため、的中判定はまだ表示できません。</p>
      ) : (
        <PayoutSummaryTable
          payoutRow={payoutRow}
          ticketGroups={ticketGroups}
          finishOrder={finishOrder}
          officialPayouts={autoResult?.payouts}
        />
      )}
    </section>
  );
}
