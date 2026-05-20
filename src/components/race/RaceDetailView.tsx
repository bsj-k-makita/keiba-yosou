import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import {
  BIAS_ADJUSTMENTS,
  GROUND_ADJUSTMENTS,
  PACE_ADJUSTMENTS,
  TRACK_SPEED_ADJUSTMENTS,
  classifyLapStructure,
  LAP_STRUCTURE,
  computeAbilityLetterGrades,
  findSameTypePeers,
  type QuickAdjustmentKey,
  type RaceCondition,
} from "../../domain/race-evaluation";
import { RaceAdjustmentPanel, loadGlobalProfile } from "./RaceAdjustmentPanel";
import { RaceEvaluationSummary } from "./RaceEvaluationSummary";
import { RaceConclusionPanel } from "./RaceConclusionPanel";
import { RaceNavBar } from "./RaceNavBar";
import { NetkeibaRaceLinks } from "./NetkeibaRaceLinks";
import { RaceHorsesView } from "./RaceHorsesView";
import { RaceBettingDashboard } from "./RaceBettingDashboard";
import { RaceResultAnalysis } from "./RaceResultAnalysis";
import { RaceAdjustProvider } from "./RaceAdjustContext";
import {
  getHorsesFromRaceData,
  getRaceEvaluationById,
  ensureRaceResultFetched,
  getRaceResultById,
  getSortedRaceEntryGateRows,
  type RaceEvaluationData,
} from "../../lib/race-data";
import type { RaceIndexItem } from "../../lib/race-data";
import { runRaceEvaluationPipeline } from "../../lib/pipeline/evaluationPipeline";
import { NO_EV_REGIME_BANNER_TEXT } from "../../lib/pipeline/aiEvRegime";
import { buildRaceBettingContextFromPipeline } from "../../domain/betting/buildRaceBettingContext";
import { applyEvRecommendedFlags } from "../../viewModel/raceEvaluationViewModel";
import {
  parseProbabilityEngine,
  raceHasAiEngineReady,
  type ProbabilityEngine,
} from "../../lib/pipeline/probabilityEngine";
import { sortResultsForPredictionTable } from "../../domain/race-evaluation/markHitAnalysis";
import { FIXED_SOFTMAX_TEMPERATURE } from "../../lib/pipeline/normalization";
import {
  buildAbilityOnlyEvaluationCondition,
  buildDefaultNeutralCondition,
} from "./neutralRaceCondition";

const NEUTRAL_CONDITION: RaceCondition = {
  venue: "東京",
  surface: "芝",
  ground: "good",
  trackSpeed: "standard",
  bias: "flat",
  pace: "middle",
  adjustmentStrength: "middle",
};

type ViewTab = "horses" | "bets" | "result";

type Props = {
  race: RaceEvaluationData;
  raceIndex?: RaceIndexItem[];
};

function inferRaceSection200mFromEntries(raceId: string, horses: ReturnType<typeof getHorsesFromRaceData>): readonly number[] | undefined {
  for (const horse of horses) {
    const run = (horse.pastRuns ?? []).find(
      (r) => r.raceId === raceId && (r.section200mSec?.length ?? 0) >= 4,
    );
    if (run?.section200mSec != null && run.section200mSec.length >= 4) {
      return run.section200mSec;
    }
  }
  return undefined;
}

type BiasKey = "front_favor" | "closer_favor";
type CarryOverCondition = Pick<
  RaceCondition,
  | "ground"
  | "trackSpeed"
  | "bias"
  | "pace"
  | "adjustmentStrength"
  | "trackBiasStrength01"
  | "abilityFocus"
  | "quickAdjustments"
  | "paceInference"
  | "meetingPhase"
  | "favoredHorseNumbers"
  | "disfavoredHorseNumbers"
  | "trackCushion01"
>;

function carryOverStorageKey(raceInfo: RaceEvaluationData["raceInfo"]): string {
  return `race-condition-carry:${raceInfo.date}:${raceInfo.venue}:${raceInfo.surface}`;
}

function loadCarryOverCondition(raceInfo: RaceEvaluationData["raceInfo"]): Partial<CarryOverCondition> | null {
  try {
    const raw = localStorage.getItem(carryOverStorageKey(raceInfo));
    if (!raw) return null;
    return JSON.parse(raw) as Partial<CarryOverCondition>;
  } catch {
    return null;
  }
}

function saveCarryOverCondition(raceInfo: RaceEvaluationData["raceInfo"], condition: RaceCondition): void {
  const payload: CarryOverCondition = {
    ground: condition.ground,
    trackSpeed: condition.trackSpeed,
    bias: condition.bias,
    pace: condition.pace,
    adjustmentStrength: condition.adjustmentStrength,
    trackBiasStrength01: condition.trackBiasStrength01,
    abilityFocus: condition.abilityFocus,
    quickAdjustments: condition.quickAdjustments,
    paceInference: condition.paceInference,
    meetingPhase: condition.meetingPhase,
    favoredHorseNumbers: condition.favoredHorseNumbers,
    disfavoredHorseNumbers: condition.disfavoredHorseNumbers,
    trackCushion01: condition.trackCushion01,
  };
  try {
    localStorage.setItem(carryOverStorageKey(raceInfo), JSON.stringify(payload));
  } catch {
    // ignore
  }
}

function findPreviousRaceId(
  currentRaceId: string,
  currentRaceInfo: RaceEvaluationData["raceInfo"],
  raceIndex?: RaceIndexItem[],
): string | null {
  if (raceIndex == null || raceIndex.length === 0) return null;
  const current = raceIndex.find((r) => r.raceId === currentRaceId) ?? null;
  const date = current?.date ?? currentRaceInfo.date;
  const venue = current?.venue ?? currentRaceInfo.venue;
  const surface = current?.surface ?? currentRaceInfo.surface;
  const currentNumber = current?.raceNumber ?? currentRaceInfo.raceNumber;
  if (!date || !venue || !surface || !Number.isFinite(currentNumber)) return null;

  const sameDayTrack = raceIndex
    .filter((r) => r.date === date && r.venue === venue && r.surface === surface)
    .sort((a, b) => a.raceNumber - b.raceNumber);
  const prev = sameDayTrack.filter((r) => r.raceNumber < currentNumber).at(-1) ?? null;
  return prev?.raceId ?? null;
}

function inferBiasFromTop3HorseIds(
  top3Ids: readonly string[],
  horses: ReturnType<typeof getHorsesFromRaceData>,
): BiasKey | null {
  if (top3Ids.length === 0) return null;
  const horseById = new Map(horses.map((h) => [h.horseId, h]));
  const top3 = top3Ids.map((id) => horseById.get(id)).filter((v): v is (typeof horses)[number] => v != null);
  if (top3.length < 2) return null;
  const frontStyles = new Set(["逃げ", "先行", "好位"]);
  const closerStyles = new Set(["差し", "追込"]);
  const frontCount = top3.filter((h) => frontStyles.has(h.runningStyle)).length;
  const closerCount = top3.filter((h) => closerStyles.has(h.runningStyle)).length;
  if (frontCount >= 2) return "front_favor";
  if (closerCount >= 2) return "closer_favor";
  return null;
}

function loadManualTop3HorseIds(raceId: string): string[] {
  try {
    const raw = localStorage.getItem(`race-result:${raceId}`);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as Partial<Record<"1" | "2" | "3", string>>;
    return [parsed["1"], parsed["2"], parsed["3"]].filter((v): v is string => typeof v === "string" && v.length > 0);
  } catch {
    return [];
  }
}

export function RaceDetailView({ race, raceIndex }: Props) {
  const [tab, setTab] = useState<ViewTab>("horses");

  const horses = useMemo(() => getHorsesFromRaceData(race), [race]);
  const entryGateRows = useMemo(() => getSortedRaceEntryGateRows(race), [race]);
  const pinpointGateRows = useMemo(
    () => entryGateRows.map((r) => ({ frameNumber: r.frameNumber, horseNumber: r.horseNumber })),
    [entryGateRows],
  );
  const inferredSection200mSec = useMemo(
    () => inferRaceSection200mFromEntries(race.raceId, horses),
    [race.raceId, horses],
  );
  const initialCondition = useMemo<RaceCondition>(() => {
    const carryOver = loadCarryOverCondition(race.raceInfo);
    // グローバルプロファイル（「本日の設定を全レースに適用」）が保存されていれば、
    // per-venue キャリーオーバーより優先して適用する
    const globalProfile = loadGlobalProfile();
    return {
      ...race.condition,
      ...(carryOver ?? {}),
      ...(globalProfile ?? {}),
      raceName: race.condition.raceName ?? race.raceInfo.raceName,
      surface: race.condition.surface ?? race.raceInfo.surface,
      section200mSec: race.condition.section200mSec ?? inferredSection200mSec,
    };
  }, [horses, race.condition, race.raceId, race.raceInfo, inferredSection200mSec]);
  const [condition, setCondition] = useState<RaceCondition>(initialCondition);
  const [abilityOnlyPreview, setAbilityOnlyPreview] = useState(false);
  const userEditedRef = useRef(false);

  const evalCondition = useMemo(
    () =>
      abilityOnlyPreview
        ? buildAbilityOnlyEvaluationCondition(race, inferredSection200mSec)
        : condition,
    [abilityOnlyPreview, race, inferredSection200mSec, condition],
  );

  // initialCondition は race JSON の再取得（DEV の定期ポーリング等）で毎回変わりうるが、
  // ここで同期するとユーザー編集中の条件設定が上書きされる。
  // レース切替は親の key={race.raceId} で再マウントされ、useState(initialCondition) が再度効く。

  useEffect(() => {
    const previousRaceId = findPreviousRaceId(race.raceId, race.raceInfo, raceIndex);
    if (previousRaceId == null) return;
    let live = true;
    void (async () => {
      const previousRace = await getRaceEvaluationById(previousRaceId);
      if (!live || previousRace == null) return;
      const previousHorses = getHorsesFromRaceData(previousRace);
      const manualTop3 = loadManualTop3HorseIds(previousRaceId);
      const top3Ids =
        manualTop3.length > 0
          ? manualTop3
          : ((await getRaceResultById(previousRaceId))?.places
              .filter((p) => p.place >= 1 && p.place <= 3 && p.horseId.length > 0)
              .map((p) => p.horseId) ?? []);
      const bias = inferBiasFromTop3HorseIds(top3Ids, previousHorses);
      if (!live || bias == null || userEditedRef.current) return;
      // グローバルプロファイル・キャリーオーバー・「外有利」など明示バイアスは維持する。
      // 直前レースの自動推定はニュートラル（フラット）のときだけ上書きする。
      setCondition((prev) => {
        const current = prev.bias ?? "flat";
        if (current !== "flat") return prev;
        return { ...prev, bias };
      });
    })();
    return () => {
      live = false;
    };
  }, [race.raceId, race.raceInfo, raceIndex]);

  useEffect(() => {
    saveCarryOverCondition(race.raceInfo, condition);
  }, [condition, race.raceInfo]);

  /** レース表示時に結果を自動取得（結果タブを開かなくてもキャッシュされる） */
  useEffect(() => {
    void ensureRaceResultFetched(race.raceId);
  }, [race.raceId]);

  const [searchParams, setSearchParams] = useSearchParams();
  const requestedEngine = parseProbabilityEngine(searchParams.get("engine"));
  const aiDataAvailable = useMemo(() => raceHasAiEngineReady(horses), [horses]);

  const setProbabilityEngine = useCallback(
    (engine: ProbabilityEngine) => {
      const next = new URLSearchParams(searchParams);
      if (engine === "ai") next.delete("engine");
      else next.set("engine", "ts");
      setSearchParams(next, { replace: true });
    },
    [searchParams, setSearchParams],
  );

  const pipeline = useMemo(
    () =>
      horses.length && evalCondition
        ? runRaceEvaluationPipeline(horses, evalCondition, {
            probabilityEngine: requestedEngine,
          })
        : {
            results: [],
            viewModel: { byHorseId: new Map(), probabilityEngine: "ts" as const },
            adjustedProbabilities: new Map<string, number>(),
            probabilityEngine: "ts" as const,
            aiRaceRegime: "NORMAL_AI_REGIME" as const,
            tsReferenceResults: [],
            isSkippableRace: false,
          },
    [horses, evalCondition, requestedEngine],
  );
  const evGateNumbers = useMemo(() => {
    if (evalCondition == null) return new Set<number>();
    const ctx = buildRaceBettingContextFromPipeline(pipeline, horses, evalCondition, 100);
    const gates = new Set<number>();
    for (const ticket of ctx?.evTickets ?? []) {
      for (const combination of ticket.combinations) {
        for (const gate of combination) {
          if (Number.isFinite(gate)) gates.add(gate);
        }
      }
    }
    return gates;
  }, [pipeline, horses, evalCondition]);
  const horsesViewModel = useMemo(
    () => applyEvRecommendedFlags(pipeline.viewModel, horses, evGateNumbers),
    [pipeline.viewModel, horses, evGateNumbers],
  );
  const results = pipeline.results;
  const isNoAiEvRegime =
    pipeline.probabilityEngine === "ai" && pipeline.aiRaceRegime === "NO_EV_REGIME";

  const gradesMap = useMemo(() => computeAbilityLetterGrades(horses), [horses]);

  const peers = useMemo(
    () =>
      evalCondition == null
        ? findSameTypePeers([], [], NEUTRAL_CONDITION)
        : findSameTypePeers(horses, results, evalCondition),
    [horses, results, evalCondition],
  );

  const [conditionOpen, setConditionOpen] = useState(false);

  const { conditionOneLine, conditionMetaLine } = useMemo(() => {
    const c = evalCondition;
    if (c == null) {
      return { conditionOneLine: "—", conditionMetaLine: "—" };
    }
    const g = GROUND_ADJUSTMENTS[c.ground]?.label ?? c.ground;
    const clock = TRACK_SPEED_ADJUSTMENTS[c.trackSpeed ?? "standard"]?.label ?? "標準時計";
    const b = BIAS_ADJUSTMENTS[c.bias]?.label ?? c.bias;
    const p = PACE_ADJUSTMENTS[c.pace]?.label ?? c.pace;
    const s =
      c.adjustmentStrength === "weak"
        ? "弱"
        : c.adjustmentStrength === "middle"
          ? "中"
          : "強";
    const lapType =
      c.section200mSec != null && c.section200mSec.length >= 4
        ? classifyLapStructure(c.section200mSec)
        : null;
    const lapText =
      lapType == null
        ? "ラップタイプ未設定"
        : lapType === LAP_STRUCTURE.NEUTRAL
          ? "ラップタイプ: 中間（判定弱）"
          : `ラップタイプ: ${lapType}`;
    const favN = c.favoredHorseNumbers?.length ?? 0;
    const disN = c.disfavoredHorseNumbers?.length ?? 0;
    const gatePickText =
      favN + disN > 0 ? `ゲート指定: 有利${favN}・不利${disN}` : "ゲート指定なし";
    const prefix = abilityOnlyPreview ? "【能力のみ】" : "";
    return {
      conditionOneLine: `${prefix}${c.venue} · ${g} · ${clock} · ${b} · ${p} · 強度${s} · 勝率T${FIXED_SOFTMAX_TEMPERATURE}固定 · ${gatePickText} · ${lapText}`,
      conditionMetaLine: `${prefix}${c.venue} / ${g} / ${clock} / ${b} / ${p} / 強度${s} / 勝率正規化T=${FIXED_SOFTMAX_TEMPERATURE}固定 / ${gatePickText} / ${lapText}`,
    };
  }, [evalCondition, abilityOnlyPreview]);

  const gateOrderHorseIds = useMemo(
    () => entryGateRows.map((r) => r.horseId),
    [entryGateRows],
  );
  /** 出馬表: ◎→○→▲→☆→△ の印順（AI/TS 共通） */
  const sortedForTable = useMemo(() => {
    if (evalCondition == null) return [];
    return sortResultsForPredictionTable(results, gateOrderHorseIds);
  }, [evalCondition, results, gateOrderHorseIds]);
  const maxAdjustedScoreInRace = useMemo(
    () => results.reduce((m, row) => Math.max(m, row.adjustedScore), 0),
    [results],
  );

  const { raceInfo } = race;

  const dateFmt = useMemo(() => {
    if (!raceInfo.date) return raceInfo.date;
    const d = new Date(raceInfo.date + "T00:00:00");
    const m = d.getMonth() + 1;
    const day = d.getDate();
    const dow = ["日", "月", "火", "水", "木", "金", "土"][d.getDay()];
    return `${m}/${day}(${dow})`;
  }, [raceInfo.date]);

  const weatherIcon = useMemo(() => {
    const text = raceInfo.weather ?? "";
    if (text.includes("晴")) return "☀️";
    if (text.includes("曇")) return "⛅";
    if (text.includes("雨")) return "🌧️";
    if (text.includes("雪")) return "❄️";
    return "🌤️";
  }, [raceInfo.weather]);

  const currentIndexItem = useMemo(
    () => raceIndex?.find((r) => r.raceId === race.raceId) ?? null,
    [raceIndex, race.raceId],
  );

  const handleConditionPanelChange = useCallback((next: RaceCondition) => {
    userEditedRef.current = true;
    setAbilityOnlyPreview(false);
    setCondition(next);
  }, []);

  const handleToggleQuickAdjustment = useCallback((key: QuickAdjustmentKey) => {
    userEditedRef.current = true;
    setAbilityOnlyPreview(false);
    setCondition((prev) => ({
      ...prev,
      quickAdjustments: {
        ...prev.quickAdjustments,
        [key]: !(prev.quickAdjustments?.[key] ?? false),
      },
    }));
  }, []);

  const handleResetCondition = useCallback(() => {
    userEditedRef.current = true;
    setAbilityOnlyPreview(false);
    setCondition(buildDefaultNeutralCondition(race, inferredSection200mSec));
  }, [race, inferredSection200mSec]);

  const TABS: { key: ViewTab; label: string }[] = [
    { key: "horses", label: "出馬表" },
    { key: "bets", label: "買い目" },
    { key: "result", label: "結果・回収率" },
  ];

  return (
    <RaceAdjustProvider
      value={{
        condition,
        horses,
        results,
        viewModel: horsesViewModel,
        onConditionChange: handleConditionPanelChange,
        onQuickAdjustmentToggle: handleToggleQuickAdjustment,
      }}
    >
    <div className="app">
      {/* ヘッダ */}
      <header className="app__hero app__hero--compact">
        <p className="app__breadcrumb">
          {raceInfo.venue} · {raceInfo.raceNumber}R · {dateFmt}
        </p>
        <h1>{raceInfo.raceName ?? `${raceInfo.raceNumber}R`}</h1>
        <p className="app__race-sub">
          <span>{raceInfo.surface === "芝" ? "🌿" : "🏇"}{raceInfo.surface}{raceInfo.distance}m</span>
          {raceInfo.groundLabel ? <span>🟢 馬場：{raceInfo.groundLabel}</span> : null}
          {raceInfo.weather ? <span>{weatherIcon} {raceInfo.weather}</span> : null}
        </p>
        <NetkeibaRaceLinks raceId={race.raceId} />
      </header>

      {/* レースナビゲーション */}
      {currentIndexItem && raceIndex && raceIndex.length > 0 && (
        <RaceNavBar current={currentIndexItem} raceIndex={raceIndex} />
      )}

      {/* 条件アコーディオン */}
      <div className="app__condition-sticky">
        <div
          className="condition-quick-actions"
          style={{
            display: "flex",
            flexWrap: "wrap",
            gap: "10px",
            alignItems: "center",
            marginBottom: "8px",
            padding: "8px 12px",
            borderRadius: "8px",
            background: "var(--c-surface-2, rgba(0,0,0,0.04))",
            border: "1px solid var(--c-border, rgba(0,0,0,0.08))",
          }}
        >
          <div
            role="group"
            aria-label="勝率エンジン"
            style={{ display: "inline-flex", gap: "6px", alignItems: "center" }}
          >
            <span style={{ fontSize: "0.85em", color: "var(--c-muted, #6c757d)" }}>勝率:</span>
            <button
              type="button"
              className={`view-density__btn${pipeline.probabilityEngine === "ts" ? " view-density__btn--active" : ""}`}
              onClick={() => setProbabilityEngine("ts")}
              aria-pressed={pipeline.probabilityEngine === "ts"}
            >
              TS評価
            </button>
            <button
              type="button"
              className={`view-density__btn${pipeline.probabilityEngine === "ai" ? " view-density__btn--active" : ""}`}
              onClick={() => setProbabilityEngine("ai")}
              disabled={!aiDataAvailable}
              title={
                aiDataAvailable
                  ? "Python ML（ai_predicted_win_rate）"
                  : "先に scripts/backfill-ai-predictions.py を実行してください"
              }
              aria-pressed={pipeline.probabilityEngine === "ai"}
            >
              Python AI
            </button>
          </div>
          {requestedEngine === "ai" && pipeline.probabilityEngine === "ts" ? (
            <span style={{ fontSize: "0.82em", color: "var(--c-muted, #6c757d)" }}>
              AIデータなし → TSにフォールバック
            </span>
          ) : isNoAiEvRegime ? (
            <span style={{ fontSize: "0.82em", color: "var(--c-warning, #b45309)" }}>
              低期待値見送り推奨（EV推奨なし）
            </span>
          ) : pipeline.probabilityEngine === "ai" ? (
            <span style={{ fontSize: "0.82em", color: "var(--c-muted, #6c757d)" }}>
              方針B: 印・買い目は ai_effective_ev 順（スコア表示はTS参考）
            </span>
          ) : null}
          <label
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: "8px",
              cursor: "pointer",
              fontSize: "0.92em",
            }}
          >
            <input
              type="checkbox"
              checked={abilityOnlyPreview}
              onChange={(e) => setAbilityOnlyPreview(e.target.checked)}
            />
            能力のみ確認
          </label>
          <button type="button" className="view-density__btn" onClick={handleResetCondition}>
            条件リセット
          </button>
          {abilityOnlyPreview ? (
            <span style={{ fontSize: "0.82em", color: "var(--c-muted, #6c757d)" }}>
              印・スコアは中立条件で再計算（編集中の設定は保持）
            </span>
          ) : null}
        </div>
        <div className="condition-accordion" id="condition">
          <button
            type="button"
            className="condition-accordion__trigger"
            id="condition-accordion-btn"
            aria-expanded={conditionOpen}
            aria-controls="condition-accordion-body"
            onClick={() => setConditionOpen((v) => !v)}
          >
            <span className="condition-accordion__row">
              <span className="condition-accordion__h">条件設定</span>
              <span className="condition-accordion__ic" aria-hidden>
                {conditionOpen ? "▼" : "▶"}
              </span>
            </span>
            <span className="condition-accordion__one-line" title={conditionOneLine}>
              {conditionOneLine}
            </span>
          </button>
          {conditionOpen ? (
            <div
              className="condition-accordion__body"
              id="condition-accordion-body"
              role="region"
              aria-labelledby="condition-accordion-btn"
            >
              <RaceAdjustmentPanel
                condition={condition}
                onChange={handleConditionPanelChange}
                embedded
                pinpointGateRows={pinpointGateRows}
              />
              <p className="app__meta">{conditionMetaLine}</p>
            </div>
          ) : null}
        </div>
      </div>

      {isNoAiEvRegime ? (
        <div className="ai-no-ev-banner" role="status">
          <p className="ai-no-ev-banner__text">{NO_EV_REGIME_BANNER_TEXT}</p>
        </div>
      ) : null}

      {/* タブ */}
      <div className="view-tabs" role="tablist" aria-label="表示切り替え">
        {TABS.map(({ key, label }) => (
          <button
            key={key}
            role="tab"
            type="button"
            className={`view-tabs__tab${tab === key ? " view-tabs__tab--active" : ""}`}
            aria-selected={tab === key}
            onClick={() => setTab(key)}
          >
            {label}
          </button>
        ))}
      </div>

      {/* メイン */}
      <div className={`detail-layout${tab === "bets" || tab === "result" ? " detail-layout--wide" : ""}`}>
        <div className="detail-main">
          {tab === "horses" && (
            <RaceConclusionPanel results={results} horses={horses} condition={evalCondition} />
          )}

          {tab === "horses" && (
            <>
              <div className="quick-adjust" role="group" aria-label="直前補正">
                <button
                  type="button"
                  className={`view-density__btn${condition.quickAdjustments?.lastRunReset ? " view-density__btn--active" : ""}`}
                  onClick={() => handleToggleQuickAdjustment("lastRunReset")}
                  aria-pressed={condition.quickAdjustments?.lastRunReset ?? false}
                >
                  前走加点（不利時）
                </button>
              </div>
              <RaceHorsesView
                sorted={sortedForTable}
                horses={horses}
                gradesMap={gradesMap}
                condition={evalCondition}
                viewModel={horsesViewModel}
                maxAdjustedScoreInRace={maxAdjustedScoreInRace}
              />
            </>
          )}

          {tab === "bets" && (
            <RaceBettingDashboard
              results={results}
              horses={horses}
              condition={evalCondition}
              adjustedProbabilities={pipeline.adjustedProbabilities}
              isSkippableRace={pipeline.isSkippableRace}
              probabilityEngine={pipeline.probabilityEngine}
              noAiEvRegime={isNoAiEvRegime}
            />
          )}

          {tab === "result" && (
            <RaceResultAnalysis
              raceId={race.raceId}
              results={results}
              horses={horses}
              condition={evalCondition}
              adjustedProbabilities={pipeline.adjustedProbabilities}
              isSkippableRace={pipeline.isSkippableRace}
              probabilityEngine={pipeline.probabilityEngine}
              noAiEvRegime={isNoAiEvRegime}
            />
          )}

        </div>

        {tab === "horses" && (
          <aside className="detail-sidebar">
            <RaceEvaluationSummary
              raceId={race.raceId}
              condition={evalCondition}
              horses={horses}
              results={results}
              peers={peers}
            />
          </aside>
        )}
      </div>
    </div>
    </RaceAdjustProvider>
  );
}
