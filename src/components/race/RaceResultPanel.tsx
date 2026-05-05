import { useEffect, useMemo, useState } from "react";
import type { HorseAbility, HorseScoreResult } from "../../domain/race-evaluation";
import type { RaceCondition } from "../../domain/race-evaluation/abilityTypes";
import { BIAS_ADJUSTMENTS, PACE_ADJUSTMENTS } from "../../domain/race-evaluation/adjustments";
import type { RaceResultData } from "../../lib/race-data/raceEvaluationTypes";
import { fetchRaceResultByApi, getRaceResultById } from "../../lib/race-data";

// ===== localStorage helpers (手動入力の保存) =====

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

// ===== 共通: "places" 正規化 =====
// horseId をキーにした着順 Map（1〜4着の horseId を返す）

type PlaceMap = Partial<Record<"1" | "2" | "3" | "4", string>>;

/** RaceResultData → PlaceMap（1〜4着分のみ） */
function resultDataToPlaceMap(data: RaceResultData): PlaceMap {
  const map: PlaceMap = {};
  for (const p of data.places) {
    if (p.place >= 1 && p.place <= 4) {
      const key = String(p.place) as "1" | "2" | "3" | "4";
      if (p.horseId) map[key] = p.horseId;
    }
  }
  return map;
}

// ===== 的中判定 =====

type HitSummary = {
  favorite: boolean | null;
  rival: boolean | null;
  triangle: boolean | null;
  topHorse: string | null;
  secondHorse: string | null;
  thirdHorse: string | null;
};

function analyzeHits(
  places: PlaceMap,
  sorted: HorseScoreResult[],
  horses: HorseAbility[],
): HitSummary {
  const horseById = new Map(horses.map((h) => [h.horseId, h]));
  const winners = new Set([places["1"], places["2"], places["3"]].filter(Boolean) as string[]);

  const favoriteId = sorted.find((r) => r.mark === "◎")?.horseId ?? null;
  const rivalId = sorted.find((r) => r.mark === "○")?.horseId ?? null;
  const triangleId = sorted.find((r) => r.mark === "▲")?.horseId ?? null;

  const nameOf = (id: string | undefined) =>
    id ? (horseById.get(id)?.horseName ?? id) : null;

  return {
    favorite: favoriteId != null ? winners.has(favoriteId) : null,
    rival: rivalId != null ? winners.has(rivalId) : null,
    triangle: triangleId != null ? winners.has(triangleId) : null,
    topHorse: nameOf(places["1"]),
    secondHorse: nameOf(places["2"]),
    thirdHorse: nameOf(places["3"]),
  };
}

// ===== 条件フィードバック =====

type ConditionHint = {
  title: string;
  detail: string;
  suggest: "bias_front" | "bias_closer" | "ok" | null;
};

function buildConditionHint(
  places: PlaceMap,
  horses: HorseAbility[],
  condition: RaceCondition,
): ConditionHint {
  const horseById = new Map(horses.map((h) => [h.horseId, h]));
  const top3Ids = [places["1"], places["2"], places["3"]].filter(Boolean) as string[];
  const top3 = top3Ids.map((id) => horseById.get(id)).filter(Boolean) as HorseAbility[];

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

// ===== Props =====

type Props = {
  raceId: string;
  sorted: HorseScoreResult[];
  horses: HorseAbility[];
  condition: RaceCondition;
  onApplySuggest?: (bias: string) => void;
};

// ===== Component =====

export function RaceResultPanel({ raceId, sorted, horses, condition, onApplySuggest }: Props) {
  // 自動取得した結果データ
  const [autoResult, setAutoResult] = useState<RaceResultData | null>(null);
  const [autoLoading, setAutoLoading] = useState(true);

  // 手動入力フォームの状態
  const [manualPlaces, setManualPlaces] = useState<ManualPlaces>(
    () => loadManualResult(raceId) ?? {},
  );
  const [manualSubmitted, setManualSubmitted] = useState(
    () => loadManualResult(raceId) != null,
  );

  // 自動ロード（Vercel API 経由）
  useEffect(() => {
    setAutoLoading(true);
    void (async () => {
      const live = await fetchRaceResultByApi(raceId);
      if (live != null) {
        setAutoResult(live);
        setAutoLoading(false);
        return;
      }
      const cached = await getRaceResultById(raceId);
      setAutoResult(cached);
      setAutoLoading(false);
    })();
  }, [raceId]);

  // 表示に使う places（自動 > 手動）
  const activePlaces = useMemo<PlaceMap>(() => {
    if (autoResult) return resultDataToPlaceMap(autoResult);
    if (manualSubmitted) return manualPlaces;
    return {};
  }, [autoResult, manualSubmitted, manualPlaces]);

  const isResolved = autoResult != null || manualSubmitted;

  const hits = useMemo(
    () => (isResolved ? analyzeHits(activePlaces, sorted, horses) : null),
    [isResolved, activePlaces, sorted, horses],
  );

  const conditionHint = useMemo(
    () => (isResolved ? buildConditionHint(activePlaces, horses, condition) : null),
    [isResolved, activePlaces, horses, condition],
  );

  // 手動入力 handlers
  const horseOptions = useMemo(() => {
    const horseById = new Map(horses.map((h) => [h.horseId, h]));
    return sorted.map((r) => {
      const h = horseById.get(r.horseId);
      const gate = h && "gate" in h ? (h as HorseAbility & { gate?: number }).gate : undefined;
      return {
        horseId: r.horseId,
        label: `${gate != null ? `${gate}番` : ""}${h?.horseName ?? r.horseName}`,
      };
    });
  }, [sorted, horses]);

  function handleSubmit() {
    saveManualResult(raceId, manualPlaces);
    setManualSubmitted(true);
  }

  function handleReset() {
    setManualPlaces({});
    setManualSubmitted(false);
    try { localStorage.removeItem(storageKey(raceId)); } catch { /* ignore */ }
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

      {/* 自動取得済みバナー */}
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
        /* 手動入力フォーム（自動データなし時のみ） */
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

      {/* 着順一覧（自動取得時） */}
      {autoResult && (
        <div className="result-panel__auto-places">
          <h3 className="result-panel__analysis-h">確定着順</h3>
          <ol className="result-panel__place-list">
            {autoResult.places.slice(0, 8).map((p) => (
              <li key={p.place} className="result-panel__place-item">
                <span className="result-panel__place-num">{p.place}着</span>
                <span className="result-panel__place-name">{p.horseName}</span>
                <span className="result-panel__place-time">{p.time}</span>
                {p.margin != null && p.place > 1 && (
                  <span className="result-panel__place-margin">{p.margin.toFixed(2)}秒差</span>
                )}
              </li>
            ))}
          </ol>
        </div>
      )}

      {/* 的中分析 */}
      {isResolved && hits && (
        <div className="result-panel__analysis">
          <h3 className="result-panel__analysis-h">的中チェック</h3>

          {!autoResult && (
            <div className="result-panel__podium">
              {[
                { pos: "1着", name: hits.topHorse },
                { pos: "2着", name: hits.secondHorse },
                { pos: "3着", name: hits.thirdHorse },
              ].map(({ pos, name }) => (
                <div key={pos} className="result-panel__podium-item">
                  <span className="result-panel__podium-pos">{pos}</span>
                  <span className="result-panel__podium-name">{name ?? "—"}</span>
                </div>
              ))}
            </div>
          )}

          <div className="result-panel__marks">
            {([
              { mark: "◎" as const, hit: hits.favorite, label: "本命" },
              { mark: "○" as const, hit: hits.rival, label: "対抗" },
              { mark: "▲" as const, hit: hits.triangle, label: "単穴" },
            ] as const).map(({ mark, hit, label }) =>
              hit !== null ? (
                <div
                  key={mark}
                  className={`result-panel__mark-row${hit ? " result-panel__mark-row--hit" : " result-panel__mark-row--miss"}`}
                >
                  <span className="result-panel__mark">{mark}</span>
                  <span className="result-panel__mark-label">{label}</span>
                  <span className="result-panel__mark-result">{hit ? "的中 ✓" : "外れ ✗"}</span>
                </div>
              ) : null,
            )}
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
