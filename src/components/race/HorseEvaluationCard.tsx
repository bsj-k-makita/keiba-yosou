import { useId, useMemo, useState } from "react";
import type { AbilityGradeRow } from "../../domain/race-evaluation/abilityGrades";
import {
  ABILITY_KEYS,
  ABILITY_LABELS,
  resolveHorseEffectiveEv,
  type AbilityKey,
  type HorseAbility,
  type HorseScoreResult,
  type RaceCondition,
} from "../../domain/race-evaluation";
import { inferRadarShape } from "../../domain/race-evaluation";
import {
  computeFitScore,
  findL1CloseTypePeers,
  fitLevelFromScore,
} from "../../domain/race-evaluation/fitScore";
import { BUY_LABELS, JUDGMENT, UI } from "../../domain/race-evaluation/lingoConstants";
import { buildFitSupplementLine } from "../../domain/race-evaluation/reasonGenerator";
import { inferHorseAbilityTypeLabel } from "../../domain/race-evaluation/typeMatcher";
import { AbilityBar } from "./AbilityBar";
import { FitLabel } from "./FitLabel";
import { getFrameColor } from "./frameColor";
import { RadarChart } from "./RadarChart";
import { ScoreDiffIndicator } from "./ScoreDiffIndicator";
import { TypeMatchList } from "./TypeMatchList";
import { computeConnectionSpecialBadges, computeMarketAlertLabel } from "./evaluationTags";
import type { RaceEvaluationViewModel } from "../../viewModel/raceEvaluationViewModel";
import { FINAL_EXPECTED_RECOMMEND_THRESHOLD } from "../../domain/race-evaluation/investmentEvConstants";
import { probabilityWinRateSuffix } from "../../lib/pipeline/probabilityEngine";
import { netkeibaHorseResultUrl } from "../../lib/netkeibaUrls";
import { FinalExpectedRecommendBadge } from "./FinalExpectedRecommendBadge";
import { runningStyleToStripShortLabel } from "./RunningStyleStrip";

type Props = {
  gate?: number;
  horse: HorseAbility;
  result: HorseScoreResult;
  grades: AbilityGradeRow;
  /** 0〜100：適合度（今回向き）用。レーダー表示には使わない */
  demand0to100: Record<AbilityKey, number>;
  allHorses: HorseAbility[];
  condition: RaceCondition;
  viewModel?: RaceEvaluationViewModel;
  compact?: boolean;
  /** 補正後スコアのレース内比例点数（トップ100・オプション） */
  scorePoints100?: number | null;
};

function horseToRadarMap(horse: HorseAbility): Record<AbilityKey, number> {
  return {
    speed: horse.speed,
    stamina: horse.stamina,
    kick: horse.kick,
    sustain: horse.sustain,
    power: horse.power,
  };
}

export function HorseEvaluationCard({
  gate,
  horse,
  result,
  grades,
  demand0to100,
  allHorses,
  condition,
  viewModel,
  compact = false,
  scorePoints100,
}: Props) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const panelId = `${id}-detail`;

  const mark = result.mark ?? "";
  const hasMark = mark !== "";
  const isDismissMasked = result.buyLabel === BUY_LABELS.DISMISS && !hasMark;
  const frameNumber = "frameNumber" in horse ? (horse as HorseAbility & { frameNumber?: number }).frameNumber : undefined;
  const frameColor = getFrameColor(frameNumber);

  const orderRank = result.finalRank ?? result.adjustedRank;
  const rankDelta =
    result.baseRank != null && orderRank != null ? result.baseRank - orderRank : 0;
  const rankMoveBadge =
    rankDelta > 0
      ? `↑${rankDelta}位上昇`
      : rankDelta < 0
        ? `↓${Math.abs(rankDelta)}位下降`
        : null;

  const strongLine = result.strongAbilities
    .map((k) => `${ABILITY_LABELS[k]} ${grades[k]}`)
    .join(" / ");

  const typeLabel = inferHorseAbilityTypeLabel(horse, condition);
  const fitLine = useMemo(
    () => buildFitSupplementLine(horse, condition),
    [horse, condition],
  );
  const l1Peers = useMemo(
    () => findL1CloseTypePeers(horse, allHorses, 2),
    [horse, allHorses],
  );

  const fitRaw = useMemo(
    () => computeFitScore(horse, demand0to100),
    [horse, demand0to100],
  );
  const fitLevel = fitLevelFromScore(fitRaw);

  const engine = viewModel?.probabilityEngine ?? "ts";
  const vmHorse = viewModel?.byHorseId.get(horse.horseId);
  const resolvedEv = useMemo(() => resolveHorseEffectiveEv(horse), [horse]);
  const weightedRadar = vmHorse?.weightedRadar;
  const pipelineWinProb = vmHorse?.adjustedWinProbability;
  const hMap = useMemo(() => weightedRadar ?? horseToRadarMap(horse), [horse, weightedRadar]);
  const radarShape = useMemo(() => inferRadarShape(horse), [horse]);
  const displayEv =
    vmHorse?.effectiveEv ??
    resolvedEv.effectiveEv ??
    horse.investment?.valueScore ??
    null;
  const effectiveEvSource = vmHorse?.effectiveEvSource ?? resolvedEv.source;
  const effectiveEv = useMemo(() => displayEv, [displayEv]);
  const effectiveEvHot =
    displayEv != null && Number.isFinite(displayEv) && displayEv > FINAL_EXPECTED_RECOMMEND_THRESHOLD;
  const evBand =
    effectiveEv == null
      ? "muted"
      : effectiveEv >= 1.25
        ? "emerald"
        : effectiveEv >= 1.15
          ? "green"
          : effectiveEv >= 1.0
            ? "light"
            : "muted";
  const contextualTotal =
    (result.pedigreeBonus ?? 0) +
    (result.gateBiasBonus ?? 0) +
    (result.gateStyleSynergyBonus ?? 0) +
    (result.connectionsBonus ?? 0) +
    (result.jockeyRiderBonus ?? 0) +
    (result.heavyWeightPowerBonus ?? 0) +
    (result.staminaTestBonus ?? 0) +
    (result.trendBonus ?? 0) +
    (result.paceBalanceBonus ?? 0) +
    (result.tripContextBonus ?? 0);
  const lapTotal =
    (result.lapShapeFitBonus ?? 0) +
    (result.raceAnalysisBonus ?? 0) +
    (result.lapSustainBonus ?? 0) +
    (result.lapQualityBonus ?? 0);
  const marketAlert = useMemo(
    () => computeMarketAlertLabel(horse, result, allHorses),
    [allHorses, horse, result],
  );
  const connectionBadges = useMemo(
    () => computeConnectionSpecialBadges(horse, condition, allHorses),
    [allHorses, horse, condition],
  );
  const courseTraitBadge = useMemo(() => {
    const bonus = result.courseTraitBonus ?? 0;
    const reasons = result.courseTraitReasons ?? [];
    if (bonus <= 0 || reasons.length === 0) return null;
    return {
      text: `🧭 コース特性一致 +${bonus.toFixed(1)}`,
      title: reasons.join("\n"),
    };
  }, [result.courseTraitBonus, result.courseTraitReasons]);
  const quickAdjustmentBadges = useMemo(
    () => (result.adjustmentBadges ?? []).filter((badge) => badge.length > 0),
    [result.adjustmentBadges],
  );
  const hokkakeBadge = useMemo(() => {
    if (!result.hokkakeRole) return null;
    if (result.hokkakeRole === "△1安定") {
      return { text: "△[安定]", title: "安定度・データ厚め（複勝の軸にしやすいヒモ）" };
    }
    if (result.hokkakeRole === "△2物理") {
      return { text: "△[物理]", title: "コース特性・馬体重など物理条件との一致が強いヒモ" };
    }
    return { text: "△[展開]", title: "このレースのペース想定で恩恵が大きいヒモ（狙い・末脚）" };
  }, [result.hokkakeRole]);
  const jockeyUpgradeBadge = useMemo(() => {
    const v = result.jockeyRiderBonus ?? 0;
    if (v < 8) return null;
    return `[鞍上強化 +${v.toFixed(1)}]`;
  }, [result.jockeyRiderBonus]);
  const ambitionBadge = useMemo(() => {
    if (!result.jockeyAmbitionFlag) return null;
    return { text: "[勝負気配]", title: "前走より鞍上が大きく強化（賞金志向の乗り替わり）" };
  }, [result.jockeyAmbitionFlag]);

  return (
    <article
      className={`horse-card${compact ? " horse-card--compact" : ""}${effectiveEvHot ? " horse-card--ev-gold" : ""}`}
      data-buylabel={result.buyLabel}
      data-has-mark={hasMark ? "1" : undefined}
      data-dismiss-masked={isDismissMasked ? "1" : undefined}
      data-ev-hot={effectiveEvHot ? "1" : undefined}
      data-ev-band={evBand}
    >
      <header className="horse-card__head">
        <span className="horse-card__mark" aria-hidden>
          {mark || "・"}
        </span>
        {gate != null && (
          <div
            className="horse-card__gate-badge"
            aria-label={`${gate}番`}
            style={{ background: frameColor.bg, borderColor: frameColor.border, color: frameColor.fg }}
            title={frameNumber != null ? `${frameNumber}枠` : undefined}
          >
            <span className="horse-card__gate-num">{gate}</span>
          </div>
        )}
        <div className="horse-card__name-row">
          <span className="horse-card__title">{horse.horseName}</span>
          {horse.horseId ? (
            <a
              href={netkeibaHorseResultUrl(horse.horseId)}
              target="_blank"
              rel="noopener noreferrer"
              className="netkeiba-horse-link"
              title="netkeiba で戦績・過去走を開く（追加取得なし）"
              onClick={(e) => e.stopPropagation()}
            >
              戦績
            </a>
          ) : null}
          <span
            className="horse-card__style-badge"
            title={`${UI.RUNNING_STYLE}（データ: ${horse.runningStyle}）`}
          >
            {runningStyleToStripShortLabel(horse.runningStyle, horse.position_x)}
          </span>
          {hokkakeBadge ? (
            <span
              className="horse-card__role-badge horse-card__role-badge--axis"
              title={hokkakeBadge.title}
            >
              {hokkakeBadge.text}
            </span>
          ) : null}
          {ambitionBadge ? (
            <span className="horse-card__special-badge" data-kind="positive" title={ambitionBadge.title}>
              {ambitionBadge.text}
            </span>
          ) : null}
          {jockeyUpgradeBadge ? (
            <span className="horse-card__special-badge" data-kind="positive" title="ジョッキー文脈の加点">
              {jockeyUpgradeBadge}
            </span>
          ) : null}
          {rankMoveBadge ? (
            <span
              className={
                rankDelta > 0 ? "horse-card__role-badge horse-card__role-badge--axis" : "horse-card__role-badge horse-card__role-badge--head"
              }
              title="条件調整による順位変動"
            >
              {rankMoveBadge}
            </span>
          ) : null}
          <FinalExpectedRecommendBadge
            effectiveEv={displayEv}
            evSource={effectiveEvSource}
          />
        </div>
      </header>

      {result.roleHint !== "判定不能" && (
        <div className="horse-card__sub-row">
          <span
            className={`horse-card__role-badge horse-card__role-badge--${result.roleHint === "頭" ? "head" : "axis"}`}
            title={
              result.roleHint === "頭"
                ? `パフォーマンスのばらつきが大きい（stddev ${result.varianceScore.toFixed(1)}）。頭候補向き。`
                : `パフォーマンスが安定（stddev ${result.varianceScore.toFixed(1)}）。軸向き。`
            }
          >
            {result.roleHint}
          </span>
        </div>
      )}

      <section className="horse-card__ability-panel" aria-label="基本能力">
        <h3 className="horse-card__ability-title">基本能力</h3>
        {scorePoints100 != null ? (
          <p
            className="horse-card__scoreline horse-card__scoreline--json-ability"
            title="補正後スコアをこのレースで最高の馬を100点とした比例換算"
          >
            <span className="horse-card__scoreline-lbl">点数</span>
            <span className="horse-card__scoreline-val">{scorePoints100}</span>
            <span className="horse-card__scoreline-unit"> / 100</span>
          </p>
        ) : null}
        {pipelineWinProb != null && Number.isFinite(pipelineWinProb) ? (
          <p
            className="horse-card__scoreline horse-card__scoreline--pipeline-probs"
            title={
              engine === "ai"
                ? "Python ML バックフィル ai_predicted_win_rate（レース内正規化済み）"
                : "finalEvaluationScore をレース内 softmax した単勝確率"
            }
          >
            <span className="horse-card__scoreline-lbl">予測勝率</span>
            <span className="horse-card__scoreline-val">{(pipelineWinProb * 100).toFixed(1)}%</span>
            <span className="horse-card__scoreline-unit">{probabilityWinRateSuffix(engine)}</span>
          </p>
        ) : null}
        {horse.abilityIndex != null ? (
          <p
            className="horse-card__scoreline horse-card__scoreline--pipeline-potential"
            title="枠・コース適性・馬場・展開を除いたレース内指数（参考）"
          >
            <span className="horse-card__scoreline-lbl">ポテンシャル</span>
            <span className="horse-card__scoreline-val">{horse.abilityIndex}</span>
            <span className="horse-card__scoreline-unit"> / 100</span>
          </p>
        ) : null}
        {horse.suitabilityFlags != null && horse.suitabilityFlags.length > 0 ? (
          <ul className="horse-card__suitability-flags" aria-label="適性による勝率抑制の理由">
            {horse.suitabilityFlags.map((f) => (
              <li key={`${f.code}-${f.label.slice(0, 24)}`}>{f.label}</li>
            ))}
          </ul>
        ) : null}
        <div className="horse-card__ability-main">
          <div className="horse-card__radar-hero" aria-label="能力バランス">
            <div className="horse-card__radar-svg-wrap">
              <RadarChart horse={hMap} grades={grades} size={168} />
            </div>
            <p className="horse-card__radar-caption">補正後能力バランス（5項目）</p>
            <p className="horse-card__radar-note">
              条件・スライダー・重点項目の反映をレーダー形状にも反映しています。
            </p>
            <p className="horse-card__radar-shape">{radarShape.line}</p>
          </div>
          <ul className="horse-card__ability-metrics">
            {ABILITY_KEYS.map((k) => (
              <li key={k} className="horse-card__ability-row">
                <span className="horse-card__ability-name">{ABILITY_LABELS[k]}</span>
                <span className="horse-card__ability-value">{Math.round(horse[k])}</span>
                <span className="horse-card__ability-grade" data-grade={grades[k]}>
                  {`${ABILITY_LABELS[k]}${grades[k]}`}
                </span>
              </li>
            ))}
          </ul>
        </div>
      </section>

      <div className="horse-card__judge">
        <p className="horse-card__scoreline">
          <span className="horse-card__scoreline-lbl">{UI.ADJUSTED_SCORE}</span>
          <span className="horse-card__scoreline-val">{result.adjustedScore.toFixed(1)}</span>
        </p>
        <p
          className="horse-card__score-decomp"
          title="基礎＝5平均×0.75+上位2平均×0.25に、再現性・大敗調整。条件適性差＝補正後素点−その基礎。"
        >
          <span className="horse-card__score-decomp-part">
            <span className="horse-card__score-decomp-lbl">{UI.INTRINSIC_BASE}</span>{" "}
            <span className="horse-card__score-decomp-val">{result.intrinsicAbilityScore.toFixed(1)}</span>
          </span>
          <span className="horse-card__score-decomp-sep" aria-hidden>
            {" · "}
          </span>
          <span className="horse-card__score-decomp-part">
            <span className="horse-card__score-decomp-lbl">{UI.CONDITION_FIT_DELTA}</span>{" "}
            <span
              className={
                result.conditionFitDelta >= 0
                  ? "horse-card__score-decomp-val horse-card__score-decomp-val--pos"
                  : "horse-card__score-decomp-val horse-card__score-decomp-val--neg"
              }
            >
              {result.conditionFitDelta >= 0 ? "+" : ""}
              {result.conditionFitDelta.toFixed(1)}
            </span>
          </span>
        </p>

        <ScoreDiffIndicator diff={result.scoreDiff} />

        <p
          className="horse-card__score-amplify"
          title="距離・血統などの素点に対し、補正強度・条件Impactを弱めた場合との差"
        >
          補正前 <strong>{result.evaluationBaselineScore.toFixed(1)}</strong>
          {" → "}
          補正後 <strong>{result.finalEvaluationScore.toFixed(1)}</strong>
          {result.evaluationAdjustmentDelta !== 0 ? (
            <span
              className={
                result.evaluationAdjustmentDelta > 0
                  ? "horse-card__score-amplify-delta--pos"
                  : "horse-card__score-amplify-delta--neg"
              }
            >
              {" "}
              ({result.evaluationAdjustmentDelta > 0 ? "+" : ""}
              {result.evaluationAdjustmentDelta.toFixed(1)})
            </span>
          ) : (
            <span className="horse-card__score-amplify-delta--flat"> （±0.0）</span>
          )}
        </p>

        {result.buyLabel === BUY_LABELS.DISMISS ? (
          <p className="horse-card__verdict horse-card__verdict--dismiss">
            <strong>{BUY_LABELS.DISMISS}</strong>
          </p>
        ) : (
          <p className="horse-card__verdict">
            <strong>{JUDGMENT.BUY}：</strong>
            <span className="horse-card__buy-label">{result.buyLabel}</span>
          </p>
        )}
        {marketAlert ? (
          <p className="horse-card__market-alert" data-alert={marketAlert}>
            {marketAlert}
          </p>
        ) : null}
        {connectionBadges.length > 0 || courseTraitBadge != null || quickAdjustmentBadges.length > 0 ? (
          <div className="horse-card__special-badges">
            {quickAdjustmentBadges.map((badge) => (
              <span
                key={`quick-${badge}`}
                className="horse-card__special-badge"
                data-kind="quick-adjustment"
              >
                {badge}
              </span>
            ))}
            {courseTraitBadge ? (
              <span className="horse-card__special-badge" data-kind="course-trait" title={courseTraitBadge.title}>
                {courseTraitBadge.text}
              </span>
            ) : null}
            {connectionBadges.map((badge) => (
              <span
                key={badge}
                className="horse-card__special-badge"
                data-kind={badge.includes("折り合い注意") ? "temperament" : "positive"}
              >
                {badge}
              </span>
            ))}
          </div>
        ) : null}
      </div>

      <section className="horse-card__brief" aria-label="短評">
        <p className="horse-card__brief-line horse-card__brief-line--compact">
          <span className="horse-card__brief-mark" aria-label="印">
            {mark || "・"}
          </span>
          {" · "}
          <span>
            <strong>点数</strong> {result.finalEvaluationScore.toFixed(1)}
          </span>
          {" · "}
          {result.buyLabel === BUY_LABELS.DISMISS ? (
            <strong>{BUY_LABELS.DISMISS}</strong>
          ) : (
            <>
              <strong>{JUDGMENT.BUY}</strong> {result.buyLabel}
            </>
          )}
        </p>
      </section>

      <FitLabel level={fitLevel} supplement={fitLine} />

      <button
        type="button"
        className="horse-card__toggle"
        id={`${id}-btn`}
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((o) => !o)}
      >
        {UI.DETAIL} {open ? "▼" : "▶"}
      </button>

      <div
        className="horse-card__detail"
        id={panelId}
        role="region"
        aria-labelledby={`${id}-btn`}
        hidden={!open}
      >
        {strongLine ? (
          <p className="horse-card__strengths">
            <strong>{UI.STRENGTH}：</strong>
            {strongLine}
          </p>
        ) : null}

        <h4 className="horse-card__detail-h">能力バー</h4>
        <AbilityBar horse={horse} grades={grades} />

        <p
          className="horse-card__meta"
          title="相対＝同一レース内の合成素点を z 化（分散が小さいとき min-max）し 35〜85。最終＝相対＋展開＋ラップ形状一致−分散ペナルティ。"
        >
          <strong>{UI.RACE_RELATIVE}</strong> {result.raceRelativeScore.toFixed(1)} ·{" "}
          <strong>{UI.FINAL_EVAL_SCORE}</strong> {result.finalEvaluationScore.toFixed(1)}
          {(result.paceFitBonus !== 0 || lapTotal !== 0 || contextualTotal !== 0) ? (
            <span className="horse-card__rank-note">
              （
              {result.paceFitBonus !== 0
                ? `展開 ${result.paceFitBonus >= 0 ? "+" : ""}${result.paceFitBonus.toFixed(1)}`
                : null}
              {result.paceFitBonus !== 0 && (lapTotal !== 0 || contextualTotal !== 0) ? " / " : null}
              {lapTotal !== 0 ? (
                <span
                  className={
                    lapTotal > 0
                      ? "horse-card__lap-bonus--pos"
                      : "horse-card__lap-bonus--neg"
                  }
                  title="ラップ形状一致 + 消耗戦持続力 + 上がりの質"
                >
                  {`ラップ ${lapTotal >= 0 ? "+" : ""}${lapTotal.toFixed(1)}`}
                </span>
              ) : null}
              {lapTotal !== 0 && contextualTotal !== 0 ? " / " : null}
              {contextualTotal !== 0
                ? `文脈 ${contextualTotal >= 0 ? "+" : ""}${contextualTotal.toFixed(1)}`
                : null}
              ）
            </span>
          ) : null}
        </p>

        <p className="horse-card__meta">
          <strong>素ブレンド</strong> {result.baseAbilityCore.toFixed(1)} · <strong>合成素点</strong>{" "}
          {result.raceAdjustedInput.toFixed(1)}
          {(result.reproducibilityDelta !== 0 || result.riskPenalty > 0) && (
            <span className="horse-card__rank-note">
              {" "}
              （再現性 {result.reproducibilityDelta >= 0 ? "+" : ""}
              {result.reproducibilityDelta.toFixed(1)}
              {result.riskPenalty > 0 ? ` / 大敗減点 ${result.riskPenalty.toFixed(1)}` : ""}）
            </span>
          )}
        </p>

        <p
          className="horse-card__meta"
          title="血統/枠順バイアス/陣営/年齢体重傾向/前後傾差適性/不利恩恵を合算した補正。未入力データは中立(0)。"
        >
          <strong>文脈補正</strong> {contextualTotal >= 0 ? "+" : ""}
          {contextualTotal.toFixed(1)}
          {" "}
          <span className="horse-card__rank-note">
            （血統 {result.pedigreeBonus >= 0 ? "+" : ""}
            {result.pedigreeBonus.toFixed(1)} / 枠 {result.gateBiasBonus >= 0 ? "+" : ""}
            {result.gateBiasBonus.toFixed(1)} / 枠×脚質 {result.gateStyleSynergyBonus >= 0 ? "+" : ""}
            {result.gateStyleSynergyBonus.toFixed(1)} / 陣営 {result.connectionsBonus >= 0 ? "+" : ""}
            {result.connectionsBonus.toFixed(1)} / 鞍上 {result.jockeyRiderBonus != null && result.jockeyRiderBonus >= 0 ? "+" : ""}
            {(result.jockeyRiderBonus ?? 0).toFixed(1)} / 馬格 {result.heavyWeightPowerBonus != null && result.heavyWeightPowerBonus >= 0 ? "+" : ""}
            {(result.heavyWeightPowerBonus ?? 0).toFixed(1)} / 耐久 {result.staminaTestBonus != null && result.staminaTestBonus >= 0 ? "+" : ""}
            {(result.staminaTestBonus ?? 0).toFixed(1)} / 傾向 {result.trendBonus >= 0 ? "+" : ""}
            {result.trendBonus.toFixed(1)} / 前後傾 {result.paceBalanceBonus >= 0 ? "+" : ""}
            {result.paceBalanceBonus.toFixed(1)} / 不利恩恵 {result.tripContextBonus >= 0 ? "+" : ""}
            {result.tripContextBonus.toFixed(1)}）
          </span>
        </p>

        {result.pastRunInsight ? (
          <p className="horse-card__meta" title="過去走データから推定（着差・ラップ展開の一貫性）">
            <strong>過去走シグナル</strong> {result.pastRunInsight}
          </p>
        ) : null}

        {result.roleHint !== "判定不能" && (
          <p className="horse-card__meta" title="過去走パフォーマンスの標準偏差。高いほど一発型、低いほど安定型。">
            <strong>安定度</strong>{" "}
            <span
              className={
                result.roleHint === "頭"
                  ? "horse-card__role-badge horse-card__role-badge--head"
                  : "horse-card__role-badge horse-card__role-badge--axis"
              }
            >
              {result.roleHint}
            </span>
            {" "}
            <span className="horse-card__rank-note">
              （ばらつき stddev {result.varianceScore.toFixed(1)}）
            </span>
          </p>
        )}

        <p className="horse-card__meta">
          <strong>{UI.BASE_SCORE}</strong> {result.baseScore.toFixed(1)}
        </p>
        <p className="horse-card__type">
          <strong>{UI.TYPE}：</strong>
          {typeLabel}
        </p>

        <p className="horse-card__meta">
          <strong>{UI.RANK_SHIFT_FINAL}</strong> {result.baseRank ?? "-"} → {orderRank ?? "-"}
          {rankDelta !== 0 ? (
            <span className="horse-card__rank-note">
              （{rankDelta > 0 ? `↑${rankDelta}` : `↓${-rankDelta}`}）
            </span>
          ) : (
            <span className="horse-card__rank-note horse-card__rank-note--flat">（→）</span>
          )}
        </p>

        <TypeMatchList peers={l1Peers} />

        <section className="horse-card__reason">
          <h4 className="horse-card__detail-h">詳細評価</h4>
          <pre className="horse-card__reason-body">{result.reason}</pre>
        </section>
      </div>
    </article>
  );
}
