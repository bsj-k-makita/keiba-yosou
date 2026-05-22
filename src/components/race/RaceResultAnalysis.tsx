import { useEffect, useMemo, useState } from "react";
import type { HorseAbility, HorseScoreResult, RaceCondition } from "../../domain/race-evaluation";
import type { ProbabilityEngine } from "../../lib/pipeline/probabilityEngine";
import { resolvePlaceToHorseId } from "../../domain/race-evaluation/markHitAnalysis";
import { buildPayoutFallbackOddsMap } from "../../domain/betting/bettingRules";
import { buildRaceBettingContext } from "../../domain/betting/buildRaceBettingContext";
import { getEffectiveEvaluationSignals } from "../../domain/race-evaluation/resolveEvaluationSignals";
import {
  calculateRacePayout,
} from "../../domain/betting/payoutCalculator";
import type { RaceOfficialPayoutRow } from "../../lib/race-data/raceEvaluationTypes";
import { analyzeSecondRowStatus } from "../../domain/betting/secondRowAnalysis";
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
    const num =
      (hid != null ? numberById.get(hid) : undefined) ??
      (p.horseNumber != null && Number.isFinite(p.horseNumber) ? p.horseNumber : undefined);
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
  probabilityEngine?: ProbabilityEngine;
  noAiEvRegime?: boolean;
};

export function RaceResultAnalysis({
  raceId,
  results,
  horses,
  condition,
  adjustedProbabilities,
  isSkippableRace,
  probabilityEngine,
  noAiEvRegime,
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
        probabilityEngine,
        noAiEvRegime,
      }),
    [results, horses, condition, adjustedProbabilities, isSkippableRace, probabilityEngine, noAiEvRegime],
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
    return calculateRacePayout(ctx.evTickets, {
      raceId,
      classLevel: ctx.classLevel,
      finishOrder,
      winOddsByNumber: ctx.winOddsByNumber,
      officialPayouts: autoResult?.payouts,
      fallbackExoticOdds: buildPayoutFallbackOddsMap(horses, autoResult?.payouts, probByGate),
    });
  }, [ctx, finishOrder, raceId, autoResult?.payouts, horses]);

  const isEvSkip = payoutRow != null && payoutRow.totalInvested === 0;

  const sortedPlaces = useMemo(
    () => [...activePlaces].sort((a, b) => a.place - b.place),
    [activePlaces],
  );

  const secondStatus = useMemo(() => {
    if (!ctx || finishOrder.length < 3) return null;
    return analyzeSecondRowStatus(
      ctx.marks,
      ctx.classTier,
      finishOrder,
      ctx.favoriteNumber,
      ctx.probabilityEngine,
    );
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
        EV推奨券（閾値通過した買い目のみ）の投資・払戻を集計します。見送りは買い目0点のレースです。
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

          {payoutRow && isEvSkip && (
            <p className="result-analysis-view__ev-skip">
              投資: 0円 / 払戻: 0円 / 回収率: 0%（見送り判定成功）
            </p>
          )}

          {payoutRow && !isEvSkip && (
            <p className="app__meta">
              券種ごとの投資・払戻・的中判定は上部の「買い目ダッシュボード」で表示しています。
            </p>
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
