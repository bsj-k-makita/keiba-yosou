import { useEffect, useMemo, useState } from "react";
import type { HorseAbility, HorseScoreResult, RaceCondition } from "../../domain/race-evaluation";
import { resolvePlaceToHorseId } from "../../domain/race-evaluation/markHitAnalysis";
import { buildRaceBettingContext } from "../../domain/betting/buildRaceBettingContext";
import { calculateRacePayout, lookupOfficialDividend } from "../../domain/betting/payoutCalculator";
import type { RaceOfficialPayoutRow } from "../../lib/race-data/raceEvaluationTypes";
import { analyzeSecondRowStatus } from "../../domain/betting/secondRowAnalysis";
import { computeFormationHits } from "../../domain/betting/markFormationHits";
import {
  formationHitForType,
  isTicketDisplayHit,
  ticketResultText,
} from "../../domain/betting/ticketOutcomeDisplay";
import { BET_TICKET_TYPES, type BetTicketType } from "../../domain/betting/types";
import { ensureRaceResultFetched } from "../../lib/race-data";
import type { RaceResultData } from "../../lib/race-data/raceEvaluationTypes";
import { NetkeibaRaceLinks } from "./NetkeibaRaceLinks";
import { FinishPlaceLabel } from "./FinishPlaceLabel";

type ManualPlaces = Partial<Record<"1" | "2" | "3" | "4", string>>;

function storageKey(raceId: string) {
  return `race-result:${raceId}`;
}

function loadManualResult(raceId: string): ManualPlaces | null {
  try {
    const raw = localStorage.getItem(storageKey(raceId));
    return raw ? (JSON.parse(raw) as ManualPlaces) : null;
  } catch {
    return null;
  }
}

function saveManualResult(raceId: string, places: ManualPlaces) {
  try {
    localStorage.setItem(storageKey(raceId), JSON.stringify(places));
  } catch {
    // ignore
  }
}

function clearManualResult(raceId: string) {
  try {
    localStorage.removeItem(storageKey(raceId));
  } catch {
    // ignore
  }
}

function ticketTypeName(t: BetTicketType): string {
  if (t === "WIN") return "単勝◎";
  if (t === "MAIN_LINE") return "馬連◎○▲";
  if (t === "WIDE") return "ワイド◎-印";
  return "3連複フォーメ";
}

function formatOfficialPayoutRow(row: RaceOfficialPayoutRow): string {
  return `${row.numbers.join("-")} … ${row.dividend.toLocaleString()}円`;
}

function horseNumberForPlace(
  place: { horseId?: string; horseNumber?: number },
  horseNumberById: Map<string, number>,
): number | undefined {
  if (place.horseNumber != null) return place.horseNumber;
  if (place.horseId) return horseNumberById.get(place.horseId);
  return undefined;
}

function buildFinishOrder(
  places: { place: number; horseId?: string; horseName?: string; horseNumber?: number }[],
  horses: HorseAbility[],
  numberById: Map<string, number>,
): number[] {
  const sorted = [...places].sort((a, b) => a.place - b.place);
  const out: number[] = [];
  for (const p of sorted) {
    const hid = resolvePlaceToHorseId(p, horses);
    if (!hid) continue;
    const num = numberById.get(hid);
    if (num != null) out.push(num);
  }
  return out;
}

type Props = {
  raceId: string;
  results: HorseScoreResult[];
  horses: HorseAbility[];
  condition: RaceCondition;
  adjustedProbabilities?: ReadonlyMap<string, number>;
  isSkippableRace?: boolean;
};

export function RaceResultAnalysis({
  raceId,
  results,
  horses,
  condition,
  adjustedProbabilities,
  isSkippableRace,
}: Props) {
  const [autoResult, setAutoResult] = useState<RaceResultData | null>(null);
  const [autoLoading, setAutoLoading] = useState(true);
  const [manualPlaces, setManualPlaces] = useState<ManualPlaces>(() => loadManualResult(raceId) ?? {});
  const [manualSubmitted, setManualSubmitted] = useState(() => loadManualResult(raceId) != null);

  useEffect(() => {
    setAutoLoading(true);
    void (async () => {
      const data = await ensureRaceResultFetched(raceId);
      if (data != null) {
        setAutoResult(data);
        if (loadManualResult(raceId) != null) {
          clearManualResult(raceId);
          setManualPlaces({});
          setManualSubmitted(false);
        }
      } else {
        setAutoResult(null);
      }
      setAutoLoading(false);
    })();
  }, [raceId]);

  const markByHorseId = useMemo(() => {
    const m = new Map<string, string>();
    for (const r of results) {
      if (r.mark) m.set(r.horseId, r.mark);
    }
    return m;
  }, [results]);

  const ctx = useMemo(
    () =>
      buildRaceBettingContext(results, horses, condition, 100, {
        adjustedProbabilities,
        isSkippableRace,
      }),
    [results, horses, condition, adjustedProbabilities, isSkippableRace],
  );

  const activePlaces = useMemo(() => {
    if (autoResult) return autoResult.places;
    if (manualSubmitted) {
      return [1, 2, 3, 4]
        .map((place) => {
          const horseId = manualPlaces[String(place) as "1" | "2" | "3" | "4"];
          if (!horseId) return null;
          const horse = horses.find((h) => h.horseId === horseId);
          return {
            place,
            horseId,
            horseName: horse?.horseName ?? "",
            time: "",
            margin: null,
          };
        })
        .filter((p): p is NonNullable<typeof p> => p != null);
    }
    return [];
  }, [autoResult, manualSubmitted, manualPlaces, horses]);

  const finishOrder = useMemo(() => {
    if (!ctx || activePlaces.length < 3) return [];
    return buildFinishOrder(activePlaces, horses, ctx.horseNumberById);
  }, [ctx, activePlaces, horses]);

  const payoutRow = useMemo(() => {
    if (!ctx || finishOrder.length < 3) return null;
    return calculateRacePayout(ctx.tickets, {
      raceId,
      classLevel: ctx.classLevel,
      finishOrder,
      winOddsByNumber: ctx.winOddsByNumber,
      officialPayouts: autoResult?.payouts,
    });
  }, [ctx, finishOrder, raceId, autoResult?.payouts]);

  const sortedPlaces = useMemo(
    () => [...activePlaces].sort((a, b) => a.place - b.place),
    [activePlaces],
  );

  const secondStatus = useMemo(() => {
    if (!ctx || finishOrder.length < 3) return null;
    return analyzeSecondRowStatus(ctx.marks, ctx.classTier, finishOrder, ctx.favoriteNumber);
  }, [ctx, finishOrder]);

  const formationHits = useMemo(() => {
    if (!ctx || finishOrder.length < 3) return null;
    return computeFormationHits(ctx.marks, finishOrder, ctx.classTier);
  }, [ctx, finishOrder]);

  const officialPayouts = autoResult?.payouts;

  const horseOptions = useMemo(() => {
    return results.map((r) => {
      const h = horses.find((x) => x.horseId === r.horseId);
      const gate = h && "gate" in h ? (h as HorseAbility & { gate?: number }).gate : undefined;
      return {
        horseId: r.horseId,
        label: `${gate != null ? `${gate}番` : ""}${h?.horseName ?? r.horseName}${r.mark ? ` [${r.mark}]` : ""}`,
      };
    });
  }, [results, horses]);

  const isResolved = finishOrder.length >= 3;

  return (
    <section className="result-analysis-view" aria-label="結果確認">
      <h2 className="app__section-title app__section-title--pop">確定結果・回収率</h2>
      <NetkeibaRaceLinks raceId={raceId} />
      <p className="app__meta">
        定型フォーメ（◎単勝・◎○馬連等）の投資・払戻を全レースで集計。見送りはEV推奨なしの目安です。
      </p>

      {autoResult ? (
        <p className="result-panel__auto-badge">
          自動取得済み（{new Date(autoResult.fetchedAt).toLocaleDateString("ja-JP")}）
        </p>
      ) : autoLoading ? (
        <p className="app__meta">結果データを確認中…</p>
      ) : (
        <div className="result-panel__form">
          <p className="app__meta">着順を手動入力するか、結果取得スクリプトを実行してください。</p>
          <div className="result-panel__selects">
            {(["1", "2", "3"] as const).map((key) => (
              <label key={key} className="result-panel__select-row">
                <span className="result-panel__pos-label">{key}着</span>
                <select
                  className="result-panel__select"
                  value={manualPlaces[key] ?? ""}
                  onChange={(e) =>
                    setManualPlaces((prev) => ({ ...prev, [key]: e.target.value || undefined }))
                  }
                  disabled={manualSubmitted}
                >
                  <option value="">—</option>
                  {horseOptions.map((o) => (
                    <option key={o.horseId} value={o.horseId}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </label>
            ))}
          </div>
          <div className="result-panel__actions">
            {!manualSubmitted ? (
              <button
                type="button"
                className="result-panel__btn result-panel__btn--submit"
                onClick={() => {
                  saveManualResult(raceId, manualPlaces);
                  setManualSubmitted(true);
                }}
                disabled={!manualPlaces["1"] || !manualPlaces["2"] || !manualPlaces["3"]}
              >
                結果を確定
              </button>
            ) : (
              <button
                type="button"
                className="result-panel__btn result-panel__btn--reset"
                onClick={() => {
                  setManualPlaces({});
                  setManualSubmitted(false);
                  clearManualResult(raceId);
                }}
              >
                入力をリセット
              </button>
            )}
          </div>
        </div>
      )}

      {isResolved && (
        <>
          <div className="result-analysis-view__finish">
            <h3>確定着順</h3>
            <ol className="result-panel__place-list">
              {sortedPlaces.map((p) => {
                const num =
                  ctx != null ? horseNumberForPlace(p, ctx.horseNumberById) : undefined;
                const hid = resolvePlaceToHorseId(p, horses);
                const name =
                  p.horseName ||
                  (hid ? horses.find((h) => h.horseId === hid)?.horseName : undefined) ||
                  "—";
                const mark = hid ? markByHorseId.get(hid) : undefined;
                return (
                  <li key={p.place} className="result-panel__place-item">
                    <span className="result-panel__place-num">{p.place}着</span>
                    <FinishPlaceLabel
                      className="result-panel__place-name"
                      horseNumber={num}
                      horseName={name}
                      mark={mark}
                    />
                    {"time" in p && p.time ? (
                      <span className="result-panel__place-time">{p.time}</span>
                    ) : null}
                    {"margin" in p && p.margin != null && p.place > 1 ? (
                      <span className="result-panel__place-margin">{p.margin.toFixed(2)}秒差</span>
                    ) : null}
                  </li>
                );
              })}
            </ol>
          </div>

          {officialPayouts &&
            (officialPayouts.REN.length > 0 ||
              officialPayouts.WREN.length > 0 ||
              officialPayouts.TRI.length > 0) && (
              <div className="result-analysis-view__official-payouts">
                <h3>公式払戻（100円あたり）</h3>
                <ul className="result-analysis-view__official-payouts-list">
                  {officialPayouts.REN.map((row, i) => (
                    <li key={`ren-${i}`}>
                      <span className="result-analysis-view__official-kind">馬連</span>
                      {formatOfficialPayoutRow(row)}
                    </li>
                  ))}
                  {officialPayouts.WREN.map((row, i) => (
                    <li key={`wren-${i}`}>
                      <span className="result-analysis-view__official-kind">ワイド</span>
                      {formatOfficialPayoutRow(row)}
                    </li>
                  ))}
                  {officialPayouts.TRI.map((row, i) => (
                    <li key={`tri-${i}`}>
                      <span className="result-analysis-view__official-kind">3連複</span>
                      {formatOfficialPayoutRow(row)}
                    </li>
                  ))}
                </ul>
              </div>
            )}

          {payoutRow && (
            <table className="horse-list result-analysis-view__table">
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
                {BET_TICKET_TYPES.map((type) => {
                  const d = payoutRow.byType[type];
                  const purchasedHit = d.hitCount > 0;
                  const formationHit =
                    formationHits != null ? formationHitForType(formationHits, type) : false;
                  const displayHit = isTicketDisplayHit({
                    isHit: purchasedHit,
                    formationHit,
                  });
                  const ticket = ctx?.tickets.find((t) => t.ticketType === type);
                  const hitComb = purchasedHit && ticket
                    ? ticket.combinations.find((comb) => {
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
                      })
                    : undefined;
                  const officialDiv =
                    hitComb != null
                      ? lookupOfficialDividend(officialPayouts, type, hitComb)
                      : null;
                  return (
                    <tr
                      key={type}
                      className={
                        displayHit
                          ? purchasedHit
                            ? "result-analysis-view__row--hit"
                            : "result-analysis-view__row--formation"
                          : "result-analysis-view__row--miss"
                      }
                    >
                      <td>
                        {ticketTypeName(type)}
                        {hitComb != null && (
                          <span className="result-analysis-view__hit-comb">
                            {" "}
                            {hitComb.join("-")}
                            {officialDiv != null ? `（${officialDiv.toLocaleString()}円）` : ""}
                          </span>
                        )}
                        {d.estimatedPayout && type !== "WIN" && (
                          <span className="result-analysis-view__payout-warn"> 払戻未取得</span>
                        )}
                      </td>
                      <td>{d.invested.toLocaleString()}円</td>
                      <td>{d.payout.toLocaleString()}円</td>
                      <td className={d.rate >= 100 ? "result-analysis-view__rate--plus" : ""}>
                        {d.rate}%
                      </td>
                      <td>
                        {ticketResultText({ isHit: purchasedHit, formationHit }, d.payout)}
                      </td>
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
          )}

          {secondStatus && (
            <div className="ai-diagnostic-box">
              <h4>アナリストAIのボトルネック診断</h4>
              <p>
                本レースの◎生存状況:{" "}
                <strong>{secondStatus.isAnchorHit ? "生存（3着内）" : "トビ（4着以下）"}</strong>
              </p>
              {secondStatus.isSecondRowDead && (
                <p className="ai-diagnostic-box__warn">
                  警告: 「2列目全滅エラー」。軸◎は3着内ですが、2列目馬が全滅しています。○▲の脚質・枠分散を再調整してください。
                </p>
              )}
              {!secondStatus.isSecondRowDead && secondStatus.isAnchorHit && secondStatus.isSecondRowHit && (
                <p className="ai-diagnostic-box__ok">2列目にヒモが1頭以上入りました。</p>
              )}
            </div>
          )}

        </>
      )}
    </section>
  );
}
