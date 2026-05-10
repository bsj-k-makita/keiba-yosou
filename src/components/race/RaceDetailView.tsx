import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { motion } from "framer-motion";
import {
  BIAS_ADJUSTMENTS,
  GROUND_ADJUSTMENTS,
  PACE_ADJUSTMENTS,
  TRACK_SPEED_ADJUSTMENTS,
  classifyLapStructure,
  LAP_STRUCTURE,
  computeAbilityLetterGrades,
  findSameTypePeers,
  getFinalWeights,
  weightsToDemand0to100,
  type QuickAdjustmentKey,
  type RaceCondition,
} from "../../domain/race-evaluation";
import { RaceAdjustmentPanel, loadGlobalProfile } from "./RaceAdjustmentPanel";
import { HorseEvaluationCard } from "./HorseEvaluationCard";
import { adjustedScoreToPoints100 } from "./adjustedScorePoints100";
import { formatPredictedTop3Percent } from "./predictedTop3Display";
import { RaceEvaluationSummary } from "./RaceEvaluationSummary";
import { RaceConclusionPanel } from "./RaceConclusionPanel";
import { RaceNavBar } from "./RaceNavBar";
import { NetkeibaRaceLinks } from "./NetkeibaRaceLinks";
import { HorseListTable } from "./HorseListTable";
import { RunningStyleRaceSummary } from "./RunningStyleRaceSummary";
import { RaceResultPanel } from "./RaceResultPanel";
import { RaceBetPanel } from "./RaceBetPanel";
import { RaceAdjustProvider } from "./RaceAdjustContext";
import { getHorsesFromRaceData, getRaceEvaluationById, getRaceResultById, type RaceEvaluationData } from "../../lib/race-data";
import type { RaceIndexItem } from "../../lib/race-data";
import { runRaceEvaluationPipeline } from "../../lib/pipeline/evaluationPipeline";
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

type ViewTab = "list" | "ai" | "cards" | "bets" | "result";
type CardDensity = "regular" | "compact";

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

function markPriority(mark: string | undefined): number {
  if (mark === "◎") return 0;
  if (mark === "○") return 1;
  if (mark === "▲") return 2;
  if (mark === "☆") return 3;
  if (mark === "△") return 4;
  return 5;
}

function hokkakePriority(role: string | undefined): number {
  if (role === "△1安定") return 0;
  if (role === "△2物理") return 1;
  if (role === "△3狙い") return 2;
  return 3;
}

export function RaceDetailView({ race, raceIndex }: Props) {
  const [tab, setTab] = useState<ViewTab>("list");
  const [cardDensity, setCardDensity] = useState<CardDensity>("regular");
  const [tableSummary, setTableSummary] = useState(false);

  const horses = useMemo(() => getHorsesFromRaceData(race), [race]);
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

  const pipeline = useMemo(
    () =>
      horses.length && evalCondition
        ? runRaceEvaluationPipeline(horses, evalCondition)
        : { results: [], viewModel: { byHorseId: new Map() }, adjustedProbabilities: new Map<string, number>() },
    [horses, evalCondition],
  );
  const results = pipeline.results;

  const gradesMap = useMemo(() => computeAbilityLetterGrades(horses), [horses]);

  const peers = useMemo(
    () =>
      evalCondition == null
        ? findSameTypePeers([], [], NEUTRAL_CONDITION)
        : findSameTypePeers(horses, results, evalCondition),
    [horses, results, evalCondition],
  );

  const finalW = useMemo(
    () => getFinalWeights(evalCondition ?? NEUTRAL_CONDITION),
    [evalCondition],
  );

  const demand0to100 = useMemo(() => weightsToDemand0to100(finalW), [finalW]);

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

  /** 出馬票一覧：印順を主軸（◎○▲△☆…）、タイブレークは△役割 → 最終順位 */
  const sorted = useMemo(() => {
    if (evalCondition == null) return [];
    const order = new Map(results.map((r, i) => [r.horseId, i] as const));
    return [...results].sort((a, b) => {
      const ma = markPriority(a.mark);
      const mb = markPriority(b.mark);
      if (ma !== mb) return ma - mb;

      // △同士は役割ラベルの順（安定→物理→展開→その他）で並べる。
      if (a.mark === "△" && b.mark === "△") {
        const ha = hokkakePriority(a.hokkakeRole);
        const hb = hokkakePriority(b.hokkakeRole);
        if (ha !== hb) return ha - hb;
      }

      const da = (a.finalRank ?? a.adjustedRank ?? 99) - (b.finalRank ?? b.adjustedRank ?? 99);
      if (da !== 0) return da;
      return order.get(a.horseId)! - order.get(b.horseId)!;
    });
  }, [evalCondition, results]);
  /** AI予想タブ：補正後スコア降順 */
  const sortedByPtDesc = useMemo(() => {
    if (evalCondition == null) return [];
    return [...results].sort((a, b) => b.adjustedScore - a.adjustedScore);
  }, [evalCondition, results]);
  /** レース全体の補正後スコア最大（比例点数の分母） */
  const maxAdjustedScoreInRace = useMemo(
    () => results.reduce((m, row) => Math.max(m, row.adjustedScore), 0),
    [results],
  );
  const topScore = useMemo(
    () => sorted.reduce((max, row) => Math.max(max, row.adjustedScore), 0),
    [sorted],
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

  // 結果パネルから条件を適用する
  const handleApplySuggest = useCallback((bias: string) => {
    userEditedRef.current = true;
    setAbilityOnlyPreview(false);
    setCondition((prev) => ({ ...prev, bias }));
    setTab("list");
  }, []);

  const handleConditionPanelChange = useCallback((next: RaceCondition) => {
    userEditedRef.current = true;
    setAbilityOnlyPreview(false);
    setCondition(next);
  }, []);

  const handleBetConditionChange = useCallback((next: RaceCondition) => {
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
    { key: "list", label: "出馬表" },
    { key: "ai", label: "AI予想" },
    { key: "cards", label: "詳細カード" },
    { key: "bets", label: "オッズ/買い目" },
    { key: "result", label: "結果確認" },
  ];

  return (
    <RaceAdjustProvider
      value={{
        condition,
        horses,
        results,
        viewModel: pipeline.viewModel,
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
              />
              <p className="app__meta">{conditionMetaLine}</p>
            </div>
          ) : null}
        </div>
      </div>

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
      <div className="detail-layout">
        <div className="detail-main">
          {tab !== "result" && (
            <RaceConclusionPanel results={results} horses={horses} condition={evalCondition} />
          )}

          {/* 一覧タブ */}
          {tab === "list" && (
            <section className="app__entries" aria-label="出走馬一覧">
              <div className="app__entries-head">
                <h2 className="app__section-title app__section-title--pop">
                  出馬表 {horses.length > 0 ? `（${horses.length}頭）` : ""}
                </h2>
                <div className="view-density" role="group" aria-label="一覧表示設定">
                  <button
                    type="button"
                    className={`view-density__btn${tableSummary ? " view-density__btn--active" : ""}`}
                    onClick={() => setTableSummary((v) => !v)}
                    aria-pressed={tableSummary}
                  >
                    サマリー表示
                  </button>
                </div>
              </div>
              <div className="quick-adjust" role="group" aria-label="直前補正クイックトグル">
                <button
                  type="button"
                  className={`view-density__btn${condition.quickAdjustments?.lastRunReset ? " view-density__btn--active" : ""}`}
                  onClick={() => handleToggleQuickAdjustment("lastRunReset")}
                  aria-pressed={condition.quickAdjustments?.lastRunReset ?? false}
                  title="前走でバイアス・展開・末脚と着順のギャップなど『不利』があった馬へ、手動で最終スコアを上乗せ（+12）します。データ由来の「バイアス逆行救済」とは別のオプションです。"
                >
                  前走加点（不利時）
                </button>
              </div>
              <RunningStyleRaceSummary horses={horses} />
              <HorseListTable
                sorted={sorted}
                horses={horses}
                gradesMap={gradesMap}
                condition={evalCondition}
                viewModel={pipeline.viewModel}
                summaryMode={tableSummary}
              />
            </section>
          )}

          {tab === "ai" && (
            <section className="ai-dashboard" aria-label="AI予想ダッシュボード">
              <h2 className="app__section-title app__section-title--pop">AI予想（100点満点）</h2>
              <p className="ai-dashboard__note">
                条件・適性・能力を反映した<strong>補正後スコア</strong>を、このレースで最高の馬を100点とした比例換算です。力差が大きいほど点数も開きます（例：上位90点・下位30点のような分布になり得ます）。
              </p>
              <div className="ai-dashboard__chart">
                {sortedByPtDesc.map((row) => {
                  const horse = horses.find((h) => h.horseId === row.horseId);
                  if (!horse) return null;
                  const score100 = adjustedScoreToPoints100(row.adjustedScore, maxAdjustedScoreInRace);
                  const barPercent =
                    score100 != null
                      ? Math.max(8, score100)
                      : topScore > 0
                        ? Math.max(8, (row.adjustedScore / topScore) * 100)
                        : 0;
                  const top3Label = formatPredictedTop3Percent(horse.investment);
                  return (
                    <div key={row.horseId} className="ai-dashboard__row">
                      <p className="ai-dashboard__name">
                        {horse.frameNumber ?? "?"}枠{horse.gate ?? "?"}番 {horse.horseName}
                      </p>
                      <div className="ai-dashboard__metrics">
                        <div className="ai-dashboard__bar-wrap">
                          <div
                            className="ai-dashboard__bar"
                            style={{ width: `${barPercent}%` }}
                          >
                            {score100 != null ? `${score100}点` : "—"}
                          </div>
                        </div>
                        <div
                          className="ai-dashboard__top3"
                          title="enrich の predicted_probability（単勝確率ベースの変換値）。点数（adjustedScore）とは別ルート。"
                        >
                          <span className="ai-dashboard__top3-lbl">3着内率</span>
                          <span className="ai-dashboard__top3-val">{top3Label}</span>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>
          )}

          {/* 詳細カードタブ */}
          {tab === "cards" && (
            <section className="app__entries" aria-label="出馬表">
              <div className="app__entries-head">
                <h2 className="app__section-title">
                  出馬表 {horses.length > 0 ? `（${horses.length}頭）` : ""}
                </h2>
                <div className="view-density" role="group" aria-label="カード表示密度">
                  <button
                    type="button"
                    className={`view-density__btn${cardDensity === "regular" ? " view-density__btn--active" : ""}`}
                    onClick={() => setCardDensity("regular")}
                    aria-pressed={cardDensity === "regular"}
                  >
                    通常表示
                  </button>
                  <button
                    type="button"
                    className={`view-density__btn${cardDensity === "compact" ? " view-density__btn--active" : ""}`}
                    onClick={() => setCardDensity("compact")}
                    aria-pressed={cardDensity === "compact"}
                  >
                    コンパクト
                  </button>
                </div>
              </div>
              <div className="quick-adjust" role="group" aria-label="直前補正クイックトグル">
                <button
                  type="button"
                  className={`view-density__btn${condition.quickAdjustments?.lastRunReset ? " view-density__btn--active" : ""}`}
                  onClick={() => handleToggleQuickAdjustment("lastRunReset")}
                  aria-pressed={condition.quickAdjustments?.lastRunReset ?? false}
                  title="前走でバイアス・展開・末脚と着順のギャップなど『不利』があった馬へ、手動で最終スコアを上乗せ（+12）します。データ由来の「バイアス逆行救済」とは別のオプションです。"
                >
                  前走加点（不利時）
                </button>
              </div>
              <div className={`app__grid${cardDensity === "compact" ? " app__grid--compact" : ""}`}>
                {sorted.map((r) => {
                  const horse = horses.find((h) => h.horseId === r.horseId)!;
                  const gate = "gate" in horse ? (horse as typeof horse & { gate?: number }).gate : undefined;
                  const grades = gradesMap.get(r.horseId)!;
                  const cardScore100 = adjustedScoreToPoints100(r.adjustedScore, maxAdjustedScoreInRace);
                  return (
                    <motion.div
                      key={r.horseId}
                      layout
                      transition={{ type: "spring", stiffness: 340, damping: 34, mass: 0.65 }}
                    >
                      <HorseEvaluationCard
                        gate={gate}
                        horse={horse}
                        result={r}
                        grades={grades}
                        demand0to100={demand0to100}
                        allHorses={horses}
                        condition={evalCondition}
                        viewModel={pipeline.viewModel}
                        compact={cardDensity === "compact"}
                        scorePoints100={cardScore100}
                      />
                    </motion.div>
                  );
                })}
              </div>
            </section>
          )}

          {/* 結果確認タブ */}
          {tab === "bets" && (
            <RaceBetPanel
              sorted={sorted}
              horses={horses}
              condition={evalCondition}
              viewModel={pipeline.viewModel}
              onConditionChange={handleBetConditionChange}
            />
          )}

          {/* 結果確認タブ */}
          {tab === "result" && (
            <RaceResultPanel
              raceId={race.raceId}
              sorted={sorted}
              horses={horses}
              condition={condition}
              onApplySuggest={handleApplySuggest}
            />
          )}

        </div>

        <aside className="detail-sidebar">
          <RaceEvaluationSummary
            raceId={race.raceId}
            condition={evalCondition}
            horses={horses}
            results={results}
            peers={peers}
          />
        </aside>
      </div>
    </div>
    </RaceAdjustProvider>
  );
}
