import { useEffect, useState } from "react";
import { evaluateRace, type HorseAbility, type HorseScoreResult, type RaceCondition } from "../../domain/race-evaluation";
import { getDismissContextLine } from "../../domain/race-evaluation/reasonGenerator";
import { describeTargetingPlaceholder } from "../../domain/race-evaluation/raceTargeting";
import type { SameTypePeerResult } from "../../domain/race-evaluation/typeMatcher";
import {
  getHorsesFromRaceData,
  getRaceEvaluationById,
  getRaceIndex,
  getRaceResultById,
} from "../../lib/race-data/raceDataRepository";

type Props = {
  raceId: string;
  condition: RaceCondition;
  horses: HorseAbility[];
  results: HorseScoreResult[];
  peers: SameTypePeerResult;
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

type MarkRate = {
  mark: "◎" | "○" | "▲";
  hit: number;
  total: number;
};

type HitStats = {
  sampleSize: number;
  markRates: MarkRate[];
};

async function computeHitStats(limit: number, currentRaceId: string): Promise<HitStats> {
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
    const horses = getHorsesFromRaceData(evalData);
    const scored = evaluateRace(horses, evalData.condition);
    const top3 = new Set(
      result.places
        .filter((p) => p.place >= 1 && p.place <= 3)
        .map((p) => p.horseId)
        .filter((id) => id.length > 0),
    );
    if (top3.size === 0) continue;

    for (const rate of markRates) {
      const picked = scored.find((s) => s.mark === rate.mark);
      if (!picked) continue;
      rate.total += 1;
      if (top3.has(picked.horseId)) {
        rate.hit += 1;
      }
    }
    sampleSize += 1;
    if (sampleSize >= limit) break;
  }

  return { sampleSize, markRates };
}

export function RaceEvaluationSummary({ raceId, condition, horses, results, peers }: Props) {
  const byRank = [...results].sort(
    (a, b) => (a.finalRank ?? a.adjustedRank ?? 99) - (b.finalRank ?? b.adjustedRank ?? 99),
  );
  const first = byRank[0];
  const second = byRank[1];

  const firstHorse = first ? horses.find((h) => h.horseId === first.horseId) : undefined;
  const secondHorse = second ? horses.find((h) => h.horseId === second.horseId) : undefined;

  const dismissReason = getDismissContextLine(condition);
  const [stats, setStats] = useState<HitStats | null>(null);
  const [loadingStats, setLoadingStats] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoadingStats(true);
    void computeHitStats(30, raceId)
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
  }, [raceId]);

  return (
    <aside className="race-summary">
      <h3>レース視点サマリー</h3>

      <p className="race-summary__profile">
        <strong>今回の展開：</strong>
        {peers.profile.label}
      </p>

      <section className="race-summary__block race-summary__block--primary">
        <h4>本命候補</h4>
        <p className="race-summary__horse-line">
          {firstHorse && first ? formatGateName({ gate: gateOf(firstHorse), horseName: first.horseName }) : "—"}
        </p>
      </section>

      <section className="race-summary__block">
        <h4>対抗候補</h4>
        <p className="race-summary__horse-line">
          {secondHorse && second
            ? formatGateName({
                gate: gateOf(secondHorse),
                horseName: second.horseName,
              })
            : "—"}
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
            <p className="race-summary__dismiss-why">集計対象: {stats.sampleSize}レース</p>
            <div className="race-summary__hit-bars" aria-label="印別的中率グラフ">
              {stats.markRates.map((r) => {
                const rate = r.total > 0 ? (r.hit / r.total) * 100 : 0;
                return (
                  <div className="race-summary__hit-row" key={r.mark}>
                    <span className="race-summary__hit-mark">{r.mark}</span>
                    <div className="race-summary__hit-track">
                      <div className="race-summary__hit-fill" style={{ width: `${Math.max(0, Math.min(100, rate))}%` }} />
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
