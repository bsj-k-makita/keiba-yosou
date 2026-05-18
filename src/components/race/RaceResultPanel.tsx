import { useEffect, useMemo, useState } from "react";
import type { HorseAbility, HorseScoreResult } from "../../domain/race-evaluation";
import type { RaceCondition } from "../../domain/race-evaluation/abilityTypes";
import {
  analyzeMarkHits,
  manualPlaceMapToPlaces,
  resolvePlaceToHorseId,
  type MarkHitRow,
  type PlaceLike,
  type TopPredictionMark,
} from "../../domain/race-evaluation/markHitAnalysis";
import { BIAS_ADJUSTMENTS, PACE_ADJUSTMENTS } from "../../domain/race-evaluation/adjustments";
import type { RaceResultData } from "../../lib/race-data/raceEvaluationTypes";
import { ensureRaceResultFetched } from "../../lib/race-data";
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

const MARK_LABELS: Record<TopPredictionMark, string> = {
  "◎": "本命",
  "○": "対抗",
  "▲": "単穴",
};

function formatPickLabel(row: MarkHitRow): string {
  const gate = row.gate != null ? `${row.gate}番 ` : "";
  return `${gate}${row.horseName}`;
}

function gateOf(h: HorseAbility): number | undefined {
  if ("gate" in h && typeof (h as { gate?: number }).gate === "number") {
    return (h as { gate?: number }).gate;
  }
  return undefined;
}

type ConditionHint = {
  title: string;
  detail: string;
  suggest: "bias_front" | "bias_closer" | "ok" | null;
};

function buildConditionHint(
  top3HorseIds: string[],
  horses: HorseAbility[],
  condition: RaceCondition,
): ConditionHint {
  const horseById = new Map(horses.map((h) => [h.horseId, h]));
  const top3 = top3HorseIds.map((id) => horseById.get(id)).filter(Boolean) as HorseAbility[];

  if (top3.length === 0) {
    return { title: "データ不足", detail: "1〜3着を入力すると分析できます。", suggest: null };
  }

  const frontStyles = new Set(["逃げ", "先行", "好位"]);
  const closerStyles = new Set(["差し", "追込"]);

  const frontCount = top3.filter((h) => frontStyles.has(h.runningStyle)).length;
  const closerCount = top3.filter((h) => closerStyles.has(h.runningStyle)).length;

  const biasLabel = BIAS_ADJUSTMENTS[condition.bias]?.label ?? condition.bias;
  const paceLabel = PACE_ADJUSTMENTS[condition.pace]?.label ?? condition.pace;

  if (frontCount >= 2 && condition.bias !== "front_favor") {
    return {
      title: "前残り展開だった可能性",
      detail: `上位に${frontCount}頭の先行勢。今回の設定（${biasLabel}）より前有利寄りだったかもしれません。`,
      suggest: "bias_front",
    };
  }
  if (closerCount >= 2 && condition.bias !== "closer_favor") {
    return {
      title: "差し・追込が決まる展開だった可能性",
      detail: `上位に${closerCount}頭の差し・追込。今回の設定（${biasLabel}）より後ろ有利寄りだったかもしれません。`,
      suggest: "bias_closer",
    };
  }

  return {
    title: "展開は概ね想定内",
    detail: `${biasLabel}・${paceLabel}の設定と大きな乖離はなさそうです。`,
    suggest: "ok",
  };
}

type Props = {
  raceId: string;
  /** 出馬表と同じ evaluateRace 結果（印はここから読む） */
  results: HorseScoreResult[];
  horses: HorseAbility[];
  condition: RaceCondition;
  onApplySuggest?: (bias: string) => void;
};

export function RaceResultPanel({ raceId, results, horses, condition, onApplySuggest }: Props) {
  const [autoResult, setAutoResult] = useState<RaceResultData | null>(null);
  const [autoLoading, setAutoLoading] = useState(true);

  const [manualPlaces, setManualPlaces] = useState<ManualPlaces>(
    () => loadManualResult(raceId) ?? {},
  );
  const [manualSubmitted, setManualSubmitted] = useState(
    () => loadManualResult(raceId) != null,
  );

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

  const activePlaces = useMemo((): PlaceLike[] => {
    if (autoResult) return autoResult.places;
    if (manualSubmitted) return manualPlaceMapToPlaces(manualPlaces);
    return [];
  }, [autoResult, manualSubmitted, manualPlaces]);

  const isResolved = activePlaces.length >= 3;

  const hitAnalysis = useMemo(
    () => (isResolved ? analyzeMarkHits(activePlaces, results, horses) : null),
    [isResolved, activePlaces, results, horses],
  );

  const top3HorseIds = useMemo(() => {
    if (!hitAnalysis) return [];
    return [...hitAnalysis.winners];
  }, [hitAnalysis]);

  const conditionHint = useMemo(
    () => (hitAnalysis ? buildConditionHint(top3HorseIds, horses, condition) : null),
    [hitAnalysis, top3HorseIds, horses, condition],
  );

  const horseOptions = useMemo(() => {
    const horseById = new Map(horses.map((h) => [h.horseId, h]));
    return results.map((r) => {
      const h = horseById.get(r.horseId);
      const gate = h ? gateOf(h) : undefined;
      const markSuffix = r.mark ? ` [${r.mark}]` : "";
      return {
        horseId: r.horseId,
        label: `${gate != null ? `${gate}番` : ""}${h?.horseName ?? r.horseName}${markSuffix}`,
      };
    });
  }, [results, horses]);

  const markByHorseId = useMemo(() => {
    const m = new Map<string, string>();
    for (const r of results) {
      if (r.mark) m.set(r.horseId, r.mark);
    }
    return m;
  }, [results]);

  const podiumLabels = useMemo(() => {
    const horseById = new Map(horses.map((h) => [h.horseId, h]));
    return [1, 2, 3].map((place) => {
      const row = activePlaces.find((p) => p.place === place);
      if (!row) {
        return { pos: `${place}着`, horseNumber: undefined, horseName: "—", mark: undefined };
      }
      const id = resolvePlaceToHorseId(row, horses);
      const h = id ? horseById.get(id) : undefined;
      const gate = h ? gateOf(h) : row.horseNumber;
      const horseName = h?.horseName ?? row.horseName ?? "—";
      const mark = id ? markByHorseId.get(id) : undefined;
      return { pos: `${place}着`, horseNumber: gate, horseName, mark };
    });
  }, [activePlaces, horses, markByHorseId]);

  function handleSubmit() {
    saveManualResult(raceId, manualPlaces);
    setManualSubmitted(true);
  }

  function handleReset() {
    setManualPlaces({});
    setManualSubmitted(false);
    clearManualResult(raceId);
  }

  const POSITIONS: Array<{ key: "1" | "2" | "3" | "4"; label: string }> = [
    { key: "1", label: "1着" },
    { key: "2", label: "2着" },
    { key: "3", label: "3着" },
    { key: "4", label: "4着" },
  ];

  return (
    <div className="result-panel">
      <h2 className="app__section-title">結果確認・予想フィードバック</h2>
      <NetkeibaRaceLinks raceId={raceId} />
      <p className="result-panel__lead result-panel__lead--note">
        的中判定は<strong>出馬表タブと同じ印</strong>（現在の条件設定で再計算した ◎・○・▲）と、確定着順の突合です。
      </p>

      {autoResult ? (
        <div className="result-panel__auto-badge">
          自動取得済み
          <span className="result-panel__auto-date">
            {new Date(autoResult.fetchedAt).toLocaleDateString("ja-JP")} 取得
          </span>
        </div>
      ) : autoLoading ? (
        <p className="result-panel__lead">結果データを確認中…</p>
      ) : (
        <div className="result-panel__form">
          <p className="result-panel__lead">
            結果データが未取得です。着順を手動で入力するか、
            <code>node scripts/fetch-race-results.mjs --raceId={raceId}</code> を実行してください。
          </p>
          <div className="result-panel__selects">
            {POSITIONS.map(({ key, label }) => (
              <label key={key} className="result-panel__select-row">
                <span className="result-panel__pos-label">{label}</span>
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
                onClick={handleSubmit}
                disabled={Object.keys(manualPlaces).length === 0}
              >
                結果を確定
              </button>
            ) : (
              <button
                type="button"
                className="result-panel__btn result-panel__btn--reset"
                onClick={handleReset}
              >
                入力をリセット
              </button>
            )}
          </div>
        </div>
      )}

      {autoResult && (
        <div className="result-panel__auto-places">
          <h3 className="result-panel__analysis-h">確定着順</h3>
          <ol className="result-panel__place-list">
            {autoResult.places.slice(0, 8).map((p) => {
              const id = resolvePlaceToHorseId(p, horses);
              const h = id ? horses.find((x) => x.horseId === id) : undefined;
              const gate = h ? gateOf(h) : undefined;
              const mark = id ? markByHorseId.get(id) : undefined;
              return (
              <li key={p.place} className="result-panel__place-item">
                <span className="result-panel__place-num">{p.place}着</span>
                <FinishPlaceLabel
                  className="result-panel__place-name"
                  horseNumber={gate}
                  horseName={p.horseName ?? h?.horseName ?? "—"}
                  mark={mark}
                />
                <span className="result-panel__place-time">{p.time}</span>
                {p.margin != null && p.place > 1 && (
                  <span className="result-panel__place-margin">{p.margin.toFixed(2)}秒差</span>
                )}
              </li>
              );
            })}
          </ol>
        </div>
      )}

      {isResolved && hitAnalysis && (
        <div className="result-panel__analysis">
          <h3 className="result-panel__analysis-h">的中チェック</h3>

          <div className="result-panel__podium">
            {podiumLabels.map(({ pos, horseNumber, horseName, mark }) => (
              <div key={pos} className="result-panel__podium-item">
                <span className="result-panel__podium-pos">{pos}</span>
                <FinishPlaceLabel
                  className="result-panel__podium-name"
                  horseNumber={horseNumber}
                  horseName={horseName}
                  mark={mark}
                />
              </div>
            ))}
          </div>

          <div className="result-panel__marks">
            {hitAnalysis.rows.map((row) => (
              <div
                key={row.mark}
                className={`result-panel__mark-row${row.hit ? " result-panel__mark-row--hit" : " result-panel__mark-row--miss"}`}
              >
                <span className="result-panel__mark">{row.mark}</span>
                <span className="result-panel__mark-label">{MARK_LABELS[row.mark]}</span>
                <span className="result-panel__mark-horse">{formatPickLabel(row)}</span>
                <span className="result-panel__mark-result">{row.hit ? "的中 ✓" : "外れ ✗"}</span>
              </div>
            ))}
          </div>

          {conditionHint && (
            <div
              className={`result-panel__hint${
                conditionHint.suggest === "ok"
                  ? " result-panel__hint--ok"
                  : " result-panel__hint--warn"
              }`}
            >
              <p className="result-panel__hint-title">{conditionHint.title}</p>
              <p className="result-panel__hint-detail">{conditionHint.detail}</p>
              {conditionHint.suggest === "bias_front" && onApplySuggest && (
                <button
                  type="button"
                  className="result-panel__apply-btn"
                  onClick={() => onApplySuggest("front_favor")}
                >
                  前有利に条件を修正して再計算
                </button>
              )}
              {conditionHint.suggest === "bias_closer" && onApplySuggest && (
                <button
                  type="button"
                  className="result-panel__apply-btn"
                  onClick={() => onApplySuggest("closer_favor")}
                >
                  差し有利に条件を修正して再計算
                </button>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
