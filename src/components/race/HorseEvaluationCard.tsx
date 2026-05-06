import { useId, useMemo, useState } from "react";
import type { AbilityGradeRow } from "../../domain/race-evaluation/abilityGrades";
import {
  ABILITY_KEYS,
  ABILITY_LABELS,
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
import {
  ABILITY_AXIS_DESCRIPTIONS,
  BUY_LABELS,
  JUDGMENT,
  UI,
} from "../../domain/race-evaluation/lingoConstants";
import { computePaceFitLevel } from "../../domain/race-evaluation/paceFit";
import {
  buildHorseAiShortReview,
  buildHorseShortComment,
  buildScoreReasonBrief,
  buildFitSupplementLine,
} from "../../domain/race-evaluation/reasonGenerator";
import { inferHorseAbilityTypeLabel } from "../../domain/race-evaluation/typeMatcher";
import { AbilityBar } from "./AbilityBar";
import { FitLabel } from "./FitLabel";
import { getFrameColor } from "./frameColor";
import { RadarChart } from "./RadarChart";
import { ScoreDiffIndicator } from "./ScoreDiffIndicator";
import { TypeMatchList } from "./TypeMatchList";
import {
  computeConnectionSpecialBadges,
  computeMarketAlertLabel,
  getLapProfileVisual,
} from "./evaluationTags";
import type { RaceEvaluationViewModel } from "../../viewModel/raceEvaluationViewModel";

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
}: Props) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const panelId = `${id}-detail`;

  const mark = result.mark ?? "";
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
  const shortComment = useMemo(
    () => buildHorseShortComment(horse, result, condition),
    [horse, result, condition],
  );
  const fitLine = useMemo(
    () => buildFitSupplementLine(horse, condition),
    [horse, condition],
  );
  const scoreReason = useMemo(() => buildScoreReasonBrief(result), [result]);
  const paceFit = useMemo(
    () => computePaceFitLevel(horse, condition),
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

  const weightedRadar = viewModel?.byHorseId.get(horse.horseId)?.weightedRadar;
  const hMap = useMemo(() => weightedRadar ?? horseToRadarMap(horse), [horse, weightedRadar]);
  const radarShape = useMemo(() => inferRadarShape(horse), [horse]);
  const effectiveEv = viewModel?.byHorseId.get(horse.horseId)?.effectiveEv ?? horse.investment?.valueScore;
  const effectiveEvHot =
    effectiveEv != null && Number.isFinite(effectiveEv) && effectiveEv > 1.25;
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
    (result.trendBonus ?? 0) +
    (result.paceBalanceBonus ?? 0) +
    (result.tripContextBonus ?? 0);
  const lapTotal = (result.lapShapeFitBonus ?? 0) + (result.lapSustainBonus ?? 0) + (result.lapQualityBonus ?? 0);
  const lapVisual = getLapProfileVisual(result.lapProfile);
  const marketAlert = useMemo(
    () => computeMarketAlertLabel(horse, result, allHorses),
    [allHorses, horse, result],
  );
  const aiShortReview = useMemo(
    () => buildHorseAiShortReview(horse, result, condition, allHorses, grades, marketAlert ?? undefined),
    [allHorses, condition, grades, horse, marketAlert, result],
  );
  const connectionBadges = useMemo(
    () => computeConnectionSpecialBadges(horse, condition),
    [horse, condition],
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

  return (
    <article
      className={`horse-card${compact ? " horse-card--compact" : ""}${effectiveEvHot ? " horse-card--ev-gold" : ""}`}
      data-buylabel={result.buyLabel}
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
          <span className="horse-card__style-badge" title={UI.RUNNING_STYLE}>
            {horse.runningStyle}
          </span>
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
        </div>
      </header>

      <div className="horse-card__sub-row">
        <p className="horse-card__pace-fit" title="脚質に対する展開の噛み合い（能力の向きではない）">
          {UI.PACE_FIT}
          {paceFit}
        </p>
        <span className="horse-card__lap-profile" title="ラップ適性プロファイル">
          {lapVisual.icon} {lapVisual.label}
        </span>
        {result.roleHint !== "判定不能" && (
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
        )}
      </div>

      <section className="horse-card__ability-panel" aria-label="基本能力">
        <h3 className="horse-card__ability-title">基本能力</h3>
        <div className="horse-card__ability-main">
          <div className="horse-card__radar-hero" aria-label="能力バランス">
            <div className="horse-card__radar-svg-wrap">
              <RadarChart horse={hMap} size={200} />
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
        <dl className="horse-card__ability-guide">
          {ABILITY_KEYS.map((k) => (
            <div key={`guide-${k}`} className="horse-card__ability-guide-row">
              <dt className="horse-card__ability-guide-term">{ABILITY_LABELS[k]}</dt>
              <dd className="horse-card__ability-guide-desc">{ABILITY_AXIS_DESCRIPTIONS[k]}</dd>
            </div>
          ))}
        </dl>
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
        {connectionBadges.length > 0 || courseTraitBadge != null ? (
          <div className="horse-card__special-badges">
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
        <p className="horse-card__brief-line">{aiShortReview}</p>
        <p className={`horse-card__brief-conclusion horse-card__brief-conclusion--${shortComment.tone}`}>
          <span className="horse-card__brief-label">{shortComment.label}</span>
          <span>{shortComment.conclusion}</span>
        </p>
        <p className="horse-card__brief-line">
          <strong>展開:</strong> {shortComment.scenario}
        </p>
        <p className="horse-card__brief-line">
          <strong>過去走:</strong> {shortComment.past}
        </p>
        <p className="horse-card__brief-line">
          <strong>点数根拠:</strong> {shortComment.scoring}
        </p>
        <div className="horse-card__score-why" aria-label="点数理由">
          <p className="horse-card__brief-line">
            <strong>点数理由:</strong> {scoreReason.headline}
          </p>
          <p className="horse-card__brief-line">{scoreReason.detail}</p>
        </div>
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
            {result.connectionsBonus.toFixed(1)} / 傾向 {result.trendBonus >= 0 ? "+" : ""}
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
