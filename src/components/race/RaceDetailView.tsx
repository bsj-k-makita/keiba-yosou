import { useEffect, useMemo, useState } from "react";
import {
  computeAbilityLetterGrades,
  type RaceCondition,
} from "../../domain/race-evaluation";
import { RaceConclusionPanel } from "./RaceConclusionPanel";
import { NetkeibaRaceLinks } from "./NetkeibaRaceLinks";
import { RaceHorsesView } from "./RaceHorsesView";
import { RaceBettingDashboard } from "./RaceBettingDashboard";
import { RaceResultAnalysis } from "./RaceResultAnalysis";
import {
  getHorsesFromRaceData,
  ensureRaceResultFetched,
  getSortedRaceEntryGateRows,
  type RaceEvaluationData,
} from "../../lib/race-data";
import {
  loadMarkSnapshotFromLocalStorage,
  saveMarkSnapshotToLocalStorage,
  isValidMarkSnapshot,
  clearStaleMarkSnapshotsFromLocalStorage,
} from "../../lib/race-data/markSnapshotStorage";
import type { AiMarkSnapshot } from "../../lib/race-data/raceEvaluationTypes";
import { runRaceEvaluationPipeline } from "../../lib/pipeline/evaluationPipeline";
import { NO_EV_REGIME_BANNER_TEXT } from "../../lib/pipeline/aiEvRegime";
import { buildRaceBettingContextFromPipeline } from "../../domain/betting/buildRaceBettingContext";
import { applyEvRecommendedFlags } from "../../viewModel/raceEvaluationViewModel";
import { DEFAULT_PROBABILITY_ENGINE } from "../../lib/pipeline/probabilityEngine";
import { sortResultsForPredictionTable } from "../../domain/race-evaluation/markHitAnalysis";
import { buildDefaultNeutralCondition } from "./neutralRaceCondition";

type ViewTab = "horses" | "bets" | "result";

type Props = {
  race: RaceEvaluationData;
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

export function RaceDetailView({ race }: Props) {
  const [tab, setTab] = useState<ViewTab>("horses");

  const horses = useMemo(() => getHorsesFromRaceData(race), [race]);
  const entryGateRows = useMemo(() => getSortedRaceEntryGateRows(race), [race]);
  const inferredSection200mSec = useMemo(
    () => inferRaceSection200mFromEntries(race.raceId, horses),
    [race.raceId, horses],
  );
  const evalCondition = useMemo<RaceCondition>(
    () => ({
      ...buildDefaultNeutralCondition(race, inferredSection200mSec),
      ...race.condition,
      raceName: race.condition.raceName ?? race.raceInfo.raceName,
      surface: race.condition.surface ?? race.raceInfo.surface,
      section200mSec: race.condition.section200mSec ?? inferredSection200mSec,
    }),
    [race, inferredSection200mSec],
  );

  /** レース表示時に結果を自動取得（結果タブを開かなくてもキャッシュされる） */
  useEffect(() => {
    void ensureRaceResultFetched(race.raceId);
  }, [race.raceId]);

  const requestedEngine = DEFAULT_PROBABILITY_ENGINE;
  const [markSnapshot, setMarkSnapshot] = useState<AiMarkSnapshot | null>(() => {
    const fromRace = race.raceInfo.aiMarkSnapshot;
    const fromStorage = loadMarkSnapshotFromLocalStorage(race.raceId);
    const snap = fromRace ?? fromStorage;
    return isValidMarkSnapshot(snap) ? snap : null;
  });

  useEffect(() => {
    clearStaleMarkSnapshotsFromLocalStorage();
  }, []);

  const pipeline = useMemo(
    () =>
      horses.length && evalCondition
        ? runRaceEvaluationPipeline(horses, evalCondition, {
            probabilityEngine: requestedEngine,
            raceInfo: race.raceInfo,
            markSnapshot,
          })
        : {
            results: [],
            viewModel: { byHorseId: new Map(), probabilityEngine: "ts" as const },
            adjustedProbabilities: new Map<string, number>(),
            probabilityEngine: "ts" as const,
            aiRaceRegime: "NORMAL_AI_REGIME" as const,
            tsReferenceResults: [],
            isSkippableRace: false,
            marksFrozen: false,
            pendingMarkSnapshot: null,
          },
    [horses, evalCondition, requestedEngine, race.raceInfo, markSnapshot],
  );

  useEffect(() => {
    const snap = pipeline.pendingMarkSnapshot;
    if (snap == null) return;
    saveMarkSnapshotToLocalStorage(race.raceId, snap);
    setMarkSnapshot((prev) => {
      if (prev != null && prev.frozenAt === snap.frozenAt) {
        const prevKeys = Object.keys(prev.marksByHorseId).sort().join();
        const nextKeys = Object.keys(snap.marksByHorseId).sort().join();
        if (prevKeys === nextKeys) {
          let same = true;
          for (const k of Object.keys(snap.marksByHorseId)) {
            if (prev.marksByHorseId[k] !== snap.marksByHorseId[k]) {
              same = false;
              break;
            }
          }
          if (same) return prev;
        }
      }
      return snap;
    });
  }, [pipeline.pendingMarkSnapshot, race.raceId]);
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

  const gateOrderHorseIds = useMemo(
    () => entryGateRows.map((r) => r.horseId),
    [entryGateRows],
  );
  /** 出馬表: ◎→○→▲→☆→△ の印順（AI/TS 共通） */
  const sortedForTable = useMemo(() => {
    if (evalCondition == null) return [];
    return sortResultsForPredictionTable(results, gateOrderHorseIds);
  }, [evalCondition, results, gateOrderHorseIds]);

  const { raceInfo } = race;

  const dateFmt = useMemo(() => {
    if (!raceInfo.date) return raceInfo.date;
    const d = new Date(raceInfo.date + "T00:00:00");
    const m = d.getMonth() + 1;
    const day = d.getDate();
    const dow = ["日", "月", "火", "水", "木", "金", "土"][d.getDay()];
    return `${m}/${day}(${dow})`;
  }, [raceInfo.date]);

  const TABS: { key: ViewTab; label: string }[] = [
    { key: "horses", label: "出馬表" },
    { key: "bets", label: "買い目" },
    { key: "result", label: "結果" },
  ];

  return (
    <div className="app app--race-detail app--race-detail-simple">
      <header className="rl-simple-head app__hero app__hero--compact">
        <p className="app__breadcrumb">
          {raceInfo.venue} · {raceInfo.raceNumber}R · {dateFmt}
        </p>
        <h1>{raceInfo.raceName ?? `${raceInfo.raceNumber}R`}</h1>
        <p className="app__race-sub">
          <span>
            {raceInfo.surface}
            {raceInfo.distance}m
          </span>
          {raceInfo.groundLabel ? <span>馬場 {raceInfo.groundLabel}</span> : null}
          {raceInfo.weather ? <span>{raceInfo.weather}</span> : null}
          {raceInfo.postTime ? <span>発走 {raceInfo.postTime}</span> : null}
        </p>
        <NetkeibaRaceLinks raceId={race.raceId} />
      </header>

      {isNoAiEvRegime ? (
        <div className="ai-no-ev-banner" role="status">
          <p className="ai-no-ev-banner__text">{NO_EV_REGIME_BANNER_TEXT}</p>
        </div>
      ) : null}

      <div className="view-tabs rl-simple-tabs rl-simple-tabs--section" role="tablist" aria-label="表示切り替え">
        {TABS.map(({ key, label }) => (
          <button
            key={key}
            role="tab"
            type="button"
            className={`view-tabs__tab rl-simple-tab${tab === key ? " view-tabs__tab--active is-active" : ""}`}
            aria-selected={tab === key}
            onClick={() => setTab(key)}
          >
            {label}
          </button>
        ))}
      </div>

      {/* メイン */}
      <div className={`detail-layout${tab === "bets" ? " detail-layout--wide" : ""}`}>
        <div className="detail-main">
          {tab === "horses" && (
            <RaceConclusionPanel results={results} horses={horses} condition={evalCondition} />
          )}

          {tab === "horses" && (
            <>
              <RaceHorsesView
                sorted={sortedForTable}
                horses={horses}
                gradesMap={gradesMap}
                condition={evalCondition}
                viewModel={horsesViewModel}
              />
            </>
          )}

          {tab === "bets" && (
            <RaceBettingDashboard
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
      </div>
    </div>
  );
}
