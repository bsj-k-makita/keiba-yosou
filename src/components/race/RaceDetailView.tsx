import { useEffect, useMemo, useRef, useState } from "react";
import {
  BIAS_ADJUSTMENTS,
  GROUND_ADJUSTMENTS,
  PACE_ADJUSTMENTS,
  TRACK_SPEED_ADJUSTMENTS,
  classifyLapStructure,
  LAP_STRUCTURE,
  computeAbilityLetterGrades,
  evaluateRace,
  findSameTypePeers,
  getFinalWeights,
  weightsToDemand0to100,
  type RaceCondition,
} from "../../domain/race-evaluation";
import { RaceAdjustmentPanel } from "./RaceAdjustmentPanel";
import { HorseEvaluationCard } from "./HorseEvaluationCard";
import { FutureRaceInsightsStub, RaceEvaluationSummary } from "./RaceEvaluationSummary";
import { RaceConclusionPanel } from "./RaceConclusionPanel";
import { RaceNavBar } from "./RaceNavBar";
import { HorseListTable } from "./HorseListTable";
import { RaceResultPanel } from "./RaceResultPanel";
import { RaceBetPanel } from "./RaceBetPanel";
import { getHorsesFromRaceData, getRaceEvaluationById, getRaceResultById, type RaceEvaluationData } from "../../lib/race-data";
import type { RaceIndexItem } from "../../lib/race-data";

const NEUTRAL_CONDITION: RaceCondition = {
  venue: "東京",
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
  "ground" | "trackSpeed" | "bias" | "pace" | "adjustmentStrength" | "trackBiasStrength01" | "userTrackBias"
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
    userTrackBias: condition.userTrackBias,
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
  const [tab, setTab] = useState<ViewTab>("list");
  const [cardDensity, setCardDensity] = useState<CardDensity>("regular");
  const [tableCompact, setTableCompact] = useState(false);

  const horses = useMemo(() => getHorsesFromRaceData(race), [race]);
  const initialCondition = useMemo<RaceCondition>(() => {
    const inferredSection = inferRaceSection200mFromEntries(race.raceId, horses);
    const carryOver = loadCarryOverCondition(race.raceInfo);
    return {
      ...race.condition,
      ...(carryOver ?? {}),
      raceName: race.condition.raceName ?? race.raceInfo.raceName,
      surface: race.condition.surface ?? race.raceInfo.surface,
      section200mSec: race.condition.section200mSec ?? inferredSection,
    };
  }, [horses, race.condition, race.raceId, race.raceInfo]);
  const [condition, setCondition] = useState<RaceCondition>(initialCondition);
  const userEditedRef = useRef(false);

  useEffect(() => {
    userEditedRef.current = false;
    setCondition(initialCondition);
  }, [initialCondition, race.raceId]);

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
      setCondition((prev) => ({ ...prev, bias }));
    })();
    return () => {
      live = false;
    };
  }, [race.raceId, race.raceInfo, raceIndex]);

  useEffect(() => {
    saveCarryOverCondition(race.raceInfo, condition);
  }, [condition, race.raceInfo]);

  const results = useMemo(
    () => (horses.length && condition ? evaluateRace(horses, condition) : []),
    [horses, condition],
  );

  const gradesMap = useMemo(() => computeAbilityLetterGrades(horses), [horses]);

  const peers = useMemo(
    () =>
      condition == null
        ? findSameTypePeers([], [], NEUTRAL_CONDITION)
        : findSameTypePeers(horses, results, condition),
    [horses, results, condition],
  );

  const finalW = useMemo(
    () => getFinalWeights(condition ?? NEUTRAL_CONDITION),
    [condition],
  );

  const demand0to100 = useMemo(() => weightsToDemand0to100(finalW), [finalW]);

  const [conditionOpen, setConditionOpen] = useState(false);

  const { conditionOneLine, conditionMetaLine } = useMemo(() => {
    if (condition == null) {
      return { conditionOneLine: "—", conditionMetaLine: "—" };
    }
    const g = GROUND_ADJUSTMENTS[condition.ground]?.label ?? condition.ground;
    const clock = TRACK_SPEED_ADJUSTMENTS[condition.trackSpeed ?? "standard"]?.label ?? "標準時計";
    const b = BIAS_ADJUSTMENTS[condition.bias]?.label ?? condition.bias;
    const p = PACE_ADJUSTMENTS[condition.pace]?.label ?? condition.pace;
    const s =
      condition.adjustmentStrength === "weak"
        ? "弱"
        : condition.adjustmentStrength === "middle"
          ? "中"
          : "強";
    const lapType =
      condition.section200mSec != null && condition.section200mSec.length >= 4
        ? classifyLapStructure(condition.section200mSec)
        : null;
    const lapText =
      lapType == null
        ? "ラップタイプ未設定"
        : lapType === LAP_STRUCTURE.NEUTRAL
          ? "ラップタイプ: 中間（判定弱）"
          : `ラップタイプ: ${lapType}`;
    const userBias = condition.userTrackBias ?? 0;
    const userBiasText =
      userBias <= -0.8
        ? "手動補正: 内有利(強)"
        : userBias <= -0.3
          ? "手動補正: 内有利"
          : userBias >= 0.8
            ? "手動補正: 外有利(強)"
            : userBias >= 0.3
              ? "手動補正: 外有利"
              : "手動補正なし";
    return {
      conditionOneLine: `${condition.venue} · ${g} · ${clock} · ${b} · ${p} · 強度${s} · ${userBiasText} · ${lapText}`,
      conditionMetaLine: `${condition.venue} / ${g} / ${clock} / ${b} / ${p} / 強度${s} / ユーザーバイアス${userBias.toFixed(1)} / ${lapText}`,
    };
  }, [condition]);

  const sorted = useMemo(() => {
    if (condition == null) return [];
    const order = new Map(results.map((r, i) => [r.horseId, i] as const));
    return [...results].sort((a, b) => {
      const da = (a.finalRank ?? a.adjustedRank ?? 99) - (b.finalRank ?? b.adjustedRank ?? 99);
      if (da !== 0) return da;
      return order.get(a.horseId)! - order.get(b.horseId)!;
    });
  }, [condition, results]);
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
  function handleApplySuggest(bias: string) {
    userEditedRef.current = true;
    setCondition((prev) => ({ ...prev, bias }));
    setTab("list");
  }

  const TABS: { key: ViewTab; label: string }[] = [
    { key: "list", label: "出馬表" },
    { key: "ai", label: "AI予想" },
    { key: "cards", label: "詳細カード" },
    { key: "bets", label: "オッズ/買い目" },
    { key: "result", label: "結果確認" },
  ];

  return (
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
      </header>

      {/* レースナビゲーション */}
      {currentIndexItem && raceIndex && raceIndex.length > 0 && (
        <RaceNavBar current={currentIndexItem} raceIndex={raceIndex} />
      )}

      {/* 条件アコーディオン */}
      <div className="app__condition-sticky">
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
                onChange={(next) => {
                  userEditedRef.current = true;
                  setCondition(next);
                }}
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
            <RaceConclusionPanel results={results} horses={horses} condition={condition} />
          )}

          {/* 一覧タブ */}
          {tab === "list" && (
            <section className="app__entries" aria-label="出走馬一覧">
              <div className="app__entries-head">
                <h2 className="app__section-title app__section-title--pop">
                  出馬表 {horses.length > 0 ? `（${horses.length}頭）` : ""}
                </h2>
                <button
                  type="button"
                  className={`view-density__btn${tableCompact ? " view-density__btn--active" : ""}`}
                  onClick={() => setTableCompact((v) => !v)}
                  aria-pressed={tableCompact}
                >
                  コンパクト表示
                </button>
              </div>
              <HorseListTable
                sorted={sorted}
                horses={horses}
                gradesMap={gradesMap}
                condition={condition}
                compact={tableCompact}
              />
            </section>
          )}

          {tab === "ai" && (
            <section className="ai-dashboard" aria-label="AI予想ダッシュボード">
              <h2 className="app__section-title app__section-title--pop">AI能力スコア</h2>
              <div className="ai-dashboard__chart">
                {sorted.map((row) => {
                  const horse = horses.find((h) => h.horseId === row.horseId);
                  if (!horse) return null;
                  const barPercent = topScore > 0 ? Math.max(8, (row.adjustedScore / topScore) * 100) : 0;
                  return (
                    <div key={row.horseId} className="ai-dashboard__row">
                      <p className="ai-dashboard__name">
                        {horse.frameNumber ?? "?"}枠{horse.gate ?? "?"}番 {horse.horseName}
                      </p>
                      <div className="ai-dashboard__bar-wrap">
                        <div
                          className="ai-dashboard__bar"
                          style={{ width: `${barPercent}%` }}
                        >
                          {row.adjustedScore.toFixed(1)}pt
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
              <div className={`app__grid${cardDensity === "compact" ? " app__grid--compact" : ""}`}>
                {sorted.map((r) => {
                  const horse = horses.find((h) => h.horseId === r.horseId)!;
                  const gate = "gate" in horse ? (horse as typeof horse & { gate?: number }).gate : undefined;
                  const grades = gradesMap.get(r.horseId)!;
                  return (
                    <HorseEvaluationCard
                      key={r.horseId}
                      gate={gate}
                      horse={horse}
                      result={r}
                      grades={grades}
                      demand0to100={demand0to100}
                      allHorses={horses}
                      condition={condition}
                      compact={cardDensity === "compact"}
                    />
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
              condition={condition}
              onConditionChange={(next) => {
                userEditedRef.current = true;
                setCondition(next);
              }}
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

          {tab !== "result" && (
            <section className="app__supplement" aria-label="補足">
              <h2 className="app__section-title">詳細・補足</h2>
              <FutureRaceInsightsStub />
            </section>
          )}
        </div>

        <aside className="detail-sidebar">
          <RaceEvaluationSummary
            raceId={race.raceId}
            condition={condition}
            horses={horses}
            results={results}
            peers={peers}
          />
        </aside>
      </div>
    </div>
  );
}
