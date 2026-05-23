import { useEffect, useState } from "react";
import {
  evaluateRace,
  type HorseAbility,
  type HorseScoreResult,
  type RaceCondition,
} from "../../domain/race-evaluation";
import { analyzeMarkHits } from "../../domain/race-evaluation/markHitAnalysis";
import { describeTargetingPlaceholder } from "../../domain/race-evaluation/raceTargeting";
import { ensureFrontendDisplayMarks } from "../../lib/race-display/ensureFrontendDisplayMarks";
import { getDismissContextLine } from "../../domain/race-evaluation/reasonGenerator";
import type { SameTypePeerResult } from "../../domain/race-evaluation/typeMatcher";
import {
  getHorsesFromRaceData,
  getRaceEvaluationById,
  getRaceIndex,
  getRaceResultById,
} from "../../lib/race-data/raceDataRepository";
import { runRaceEvaluationPipeline } from "../../lib/pipeline/evaluationPipeline";
import {
  raceHasAiEngineReady,
  type ProbabilityEngine,
} from "../../lib/pipeline/probabilityEngine";

type Props = {
  raceId: string;
  condition: RaceCondition;
  horses: HorseAbility[];
  results: HorseScoreResult[];
  peers: SameTypePeerResult;
  probabilityEngine: ProbabilityEngine;
};

function formatGateName(entry: { gate?: number; horseName: string }): string {
  return entry.gate != null ? `${entry.gate}番 ${entry.horseName}` : entry.horseName;
}

function gateOf(h: HorseAbility): number | undefined {
  if ("gate" in h && typeof (h as { gate?: number }).gate === "number") {
    return (h as { gate?: number }).gate;
  }
  return undefined;
}

function pickMark(
  results: readonly HorseScoreResult[],
  mark: "◎" | "○" | "▲",
): HorseScoreResult | undefined {
  return results.find((r) => r.mark === mark);
}

type MarkRate = {
  mark: "◎" | "○" | "▲";
  hit: number;
  total: number;
};

type HitStats = {
  sampleSize: number;
  markRates: MarkRate[];
};

function pooledHitPercent(markRates: MarkRate[]): number {
  let hit = 0;
  let total = 0;
  for (const r of markRates) {
    hit += r.hit;
    total += r.total;
  }
  if (total === 0) return 0;
  return (hit / total) * 100;
}

function scoreRaceForHitStats(
  evalData: NonNullable<Awaited<ReturnType<typeof getRaceEvaluationById>>>,
  engine: ProbabilityEngine,
): HorseScoreResult[] {
  const raceHorses = getHorsesFromRaceData(evalData);
  if (engine === "ai" && raceHasAiEngineReady(raceHorses)) {
    return runRaceEvaluationPipeline(raceHorses, evalData.condition, {
      probabilityEngine: "ai",
      raceInfo: evalData.raceInfo,
    }).results;
  }
  return ensureFrontendDisplayMarks(
    evaluateRace(raceHorses, evalData.condition),
    raceHorses,
    evalData.condition,
  );
}

async function computeHitStats(
  limit: number,
  currentRaceId: string,
  engine: ProbabilityEngine,
): Promise<HitStats> {
  const index = await getRaceIndex();
  const markRates: MarkRate[] = [
    { mark: "◎", hit: 0, total: 0 },
    { mark: "○", hit: 0, total: 0 },
    { mark: "▲", hit: 0, total: 0 },
  ];
  let sampleSize = 0;

  for (const row of index) {
    if (row.raceId === currentRaceId) continue;
    const result = await getRaceResultById(row.raceId);
    if (result == null || result.places.length < 3) continue;
    const evalData = await getRaceEvaluationById(row.raceId);
    if (evalData == null) continue;
    const raceHorses = getHorsesFromRaceData(evalData);
    const scored = scoreRaceForHitStats(evalData, engine);
    const { winners, rows } = analyzeMarkHits(result.places, scored, raceHorses);
    if (winners.size === 0) continue;

    for (const rate of markRates) {
      const hitRow = rows.find((r) => r.mark === rate.mark);
      if (!hitRow) continue;
      rate.total += 1;
      if (hitRow.hit) {
        rate.hit += 1;
      }
    }
    sampleSize += 1;
    if (sampleSize >= limit) break;
  }

  return { sampleSize, markRates };
}

export function RaceEvaluationSummary({
  raceId,
  condition,
  horses,
  results,
  peers,
  probabilityEngine,
}: Props) {
  const hon = pickMark(results, "◎");
  const ta = pickMark(results, "○");

  const honHorse = hon ? horses.find((h) => h.horseId === hon.horseId) : undefined;
  const taHorse = ta ? horses.find((h) => h.horseId === ta.horseId) : undefined;

  const dismissReason = getDismissContextLine(condition);
  const [stats, setStats] = useState<HitStats | null>(null);
  const [loadingStats, setLoadingStats] = useState(true);

  const engineLabel =
    probabilityEngine === "ai" ? "Python AI（ai_effective_ev 印）" : "TS評価（能力スコア印）";

  useEffect(() => {
    let cancelled = false;
    setLoadingStats(true);
    void computeHitStats(30, raceId, probabilityEngine)
      .then((next) => {
        if (cancelled) return;
        setStats(next);
      })
      .finally(() => {
        if (cancelled) return;
        setLoadingStats(false);
      });
    return () => {
      cancelled = true;
    };
  }, [raceId, probabilityEngine]);

  return (
    <aside className="race-summary">
      <h3>レース視点サマリー</h3>
      <p className="race-summary__profile">
        <strong>評価:</strong> {engineLabel}
      </p>

      <p className="race-summary__profile">
        <strong>今回の展開：</strong>
        {peers.profile.label}
      </p>

      <section className="race-summary__block race-summary__block--primary">
        <h4>本命候補（◎）</h4>
        <p className="race-summary__horse-line">
          {honHorse && hon ? formatGateName({ gate: gateOf(honHorse), horseName: hon.horseName }) : "—"}
        </p>
      </section>

      <section className="race-summary__block">
        <h4>対抗候補（○）</h4>
        <p className="race-summary__horse-line">
          {taHorse && ta ? formatGateName({ gate: gateOf(taHorse), horseName: ta.horseName }) : "—"}
        </p>
      </section>

      <section className="race-summary__block">
        <h4>一緒に買いたい馬</h4>
        <p className="race-summary__horse-line">
          {peers.peerEntries.length
            ? peers.peerEntries.map((e) => formatGateName(e)).join("、")
            : "—"}
        </p>
      </section>

      <section className="race-summary__block">
        <h4>消し候補</h4>
        <p className="race-summary__horse-line">
          {peers.dismissEntries.length
            ? peers.dismissEntries.map((e) => formatGateName(e)).join("、")
            : "—"}
        </p>
        {peers.dismissEntries.length > 0 ? (
          <p className="race-summary__dismiss-why">理由：{dismissReason}</p>
        ) : null}
      </section>

      <section className="race-summary__block">
        <h4>直近30レース 的中率</h4>
        {loadingStats ? (
          <p className="race-summary__dismiss-why">集計中…</p>
        ) : stats == null || stats.sampleSize === 0 ? (
          <p className="race-summary__dismiss-why">結果データが不足しています</p>
        ) : (
          <>
            <p className="race-summary__dismiss-why">
              全体（◎〜▲複勝圏）: <strong>{pooledHitPercent(stats.markRates).toFixed(0)}%</strong>
              {" · "}
              集計 {stats.sampleSize}レース（{engineLabel}・全日程混在）
            </p>
            <div className="race-summary__hit-bars" aria-label="印別内訳">
              {stats.markRates.map((r) => {
                const rate = r.total > 0 ? (r.hit / r.total) * 100 : 0;
                return (
                  <div className="race-summary__hit-row" key={r.mark}>
                    <span className="race-summary__hit-mark">{r.mark}</span>
                    <div className="race-summary__hit-track">
                      <div
                        className="race-summary__hit-fill"
                        style={{ width: `${Math.max(0, Math.min(100, rate))}%` }}
                      />
                    </div>
                    <span className="race-summary__hit-value">{rate.toFixed(0)}%</span>
                  </div>
                );
              })}
            </div>
          </>
        )}
      </section>
    </aside>
  );
}

export function FutureRaceInsightsStub() {
  return (
    <section className="app__footer-notes">
      <h3 className="app__section-title">レース狙い度（将来）</h3>
      <p>{describeTargetingPlaceholder()}</p>
      <p className="app__future-compare" aria-label="比較モードは今後提供予定です">
        2頭比較モード：準備中
      </p>
    </section>
  );
}
