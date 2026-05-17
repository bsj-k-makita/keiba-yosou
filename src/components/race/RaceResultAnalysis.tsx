import { useEffect, useMemo, useState } from "react";
import type { HorseAbility, HorseScoreResult, RaceCondition } from "../../domain/race-evaluation";
import { resolvePlaceToHorseId } from "../../domain/race-evaluation/markHitAnalysis";
import { buildRaceBettingContext } from "../../domain/betting/buildRaceBettingContext";
import { calculateRacePayout } from "../../domain/betting/payoutCalculator";
import { buildAiMarksMap, formatFinishWithMarks } from "../../domain/betting/raceDetailLog";
import { analyzeSecondRowStatus } from "../../domain/betting/secondRowAnalysis";
import type { BetTicketType } from "../../domain/betting/types";
import { ensureRaceResultFetched } from "../../lib/race-data";
import type { RaceResultData } from "../../lib/race-data/raceEvaluationTypes";
import { NetkeibaRaceLinks } from "./NetkeibaRaceLinks";

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
  return "3連複フォーメ";
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
};

export function RaceResultAnalysis({ raceId, results, horses, condition }: Props) {
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

  const ctx = useMemo(
    () => buildRaceBettingContext(results, horses, condition),
    [results, horses, condition],
  );

  const activePlaces = useMemo(() => {
    if (autoResult) return autoResult.places;
    if (manualSubmitted) {
      return [1, 2, 3, 4]
        .map((place) => {
          const horseId = manualPlaces[String(place) as "1" | "2" | "3" | "4"];
          if (!horseId) return null;
          return { place, horseId };
        })
        .filter((p): p is { place: number; horseId: string } => p != null);
    }
    return [];
  }, [autoResult, manualSubmitted, manualPlaces]);

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

  const aiMarks = useMemo(() => (ctx ? buildAiMarksMap(ctx.marks) : {}), [ctx]);

  const finishLabel = useMemo(
    () => (finishOrder.length > 0 ? formatFinishWithMarks(finishOrder, aiMarks) : ""),
    [finishOrder, aiMarks],
  );

  const secondStatus = useMemo(() => {
    if (!ctx || finishOrder.length < 3) return null;
    return analyzeSecondRowStatus(ctx.marks, ctx.classTier, finishOrder, ctx.favoriteNumber);
  }, [ctx, finishOrder]);

  const markedComments = useMemo(() => {
    return results
      .filter((r) => (r.mark ?? "").length > 0 && r.predictionShortComment?.trim())
      .slice(0, 8)
      .map((r) => {
        const num = ctx?.horseNumberById.get(r.horseId);
        const horse = horses.find((h) => h.horseId === r.horseId);
        return {
          key: r.horseId,
          label: `${num != null ? `${num}番` : ""}${horse?.horseName ?? r.horseName}（${r.mark}）`,
          comment: r.predictionShortComment!.trim(),
        };
      });
  }, [results, horses, ctx]);

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
        画面2の定型買い目と確定着順・公式払戻を突合。KPIは券種別回収率です。
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
            <h3>確定着順（印付き）</h3>
            <p className="result-analysis-view__finish-label">{finishLabel}</p>
          </div>

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
                {(["WIN", "MAIN_LINE", "TRIFECTA_FORM"] as const).map((type) => {
                  const d = payoutRow.byType[type];
                  const hit = d.hitCount > 0;
                  return (
                    <tr
                      key={type}
                      className={hit ? "result-analysis-view__row--hit" : "result-analysis-view__row--miss"}
                    >
                      <td>{ticketTypeName(type)}</td>
                      <td>{d.invested.toLocaleString()}円</td>
                      <td>{d.payout.toLocaleString()}円</td>
                      <td className={d.rate >= 100 ? "result-analysis-view__rate--plus" : ""}>
                        {d.rate}%
                      </td>
                      <td>{hit ? "🎯 的中" : "✕ 不的中"}</td>
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

          {markedComments.length > 0 && (
            <div className="result-analysis-view__comments">
              <h3>AI短評（印付き馬）</h3>
              <ul>
                {markedComments.map((c) => (
                  <li key={c.key}>
                    <strong>{c.label}</strong> — {c.comment}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </>
      )}
    </section>
  );
}
