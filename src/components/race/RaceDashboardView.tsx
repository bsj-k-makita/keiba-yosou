import { useEffect, useMemo, useState } from "react";
import {
  BIAS_ADJUSTMENTS,
  GROUND_ADJUSTMENTS,
  PACE_ADJUSTMENTS,
  TRACK_SPEED_ADJUSTMENTS,
  computeAbilityLetterGrades,
  evaluateRace,
  type HorseAbility,
  type HorseScoreResult,
  type RaceCondition,
} from "../../domain/race-evaluation";
import { BUY_LABELS } from "../../domain/race-evaluation/lingoConstants";
import type { RaceEvaluationData } from "../../lib/race-data";
import { getHorsesFromRaceData } from "../../lib/race-data";
import { ensureFrontendDisplayMarks } from "../../lib/race-display/ensureFrontendDisplayMarks";
import {
  applyAiMarksByEffectiveEv,
  raceHasFullAiBackfill,
} from "../../lib/pipeline/aiMarkAssignment";
import {
  buildOddsMapForEvEvaluation,
  estimatePairProbability,
  estimateTrifectaProbability,
} from "../../domain/betting/bettingRules";
import { getEffectiveEvaluationSignals } from "../../domain/race-evaluation/resolveEvaluationSignals";
import { HorseAbilityInsightPanel } from "./HorseAbilityInsightPanel";

type Props = {
  race: RaceEvaluationData;
};

type MyBetType = "WIN" | "REN" | "WREN" | "TRI";

const EVALUATION_BREAKDOWN_DEFS = [
  { key: "baseAbilityCore", label: "ベース能力（基礎素点）" },
  { key: "paceFitBonus", label: "ペース適性ボーナス" },
  { key: "distanceFitBonus", label: "距離適性ボーナス" },
  { key: "classLevelBonus", label: "クラス適性ボーナス" },
  { key: "pedigreeBonus", label: "血統適性ボーナス" },
  { key: "gateBiasBonus", label: "枠順・馬場バイアス補正" },
  { key: "gateStyleSynergyBonus", label: "枠順×脚質シナジー" },
  { key: "connectionsBonus", label: "騎手・厩舎補正" },
  { key: "trendBonus", label: "近走トレンド補正" },
  { key: "tripContextBonus", label: "レース文脈補正" },
  { key: "paceBalanceBonus", label: "前後傾バランス補正" },
  { key: "raceAnalysisBonus", label: "同条件分析ボーナス" },
  { key: "lapSustainBonus", label: "ラップ持続力ボーナス" },
  { key: "lapQualityBonus", label: "ラップ質ボーナス" },
  { key: "stepPatternBonus", label: "黄金ステップ補正" },
  { key: "lastMinuteAdjustmentBonus", label: "直前調整ボーナス" },
] as const;

function toGroundBySlider(v: number): RaceCondition["ground"] {
  if (v <= 24) return "good";
  if (v <= 49) return "yielding";
  if (v <= 74) return "heavy";
  return "bad";
}

function toTrackSpeedBySlider(v: number): NonNullable<RaceCondition["trackSpeed"]> {
  if (v <= -34) return "slow";
  if (v >= 34) return "fast";
  return "standard";
}

function toPaceBySlider(v: number): RaceCondition["pace"] {
  if (v <= -60) return "no_front_runner";
  if (v <= -20) return "slow";
  if (v < 20) return "middle";
  if (v < 60) return "high";
  return "many_front_runners";
}

function toBiasBySlider(v: number): RaceCondition["bias"] {
  if (v <= -60) return "closer_favor";
  if (v <= -20) return "outside_favor";
  if (v < 20) return "flat";
  if (v < 60) return "inside_favor";
  return "front_favor";
}

function horseNo(horse: HorseAbility, idx: number): number {
  const fromGate = (horse as { gate?: number }).gate;
  if (fromGate != null && Number.isFinite(fromGate)) return Math.round(fromGate);
  const fromFrame = horse.frameNumber;
  if (fromFrame != null && Number.isFinite(fromFrame)) return Math.round(fromFrame);
  return idx + 1;
}

function pairKey(a: number, b: number): string {
  return [a, b].sort((x, y) => x - y).join("-");
}

function triKey(a: number, b: number, c: number): string {
  return [a, b, c].sort((x, y) => x - y).join("-");
}

function pacePressureText(pace: string): string {
  const map: Record<string, string> = {
    no_front_runner: "先手不在",
    slow: "低速",
    middle: "標準",
    high: "高圧",
    many_front_runners: "先行争い",
  };
  return map[pace] ?? pace;
}

function visualSignal(row: HorseScoreResult, horse: HorseAbility): { icon: string; tone: string } | null {
  const ev = horse.aiEffectiveEv;
  const odds = getEffectiveEvaluationSignals(horse)?.winOdds;
  if (ev != null && ev >= 1.3) return { icon: "🔥", tone: "hot" };
  if (odds != null && odds <= 4 && (ev ?? 0.95) < 1.0) return { icon: "🚨", tone: "risk" };
  if (row.buyLabel === BUY_LABELS.DISMISS) return { icon: "💀", tone: "off" };
  return null;
}

function toPercent(value: number | null): string {
  if (value == null || !Number.isFinite(value)) return "--";
  return `${(value * 100).toFixed(2)}%`;
}

function toOdds(value: number | null): string {
  if (value == null || !Number.isFinite(value)) return "--";
  return `${value.toFixed(1)}x`;
}

function toSigned(value: number): string {
  const p = value >= 0 ? "+" : "";
  return `${p}${value.toFixed(2)}`;
}

function glowClass(ev: number | null): string {
  if (ev == null) return "";
  if (ev >= 1.3) return "rdv-neon rdv-neon--gold";
  if (ev >= 1.0) return "rdv-neon rdv-neon--green";
  return "rdv-neon rdv-neon--red";
}

function normalizedProbByHorse(horses: readonly HorseAbility[]): Map<string, number> {
  const raw = new Map<string, number>();
  let sum = 0;
  for (const h of horses) {
    const ai = h.aiPredictedWinRate;
    const odds = getEffectiveEvaluationSignals(h)?.winOdds;
    const p =
      ai != null && Number.isFinite(ai) && ai > 0
        ? ai
        : odds != null && Number.isFinite(odds) && odds > 0
          ? 1 / odds
          : 0;
    if (p <= 0) continue;
    raw.set(h.horseId, p);
    sum += p;
  }
  if (sum <= 0) return raw;
  return new Map([...raw.entries()].map(([id, p]) => [id, p / sum]));
}

function buildEvaluationBreakdown(row: HorseScoreResult): { label: string; value: number }[] {
  return EVALUATION_BREAKDOWN_DEFS.map((item) => ({
    label: item.label,
    value: row[item.key],
  }))
    .filter((item) => Math.abs(item.value) >= 0.05)
    .sort((a, b) => Math.abs(b.value) - Math.abs(a.value));
}

function buildAiShortComment(row: HorseScoreResult, horse: HorseAbility): string {
  if (row.predictionShortComment != null && row.predictionShortComment.trim().length > 0) {
    return row.predictionShortComment;
  }
  if (row.reason?.trim()) return row.reason;
  if (row.buyLabel === BUY_LABELS.DISMISS) return "消し条件に該当。相手候補からは外したい一頭です。";
  const ev = horse.aiEffectiveEv;
  if (ev != null && ev >= 1.2) return "期待値が高く、軸〜相手の中心として評価できます。";
  if (ev != null && ev < 1.0) return "現時点では妙味が薄く、過信は禁物です。";
  return "全体バランスは悪くなく、展開次第で圏内が狙える評価です。";
}

export function RaceDashboardView({ race }: Props) {
  const horses = useMemo(() => getHorsesFromRaceData(race), [race]);
  const gradesMap = useMemo(() => computeAbilityLetterGrades(horses), [horses]);
  const styleCounts = useMemo(() => {
    const counts = { front: 0, mid: 0, back: 0 };
    for (const h of horses) {
      if (h.runningStyle === "逃げ" || h.runningStyle === "先行") counts.front += 1;
      else if (h.runningStyle === "差し" || h.runningStyle === "追込") counts.back += 1;
      else counts.mid += 1;
    }
    return counts;
  }, [horses]);

  const [groundSlider, setGroundSlider] = useState(25);
  const [paceSlider, setPaceSlider] = useState(0);
  const [biasSlider, setBiasSlider] = useState(0);
  const [trackSpeedSlider, setTrackSpeedSlider] = useState(0);
  const [selectedHorseId, setSelectedHorseId] = useState<string | null>(null);
  const [myBetType, setMyBetType] = useState<MyBetType>("REN");
  const [myTray, setMyTray] = useState<number[]>([]);

  const simulatedCondition = useMemo<RaceCondition>(() => {
    return {
      ...race.condition,
      raceName: race.condition.raceName ?? race.raceInfo.raceName,
      surface: race.condition.surface ?? race.raceInfo.surface,
      distance: race.condition.distance ?? race.raceInfo.distance,
      ground: toGroundBySlider(groundSlider),
      pace: toPaceBySlider(paceSlider),
      bias: toBiasBySlider(biasSlider),
      trackSpeed: toTrackSpeedBySlider(trackSpeedSlider),
      trackCushion01: Math.max(0, Math.min(1, (100 - groundSlider) / 100)),
      adjustmentStrength: "middle",
    };
  }, [biasSlider, groundSlider, paceSlider, race.condition, race.raceInfo.distance, race.raceInfo.raceName, race.raceInfo.surface, trackSpeedSlider]);

  const rawResults = useMemo(
    () => evaluateRace(horses, simulatedCondition),
    [horses, simulatedCondition],
  );
  const scoredResults = useMemo(() => {
    if (raceHasFullAiBackfill(horses)) {
      return applyAiMarksByEffectiveEv(rawResults, horses, simulatedCondition);
    }
    return ensureFrontendDisplayMarks(rawResults, horses, simulatedCondition);
  }, [horses, rawResults, simulatedCondition]);

  const horseById = useMemo(() => new Map(horses.map((h, idx) => [h.horseId, { horse: h, number: horseNo(h, idx) }])), [horses]);
  const sortedRows = useMemo(
    () =>
      [...scoredResults].sort((a, b) => {
        const aHorse = horseById.get(a.horseId)?.horse;
        const bHorse = horseById.get(b.horseId)?.horse;
        const aEv = aHorse?.aiEffectiveEv ?? 0;
        const bEv = bHorse?.aiEffectiveEv ?? 0;
        if (aEv !== bEv) return bEv - aEv;
        return (b.finalEvaluationScore ?? 0) - (a.finalEvaluationScore ?? 0);
      }),
    [horseById, scoredResults],
  );

  useEffect(() => {
    if (sortedRows.length === 0) return;
    if (selectedHorseId == null || !sortedRows.some((r) => r.horseId === selectedHorseId)) {
      setSelectedHorseId(sortedRows[0]!.horseId);
    }
  }, [selectedHorseId, sortedRows]);

  const selectedRow = useMemo(
    () => sortedRows.find((row) => row.horseId === selectedHorseId) ?? sortedRows[0] ?? null,
    [selectedHorseId, sortedRows],
  );
  const selectedHorseCtx = selectedRow ? horseById.get(selectedRow.horseId) : undefined;
  const selectedHorse = selectedHorseCtx?.horse;
  const selectedGrades = selectedRow ? gradesMap.get(selectedRow.horseId) ?? null : null;
  const evaluationBreakdown = useMemo(
    () => (selectedRow ? buildEvaluationBreakdown(selectedRow) : []),
    [selectedRow],
  );
  const positiveFactors = useMemo(
    () => evaluationBreakdown.filter((item) => item.value > 0),
    [evaluationBreakdown],
  );
  const negativeFactors = useMemo(
    () => evaluationBreakdown.filter((item) => item.value < 0),
    [evaluationBreakdown],
  );

  const normalizedByHorse = useMemo(() => normalizedProbByHorse(horses), [horses]);
  const normalizedByNo = useMemo(() => {
    const out = new Map<number, number>();
    for (const [horseId, p] of normalizedByHorse) {
      const number = horseById.get(horseId)?.number;
      if (number != null) out.set(number, p);
    }
    return out;
  }, [horseById, normalizedByHorse]);
  const evOddsMap = useMemo(
    () => buildOddsMapForEvEvaluation(horses, undefined, normalizedByNo),
    [horses, normalizedByNo],
  );

  const requiredCount = myBetType === "TRI" ? 3 : myBetType === "WIN" ? 1 : 2;
  const selectedForCalc = myTray.slice(0, requiredCount).sort((a, b) => a - b);

  const myBetProbability = useMemo(() => {
    if (selectedForCalc.length !== requiredCount) return null;
    if (myBetType === "WIN") {
      return normalizedByNo.get(selectedForCalc[0]!) ?? null;
    }
    if (myBetType === "REN" || myBetType === "WREN") {
      const p1 = normalizedByNo.get(selectedForCalc[0]!) ?? 0;
      const p2 = normalizedByNo.get(selectedForCalc[1]!) ?? 0;
      if (p1 <= 0 || p2 <= 0) return null;
      return estimatePairProbability(p1, p2);
    }
    const p1 = normalizedByNo.get(selectedForCalc[0]!) ?? 0;
    const p2 = normalizedByNo.get(selectedForCalc[1]!) ?? 0;
    const p3 = normalizedByNo.get(selectedForCalc[2]!) ?? 0;
    if (p1 <= 0 || p2 <= 0 || p3 <= 0) return null;
    return estimateTrifectaProbability(p1, p2, p3);
  }, [myBetType, normalizedByNo, requiredCount, selectedForCalc]);

  const myBetOdds = useMemo(() => {
    if (selectedForCalc.length !== requiredCount) return null;
    if (myBetType === "WIN") return evOddsMap.win[selectedForCalc[0]!];
    if (myBetType === "REN") return evOddsMap.ren?.[pairKey(selectedForCalc[0]!, selectedForCalc[1]!)];
    if (myBetType === "WREN") return evOddsMap.wide?.[pairKey(selectedForCalc[0]!, selectedForCalc[1]!)];
    return evOddsMap.trifecta?.[triKey(selectedForCalc[0]!, selectedForCalc[1]!, selectedForCalc[2]!)];
  }, [evOddsMap, myBetType, requiredCount, selectedForCalc]);

  const myBetEv =
    myBetProbability != null && myBetOdds != null && Number.isFinite(myBetProbability) && Number.isFinite(myBetOdds)
      ? myBetProbability * myBetOdds
      : null;

  const myBetMeter = Math.max(0, Math.min(1, (myBetEv ?? 0) / 2));
  const maxStyleCount = Math.max(1, styleCounts.front, styleCounts.mid, styleCounts.back);

  return (
    <section className="rdv-shell rdv-shell--game transition-all duration-300 ease-in-out">
      <header className="rdv-topboard transition-all duration-300 ease-in-out">
        <div className="rdv-topboard__race">
          <p className="rdv-kicker">RACE CONSOLE</p>
          <h1>{race.raceInfo.venue} {race.raceInfo.raceNumber}R</h1>
          <p className="rdv-subhead">
            {race.raceInfo.raceName ?? `${race.raceInfo.raceNumber}R`} / {race.raceInfo.surface}{race.raceInfo.distance}m
          </p>
          <div className="rdv-chiprow">
            <span className="rdv-chip">{GROUND_ADJUSTMENTS[simulatedCondition.ground]?.label ?? simulatedCondition.ground}</span>
            <span className="rdv-chip">{TRACK_SPEED_ADJUSTMENTS[simulatedCondition.trackSpeed ?? "standard"]?.label ?? simulatedCondition.trackSpeed}</span>
            <span className="rdv-chip">{BIAS_ADJUSTMENTS[simulatedCondition.bias]?.label ?? simulatedCondition.bias}</span>
            <span className="rdv-chip">{PACE_ADJUSTMENTS[simulatedCondition.pace]?.label ?? simulatedCondition.pace}</span>
          </div>
        </div>
        <div className="rdv-topboard__macro">
          <article className="rdv-panel">
            <p className="rdv-panel__title">馬場バイアス</p>
            <div className="rdv-bias-meter">
              <div className="rdv-bias-meter__rail" />
              <div className="rdv-bias-meter__needle" style={{ left: `${((biasSlider + 100) / 200) * 100}%` }} />
            </div>
            <p className="rdv-panel__value">{BIAS_ADJUSTMENTS[simulatedCondition.bias]?.label ?? simulatedCondition.bias}</p>
          </article>
          <article className="rdv-panel">
            <p className="rdv-panel__title">想定ペース / 隊列</p>
            <div className="rdv-pack-bars" aria-label="隊列予測">
              <span style={{ width: `${(styleCounts.front / maxStyleCount) * 100}%` }}>前 {styleCounts.front}</span>
              <span style={{ width: `${(styleCounts.mid / maxStyleCount) * 100}%` }}>中 {styleCounts.mid}</span>
              <span style={{ width: `${(styleCounts.back / maxStyleCount) * 100}%` }}>後 {styleCounts.back}</span>
            </div>
            <p className="rdv-panel__value">{pacePressureText(simulatedCondition.pace)}</p>
          </article>
        </div>
      </header>

      <div className="rdv-body transition-all duration-300 ease-in-out">
        <aside className="rdv-leftpane transition-all duration-300 ease-in-out" aria-label="シグナルリスト">
          <div className="rdv-list-head">
            <span className="rdv-mono">番</span>
            <span>印</span>
            <span>馬名</span>
            <span className="rdv-mono">単勝</span>
            <span>SIG</span>
          </div>
          {sortedRows.map((row) => {
            const entry = horseById.get(row.horseId);
            if (!entry) return null;
            const odds = getEffectiveEvaluationSignals(entry.horse)?.winOdds;
            const signal = visualSignal(row, entry.horse);
            const isActive = row.horseId === selectedRow?.horseId;
            const inTray = myTray.includes(entry.number);
            return (
              <article
                key={row.horseId}
                className={`rdv-signal-card transition-all duration-300 ease-in-out${isActive ? " is-active" : ""}`}
                onClick={() => setSelectedHorseId(row.horseId)}
                role="button"
                aria-pressed={isActive}
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") setSelectedHorseId(row.horseId);
                }}
              >
                <span className="rdv-no rdv-mono">{entry.number}</span>
                <span className={`rdv-mark rdv-mark--${row.mark ?? "none"}`}>{row.mark || "・"}</span>
                <span className="rdv-horse">{row.horseName}</span>
                <span className="rdv-odds rdv-mono">{odds != null ? `${odds.toFixed(1)}x` : "--"}</span>
                <span className={`rdv-signal rdv-signal--${signal?.tone ?? "none"}`}>{signal?.icon ?? "・"}</span>
                <button
                  type="button"
                  className={`rdv-tray-btn${inTray ? " is-on" : ""}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    setMyTray((prev) => {
                      if (prev.includes(entry.number)) return prev.filter((n) => n !== entry.number);
                      return [...prev, entry.number];
                    });
                  }}
                  title="買い目トレイへ"
                >
                  {inTray ? "IN" : "+"}
                </button>
              </article>
            );
          })}
        </aside>

        <main className="rdv-mainconsole transition-all duration-300 ease-in-out">
          {selectedRow && selectedHorse ? (
            <>
              <section className="rdv-card rdv-card--hero transition-all duration-300 ease-in-out">
                <div className="rdv-main-head">
                  <div>
                    <h2>{selectedHorseCtx?.number}番 {selectedRow.horseName}</h2>
                    <p>{selectedRow.mark ? `${selectedRow.mark} / ` : ""}{selectedHorse.runningStyle} / 最終評価 <span className="rdv-mono">{selectedRow.finalEvaluationScore.toFixed(2)}</span></p>
                  </div>
                  <div className="rdv-evstack">
                    <span className={`rdv-mono ${glowClass(selectedHorse.aiEffectiveEv ?? null)}`}>
                      AI EV {selectedHorse.aiEffectiveEv != null ? selectedHorse.aiEffectiveEv.toFixed(2) : "--"}
                    </span>
                    <span className="rdv-mono">Intrinsic {selectedRow.intrinsicAbilityScore.toFixed(2)}</span>
                  </div>
                </div>
              </section>

              {selectedHorse && selectedGrades ? (
                <HorseAbilityInsightPanel
                  horse={selectedHorse}
                  result={selectedRow}
                  condition={simulatedCondition}
                  grades={selectedGrades}
                  compact
                  density="analysis"
                />
              ) : null}

              <section className="rdv-card transition-all duration-300 ease-in-out">
                <h3>AIの全頭診断レポート</h3>
                <article className="mt-4 rounded-xl border border-zinc-800 bg-zinc-900/70 p-4">
                  <p className="text-xs uppercase tracking-[0.14em] text-zinc-500">AI短評</p>
                  <p className="mt-2 text-lg font-semibold leading-relaxed text-zinc-100">
                    {buildAiShortComment(selectedRow, selectedHorse)}
                  </p>
                  <div className="mt-4 flex flex-wrap items-end gap-3">
                    <span className="text-xs uppercase tracking-[0.12em] text-zinc-500">総合評価点数</span>
                    <strong className="rdv-mono text-2xl text-cyan-300">{selectedRow.finalEvaluationScore.toFixed(2)}</strong>
                  </div>
                </article>

                <div className="mt-4 grid gap-3 md:grid-cols-2">
                  <article className="rounded-xl border border-emerald-900/60 bg-emerald-950/20 p-4">
                    <p className="text-sm font-semibold text-emerald-300">🔴 プラス材料</p>
                    <ul className="mt-2 space-y-1 text-sm text-zinc-200">
                      {positiveFactors.length > 0 ? (
                        positiveFactors.map((item) => (
                          <li key={item.label} className="flex items-start justify-between gap-3">
                            <span>{item.label}</span>
                            <span className="rdv-mono text-emerald-300">{toSigned(item.value)}</span>
                          </li>
                        ))
                      ) : (
                        <li className="text-zinc-500">大きな加点材料はありません。</li>
                      )}
                    </ul>
                  </article>

                  <article className="rounded-xl border border-sky-900/60 bg-sky-950/20 p-4">
                    <p className="text-sm font-semibold text-sky-300">🔵 マイナス材料</p>
                    <ul className="mt-2 space-y-1 text-sm text-zinc-200">
                      {negativeFactors.length > 0 ? (
                        negativeFactors.map((item) => (
                          <li key={item.label} className="flex items-start justify-between gap-3">
                            <span>{item.label}</span>
                            <span className="rdv-mono text-sky-300">{toSigned(item.value)}</span>
                          </li>
                        ))
                      ) : (
                        <li className="text-zinc-500">目立つ減点材料はありません。</li>
                      )}
                    </ul>
                  </article>
                </div>
              </section>

              <section className="rdv-card transition-all duration-300 ease-in-out">
                <h3>特性バッジ & 不利メモ</h3>
                <div className="rdv-badges">
                  {(selectedRow.adjustmentBadges ?? []).map((b) => (
                    <span key={b} className="rdv-badge">{b}</span>
                  ))}
                  {(selectedHorse.suitabilityFlags ?? []).slice(0, 4).map((f) => (
                    <span key={f.code} className="rdv-badge rdv-badge--warn">{f.label}</span>
                  ))}
                  {selectedHorse.was_bias_disadvantaged ? <span className="rdv-badge rdv-badge--warn">前走バイアス逆行</span> : null}
                  {selectedRow.buyLabel === BUY_LABELS.DISMISS ? <span className="rdv-badge rdv-badge--danger">消しルール該当</span> : null}
                </div>
                <div className="rdv-memos">
                  <span>{selectedRow.pastRunInsight || "過去走メモなし"}</span>
                  <span>{selectedRow.reason || "判定理由なし"}</span>
                </div>
              </section>
            </>
          ) : null}
        </main>
      </div>

      <footer className="rdv-bottomdock transition-all duration-300 ease-in-out">
        <section className="rdv-dock-block transition-all duration-300 ease-in-out">
          <h3>条件スライダー</h3>
          <label>
            馬場コンディション
            <input type="range" min={0} max={100} value={groundSlider} onChange={(e) => setGroundSlider(Number(e.target.value))} />
          </label>
          <label>
            ペース圧
            <input type="range" min={-100} max={100} value={paceSlider} onChange={(e) => setPaceSlider(Number(e.target.value))} />
          </label>
          <label>
            バイアス方向
            <input type="range" min={-100} max={100} value={biasSlider} onChange={(e) => setBiasSlider(Number(e.target.value))} />
          </label>
          <label>
            時計トーン
            <input type="range" min={-100} max={100} value={trackSpeedSlider} onChange={(e) => setTrackSpeedSlider(Number(e.target.value))} />
          </label>
        </section>

        <section className={`rdv-dock-block rdv-dock-block--wide transition-all duration-300 ease-in-out${myBetEv != null && myBetEv > 1.2 ? " is-hot" : ""}`}>
          <h3>マイ買い目ビルダー</h3>
          <div className="rdv-bet-toolbar">
            <select
              value={myBetType}
              onChange={(e) => {
                setMyBetType(e.target.value as MyBetType);
                setMyTray([]);
              }}
            >
              <option value="WIN">単勝</option>
              <option value="REN">馬連</option>
              <option value="WREN">ワイド</option>
              <option value="TRI">3連複</option>
            </select>
            <button type="button" onClick={() => setMyTray([])}>クリア</button>
          </div>
          <div className="rdv-tray">
            {myTray.length > 0 ? myTray.map((n) => <span key={n}>{n}番</span>) : <span>左ペインで銘柄を追加してください</span>}
          </div>
          <div className="rdv-bet-metrics">
            <p>合成適中確率: <strong className="rdv-mono">{toPercent(myBetProbability)}</strong></p>
            <p>推定オッズ: <strong className="rdv-mono">{toOdds(myBetOdds ?? null)}</strong></p>
            <p>期待値 EV: <strong className={`rdv-mono ${glowClass(myBetEv)}`}>{myBetEv != null ? myBetEv.toFixed(2) : "--"}</strong></p>
          </div>
          <div className="rdv-ev-meter">
            <div className="rdv-ev-meter__fill" style={{ width: `${myBetMeter * 100}%` }} />
          </div>
        </section>
      </footer>
    </section>
  );
}

