import { useEffect, useMemo, useState } from "react";
import type { AbilityGradeRow } from "../../domain/race-evaluation/abilityGrades";
import type { HorseAbility, HorseScoreResult, RaceCondition } from "../../domain/race-evaluation";
import { BUY_LABELS, getFinalWeights, resolveHorseEffectiveEv, weightsToDemand0to100 } from "../../domain/race-evaluation";
import { HorseEvaluationCard } from "./HorseEvaluationCard";
import { HorseAbilityInsightPanel } from "./HorseAbilityInsightPanel";
import { adjustedScoreToPoints100 } from "./adjustedScorePoints100";
import type { RaceEvaluationViewModel } from "../../viewModel/raceEvaluationViewModel";
import { getEffectiveEvaluationSignals } from "../../domain/race-evaluation/resolveEvaluationSignals";
import {
  buildOddsMapForEvEvaluation,
  estimatePairProbability,
  estimateTrifectaProbability,
} from "../../domain/betting/bettingRules";

type Props = {
  sorted: HorseScoreResult[];
  horses: HorseAbility[];
  gradesMap: Map<string, AbilityGradeRow>;
  condition: RaceCondition;
  viewModel?: RaceEvaluationViewModel;
  maxAdjustedScoreInRace: number;
  adjustedProbabilities?: ReadonlyMap<string, number>;
  densityMode: "simple" | "analysis";
};

function paceLabel(pace: RaceCondition["pace"]): string {
  const map: Record<string, string> = {
    no_front_runner: "先手不在",
    slow: "スロー",
    middle: "平均",
    high: "ハイ",
    many_front_runners: "先行争い",
  };
  return map[pace] ?? String(pace);
}

type SuitabilityTone = { mark: "◎" | "○" | "△" | "×"; label: string; fitTotal: number };
type MyBetType = "WIN" | "REN" | "WREN" | "TRI";

function resolveSuitability(row: HorseScoreResult): SuitabilityTone {
  if (row.buyLabel === BUY_LABELS.DISMISS) return { mark: "×", label: "消し", fitTotal: Number.NEGATIVE_INFINITY };
  const fitTotal =
    (row.paceFitBonus ?? 0) +
    (row.distanceFitBonus ?? 0) +
    (row.lapShapeFitBonus ?? 0) +
    (row.raceAnalysisBonus ?? 0) +
    (row.lapSustainBonus ?? 0);
  if (fitTotal >= 6) return { mark: "◎", label: "かなり向く", fitTotal };
  if (fitTotal >= 2) return { mark: "○", label: "向く", fitTotal };
  if (fitTotal >= -1) return { mark: "△", label: "標準", fitTotal };
  return { mark: "×", label: "不向き", fitTotal };
}

function signedText(value: number): string {
  const sign = value >= 0 ? "+" : "";
  return `${sign}${value.toFixed(1)}`;
}

function summarizeReason(row: HorseScoreResult): string {
  if (row.predictionShortComment != null && row.predictionShortComment.trim().length > 0) {
    return row.predictionShortComment.trim();
  }
  const src = row.reason?.trim() ?? "";
  if (src.length === 0) return "データ不足のため補足コメントはありません。";
  const firstSentence = src.split("。")[0]?.trim() ?? src;
  return firstSentence.length > 0 ? `${firstSentence}。` : src;
}

function pairKey(a: number, b: number): string {
  return [a, b].sort((x, y) => x - y).join("-");
}

function triKey(a: number, b: number, c: number): string {
  return [a, b, c].sort((x, y) => x - y).join("-");
}

export function RaceHorsesView({
  sorted,
  horses,
  gradesMap,
  condition,
  viewModel,
  maxAdjustedScoreInRace,
  adjustedProbabilities,
  densityMode,
}: Props) {
  const demand0to100 = weightsToDemand0to100(getFinalWeights(condition));
  const initialSelectedHorseId = useMemo(
    () =>
      sorted.find((row) => row.buyLabel !== BUY_LABELS.DISMISS && row.mark === "◎")?.horseId ??
      sorted.find((row) => row.buyLabel !== BUY_LABELS.DISMISS)?.horseId ??
      sorted[0]?.horseId ??
      null,
    [sorted],
  );
  const [selectedHorseId, setSelectedHorseId] = useState<string | null>(initialSelectedHorseId);

  useEffect(() => {
    setSelectedHorseId((prev) => {
      if (prev != null && sorted.some((row) => row.horseId === prev)) return prev;
      return initialSelectedHorseId;
    });
  }, [initialSelectedHorseId, sorted]);

  const selectedResult = useMemo(
    () => sorted.find((row) => row.horseId === selectedHorseId) ?? sorted[0] ?? null,
    [selectedHorseId, sorted],
  );
  const selectedHorse = useMemo(
    () =>
      selectedResult != null
        ? horses.find((horse) => horse.horseId === selectedResult.horseId) ?? null
        : null,
    [horses, selectedResult],
  );
  const selectedGrades = selectedResult != null ? gradesMap.get(selectedResult.horseId) ?? null : null;
  const selectedGate =
    selectedHorse != null && "gate" in selectedHorse
      ? (selectedHorse as HorseAbility & { gate?: number }).gate
      : undefined;
  const selectedScore100 =
    selectedResult != null ? adjustedScoreToPoints100(selectedResult.adjustedScore, maxAdjustedScoreInRace) : null;
  const styleSummary = useMemo(() => {
    const front = horses.filter((h) => h.runningStyle === "逃げ" || h.runningStyle === "先行").length;
    const middle = horses.filter((h) => h.runningStyle === "差し").length;
    const back = horses.filter((h) => h.runningStyle === "追込").length;
    const other = Math.max(0, horses.length - front - middle - back);
    return { front, middle, back, other, total: horses.length };
  }, [horses]);
  const selectedSuitability = selectedResult ? resolveSuitability(selectedResult) : null;
  const selectedReason = selectedResult ? summarizeReason(selectedResult) : "";
  const [myBetType, setMyBetType] = useState<MyBetType>("REN");
  const [trayHorseNumbers, setTrayHorseNumbers] = useState<number[]>([]);
  const [confirmedTicket, setConfirmedTicket] = useState<string | null>(null);
  const horseNumberById = useMemo(() => {
    const map = new Map<string, number>();
    horses.forEach((horse, idx) => {
      const gate = (horse as { gate?: number }).gate;
      const number = gate != null && Number.isFinite(gate) ? Math.round(gate) : idx + 1;
      map.set(horse.horseId, number);
    });
    return map;
  }, [horses]);
  const normalizedByNo = useMemo(() => {
    const raw = new Map<number, number>();
    for (const horse of horses) {
      const no = horseNumberById.get(horse.horseId);
      if (no == null) continue;
      const ai = horse.aiPredictedWinRate;
      const pipelineProb = adjustedProbabilities?.get(horse.horseId);
      const odds = getEffectiveEvaluationSignals(horse)?.winOdds;
      const p =
        ai != null && Number.isFinite(ai) && ai > 0
          ? ai
          : pipelineProb != null && Number.isFinite(pipelineProb) && pipelineProb > 0
            ? pipelineProb
            : odds != null && Number.isFinite(odds) && odds > 0
              ? 1 / odds
              : 0;
      if (p > 0) raw.set(no, p);
    }
    const sum = [...raw.values()].reduce((acc, cur) => acc + cur, 0);
    if (!Number.isFinite(sum) || sum <= 0) return raw;
    return new Map([...raw.entries()].map(([no, p]) => [no, p / sum]));
  }, [adjustedProbabilities, horseNumberById, horses]);
  const evOddsMap = useMemo(
    () => buildOddsMapForEvEvaluation(horses, undefined, normalizedByNo),
    [horses, normalizedByNo],
  );
  const requiredHorseCount = myBetType === "TRI" ? 3 : myBetType === "WIN" ? 1 : 2;
  const selectedForCalc = trayHorseNumbers.slice(0, requiredHorseCount).sort((a, b) => a - b);
  const myBetProbability = useMemo(() => {
    if (selectedForCalc.length !== requiredHorseCount) return null;
    if (myBetType === "WIN") return normalizedByNo.get(selectedForCalc[0]!) ?? null;
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
  }, [myBetType, normalizedByNo, requiredHorseCount, selectedForCalc]);
  const myBetOdds = useMemo(() => {
    if (selectedForCalc.length !== requiredHorseCount) return null;
    if (myBetType === "WIN") return evOddsMap.win[selectedForCalc[0]!];
    if (myBetType === "REN") return evOddsMap.ren?.[pairKey(selectedForCalc[0]!, selectedForCalc[1]!)];
    if (myBetType === "WREN") return evOddsMap.wide?.[pairKey(selectedForCalc[0]!, selectedForCalc[1]!)];
    return evOddsMap.trifecta?.[triKey(selectedForCalc[0]!, selectedForCalc[1]!, selectedForCalc[2]!)];
  }, [evOddsMap, myBetType, requiredHorseCount, selectedForCalc]);
  const myBetEv =
    myBetProbability != null &&
    myBetOdds != null &&
    Number.isFinite(myBetProbability) &&
    Number.isFinite(myBetOdds)
      ? myBetProbability * myBetOdds
      : null;
  const canConfirmTicket = selectedForCalc.length === requiredHorseCount && myBetEv != null;
  const isHotTicket = myBetEv != null && myBetEv >= 1.2;
  const betTypeLabel: Record<MyBetType, string> = {
    WIN: "単勝",
    REN: "馬連",
    WREN: "ワイド",
    TRI: "3連複",
  };
  const handleTicketConfirm = () => {
    if (!canConfirmTicket) return;
    setConfirmedTicket(
      `${betTypeLabel[myBetType]} ${selectedForCalc.join("-")} / EV ${myBetEv!.toFixed(2)}`,
    );
  };

  return (
    <section className="race-horses-view" aria-label="出馬表">
      <div className="race-horses-view__head">
        <h2 className="race-horses-view__title">
          出馬表 {horses.length > 0 ? `（${horses.length}頭）` : ""}
        </h2>
        <p className="race-horses-view__hint">左で馬を選択すると右の分析が切り替わります</p>
      </div>
      {densityMode === "analysis" ? (
        <section className="race-horses-view__raceflow" aria-label="レース展開の可視化">
          <div className="race-horses-view__raceflow-head">
            <h3>展開シミュレーション</h3>
            <span>想定ペース: {paceLabel(condition.pace)}</span>
          </div>
          <div className="race-horses-view__raceflow-grid">
            <div>
              <p>先行ゾーン</p>
              <strong>{styleSummary.front}頭</strong>
            </div>
            <div>
              <p>中団ゾーン</p>
              <strong>{styleSummary.middle + styleSummary.other}頭</strong>
            </div>
            <div>
              <p>後方ゾーン</p>
              <strong>{styleSummary.back}頭</strong>
            </div>
          </div>
        </section>
      ) : null}
      <div
        className="race-horses-view__grid"
        style={{
          gridTemplateColumns: "minmax(300px, 36%) minmax(0, 1fr)",
        }}
      >
        <aside
          className="race-horses-view__list-pane"
          aria-label="馬リスト"
        >
          <ul className="race-horses-view__list">
            {sorted.map((row) => {
              const horse = horses.find((h) => h.horseId === row.horseId);
              if (horse == null) return null;
              const gate = "gate" in horse ? (horse as HorseAbility & { gate?: number }).gate : undefined;
              const odds = getEffectiveEvaluationSignals(horse)?.winOdds ?? null;
              const vmHorse = viewModel?.byHorseId.get(horse.horseId);
              const resolvedEv = resolveHorseEffectiveEv(horse);
              const effectiveEv = vmHorse?.effectiveEv ?? resolvedEv.effectiveEv ?? null;
              const isDismiss = row.buyLabel === BUY_LABELS.DISMISS;
              const suit = resolveSuitability(row);
              const displayMark = row.mark ?? "";
              const isValueAlert =
                !isDismiss &&
                effectiveEv != null &&
                Number.isFinite(effectiveEv) &&
                effectiveEv >= 1.3 &&
                odds != null &&
                odds >= 10;
              const isDangerPopular =
                !isDismiss &&
                suit.mark !== "◎" &&
                suit.mark !== "○" &&
                odds != null &&
                odds <= 5 &&
                effectiveEv != null &&
                Number.isFinite(effectiveEv) &&
                effectiveEv < 1.0;
              const isSelected = selectedResult?.horseId === row.horseId;
              const horseNumber = horseNumberById.get(horse.horseId) ?? gate ?? 0;
              const inTray = trayHorseNumbers.includes(horseNumber);
              return (
                <li key={row.horseId} className="race-horses-view__list-item">
                  <button
                    type="button"
                    className={`race-horses-view__list-btn${isSelected ? " is-selected" : ""}`}
                    onClick={() => setSelectedHorseId(row.horseId)}
                  >
                    <div className="race-horses-view__list-top">
                      <div className="race-horses-view__list-left">
                        <span className={`race-horses-view__mark${isDismiss ? " race-horses-view__mark--dismiss" : ""}`}>{displayMark || "・"}</span>
                        <span className="race-horses-view__gate">{gate != null ? `${gate}番` : "—"}</span>
                        <span className="race-horses-view__horse">{horse.horseName}</span>
                      </div>
                      <span className="race-horses-view__odds">
                        {odds != null ? `${odds.toFixed(1)}倍` : "オッズなし"}
                      </span>
                    </div>
                    <div className="race-horses-view__list-meta">
                      <span className={`race-horses-view__suit-chip race-horses-view__suit-chip--${suit.mark}`}>
                        今回向き {suit.mark} {suit.label}
                      </span>
                      {densityMode === "analysis" && isValueAlert ? (
                        <span className="race-horses-view__tag race-horses-view__tag--hot">妙味馬</span>
                      ) : null}
                      {densityMode === "analysis" && isDangerPopular ? (
                        <span className="race-horses-view__tag race-horses-view__tag--risk">危険人気</span>
                      ) : null}
                      {densityMode === "analysis" && isDismiss ? (
                        <span className="race-horses-view__tag race-horses-view__tag--dismiss">消し馬</span>
                      ) : null}
                    </div>
                  </button>
                  <button
                    type="button"
                    className={`race-horses-view__tray-btn${inTray ? " is-on" : ""}`}
                    onClick={() => {
                      setTrayHorseNumbers((prev) => {
                        if (prev.includes(horseNumber)) return prev.filter((num) => num !== horseNumber);
                        return [...prev, horseNumber];
                      });
                      setConfirmedTicket(null);
                    }}
                    aria-label={`${horseNumber}番を買い目トレイへ追加`}
                  >
                    {inTray ? "IN" : "+"}
                  </button>
                </li>
              );
            })}
          </ul>
        </aside>

        <div
          className="race-horses-view__detail-pane"
          aria-label="詳細分析コンソール"
        >
          {selectedResult != null && selectedSuitability != null ? (
            <section className="race-horses-view__judgeboard" aria-label="選択馬の判定ボード">
              <h3>AI判定ボード</h3>
              <div className="race-horses-view__judge-grid">
                <article>
                  <p>印</p>
                  <strong>{selectedResult.mark || "・"}</strong>
                </article>
                <article>
                  <p>買い判定</p>
                  <strong>{selectedResult.buyLabel}</strong>
                </article>
                <article>
                  <p>今回向き</p>
                  <strong>
                    {selectedSuitability.mark} {selectedSuitability.label}
                  </strong>
                </article>
                <article>
                  <p>展開適性</p>
                  <strong>{signedText(selectedResult.paceFitBonus)}</strong>
                </article>
              </div>
              <p className="race-horses-view__judge-comment">{selectedReason}</p>
            </section>
          ) : null}
          {selectedHorse != null ? (
            <HorseAbilityInsightPanel
              horse={selectedHorse}
              result={selectedResult!}
              condition={condition}
              grades={selectedGrades}
              viewModel={viewModel}
              density={densityMode}
            />
          ) : null}
          {densityMode === "analysis" && selectedHorse != null && selectedResult != null && selectedGrades != null ? (
            <HorseEvaluationCard
              gate={selectedGate}
              horse={selectedHorse}
              result={selectedResult}
              grades={selectedGrades}
              demand0to100={demand0to100}
              allHorses={horses}
              condition={condition}
              viewModel={viewModel}
              scorePoints100={selectedScore100}
            />
          ) : null}
        </div>
      </div>
      <section className={`race-horses-view__betdock${isHotTicket ? " is-hot" : ""}`} aria-label="買い目ドック">
        <div className="race-horses-view__betdock-head">
          <h3>買い目ドック</h3>
          <div className="race-horses-view__betdock-controls">
            <select
              value={myBetType}
              onChange={(e) => {
                setMyBetType(e.target.value as MyBetType);
                setTrayHorseNumbers([]);
                setConfirmedTicket(null);
              }}
            >
              <option value="WIN">単勝</option>
              <option value="REN">馬連</option>
              <option value="WREN">ワイド</option>
              <option value="TRI">3連複</option>
            </select>
            <button
              type="button"
              onClick={() => {
                setTrayHorseNumbers([]);
                setConfirmedTicket(null);
              }}
            >
              クリア
            </button>
          </div>
        </div>
        <div className="race-horses-view__tray">
          {trayHorseNumbers.length > 0 ? (
            trayHorseNumbers.map((num) => <span key={num}>{num}番</span>)
          ) : (
            <span>左の馬リストで候補を追加してください</span>
          )}
        </div>
        <div className="race-horses-view__betdock-metrics">
          <p>
            合成適中確率:
            <strong>{myBetProbability != null ? `${(myBetProbability * 100).toFixed(2)}%` : " --"}</strong>
          </p>
          <p>
            推定オッズ:
            <strong>{myBetOdds != null ? `${myBetOdds.toFixed(1)}倍` : " --"}</strong>
          </p>
          <p>
            EV:
            <strong className={isHotTicket ? "is-hot" : ""}>{myBetEv != null ? myBetEv.toFixed(2) : " --"}</strong>
          </p>
        </div>
        <button
          type="button"
          className="race-horses-view__confirm-btn"
          disabled={!canConfirmTicket}
          onClick={handleTicketConfirm}
        >
          買い目確定
        </button>
        {confirmedTicket ? <p className="race-horses-view__confirm-note">買い目確定: {confirmedTicket}</p> : null}
      </section>
    </section>
  );
}
