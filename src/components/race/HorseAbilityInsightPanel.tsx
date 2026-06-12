import { useMemo } from "react";
import {
  ABILITY_KEYS,
  ABILITY_LABELS,
  inferHorseAbilityTypeLabel,
  resolveHorseEffectiveEv,
  type AbilityGradeRow,
  type HorseAbility,
  type HorseScoreResult,
  type RaceCondition,
} from "../../domain/race-evaluation";
import { BUY_LABELS } from "../../domain/race-evaluation/lingoConstants";
import { getEffectiveEvaluationSignals } from "../../domain/race-evaluation/resolveEvaluationSignals";
import { RadarChart } from "./RadarChart";
import { runningStyleToStripShortLabel } from "./RunningStyleStrip";
import type { RaceEvaluationViewModel } from "../../viewModel/raceEvaluationViewModel";

type Props = {
  horse: HorseAbility;
  result: HorseScoreResult;
  condition: RaceCondition;
  grades?: AbilityGradeRow | null;
  viewModel?: RaceEvaluationViewModel;
  density?: "simple" | "analysis";
  compact?: boolean;
};

type InsightTagTone = "hot" | "risk" | "neutral" | "good";
type InsightTag = { label: string; tone: InsightTagTone };
type FactorSummary = { positive: string[]; risk: string[] };

const FACTOR_LABELS: Array<{ key: keyof HorseScoreResult; label: string }> = [
  { key: "paceFitBonus", label: "展開適性" },
  { key: "distanceFitBonus", label: "距離適性" },
  { key: "classLevelBonus", label: "クラス適性" },
  { key: "lapShapeFitBonus", label: "ラップ一致" },
  { key: "lapSustainBonus", label: "持続力" },
  { key: "tripContextBonus", label: "展開文脈" },
  { key: "connectionsBonus", label: "騎手・厩舎" },
  { key: "trendBonus", label: "近走傾向" },
];

function toSigned(value: number): string {
  const sign = value >= 0 ? "+" : "";
  return `${sign}${value.toFixed(1)}`;
}

function summarizeReasonText(row: HorseScoreResult): string {
  if (row.predictionShortComment?.trim()) return row.predictionShortComment.trim();
  if (row.reason?.trim()) return row.reason.split("。")[0]!.trim() + "。";
  return "データ不足のため短評を生成できません。";
}

function summarizeFactors(row: HorseScoreResult): FactorSummary {
  const entries = FACTOR_LABELS.map(({ key, label }) => {
    const value = row[key];
    return { label, value: typeof value === "number" ? value : 0 };
  }).filter((item) => Math.abs(item.value) >= 0.2);
  const positive = entries
    .filter((item) => item.value > 0)
    .sort((a, b) => b.value - a.value)
    .slice(0, 2)
    .map((item) => `${item.label}${toSigned(item.value)}`);
  const risk = entries
    .filter((item) => item.value < 0)
    .sort((a, b) => a.value - b.value)
    .slice(0, 1)
    .map((item) => `${item.label}${toSigned(item.value)}`);
  return { positive, risk };
}

function buildInsightComment(row: HorseScoreResult): string {
  const summary = summarizeFactors(row);
  const positives = summary.positive.length > 0 ? summary.positive.join(" / ") : "大きな押し材料は限定的";
  const risks = summary.risk.length > 0 ? summary.risk[0] : "目立つリスクなし";
  return `押し: ${positives}。 リスク: ${risks}。`;
}

function buildTags(row: HorseScoreResult, horse: HorseAbility, ev: number | null, odds: number | null): InsightTag[] {
  const tags: InsightTag[] = [];
  if (row.buyLabel === BUY_LABELS.DISMISS) {
    tags.push({ label: "消し候補", tone: "risk" });
    return tags;
  }
  if (ev != null && ev >= 1.25 && (odds == null || odds >= 8)) tags.push({ label: "妙味アリ", tone: "hot" });
  if (odds != null && odds <= 5 && (ev ?? 0.95) < 1.0) tags.push({ label: "危険人気", tone: "risk" });
  if (row.roleHint === "軸") tags.push({ label: "軸向き", tone: "good" });
  if (row.roleHint === "頭") tags.push({ label: "頭向き", tone: "neutral" });
  if ((row.paceFitBonus ?? 0) >= 2) tags.push({ label: "展開追い風", tone: "good" });
  if ((row.paceFitBonus ?? 0) <= -2) tags.push({ label: "展開逆風", tone: "risk" });
  if ((horse.suitabilityFlags?.length ?? 0) > 0) tags.push({ label: "適性注意", tone: "neutral" });
  return tags.slice(0, 4);
}

export function HorseAbilityInsightPanel({
  horse,
  result,
  condition,
  grades = null,
  viewModel,
  density = "analysis",
  compact = false,
}: Props) {
  const vmHorse = viewModel?.byHorseId.get(horse.horseId);
  const resolvedEv = resolveHorseEffectiveEv(horse);
  const effectiveEv = vmHorse?.effectiveEv ?? resolvedEv.effectiveEv ?? null;
  const odds = getEffectiveEvaluationSignals(horse)?.winOdds ?? null;
  const typeLabel = inferHorseAbilityTypeLabel(horse, condition);
  const tags = useMemo(() => buildTags(result, horse, effectiveEv, odds), [result, horse, effectiveEv, odds]);
  const reasonText = summarizeReasonText(result);
  const insightComment = buildInsightComment(result);
  const evBand =
    effectiveEv == null ? "muted" : effectiveEv >= 1.25 ? "hot" : effectiveEv >= 1.0 ? "good" : "risk";
  const radarMap = vmHorse?.weightedRadar ?? {
    speed: horse.speed,
    stamina: horse.stamina,
    kick: horse.kick,
    sustain: horse.sustain,
    power: horse.power,
  };

  return (
    <section className={`hai-panel${compact ? " hai-panel--compact" : ""}`} aria-label="能力インサイト">
      <header className="hai-panel__head">
        <div>
          <p className="hai-panel__kicker">Ability Insight</p>
          <h3>
            {horse.horseName}
            <span>{runningStyleToStripShortLabel(horse.runningStyle, horse.position_x)}</span>
          </h3>
        </div>
        <div className="hai-panel__score">
          <span className={`hai-panel__ev hai-panel__ev--${evBand}`}>
            EV {effectiveEv != null ? effectiveEv.toFixed(2) : "--"}
          </span>
          <span>単勝 {odds != null ? `${odds.toFixed(1)}倍` : "--"}</span>
          <span>評価 {result.finalEvaluationScore.toFixed(1)}</span>
        </div>
      </header>

      <div className="hai-panel__core">
        <div className="hai-panel__radar-wrap">
          <RadarChart horse={radarMap} grades={grades ?? undefined} size={compact ? 136 : 164} />
          <p className="hai-panel__type">{typeLabel}</p>
        </div>
        <ul className="hai-panel__ability-list">
          {ABILITY_KEYS.map((key) => (
            <li key={key}>
              <span>{ABILITY_LABELS[key]}</span>
              <strong>{Math.round(horse[key])}</strong>
              {grades ? <em data-grade={grades[key]}>{grades[key]}</em> : null}
            </li>
          ))}
        </ul>
      </div>

      <div className="hai-panel__tags">
        {tags.length > 0 ? (
          tags.map((tag) => (
            <span key={tag.label} className={`hai-panel__tag hai-panel__tag--${tag.tone}`}>
              {tag.label}
            </span>
          ))
        ) : (
          <span className="hai-panel__tag hai-panel__tag--neutral">注目タグなし</span>
        )}
      </div>

      {density === "analysis" ? (
        <div className="hai-panel__commentary">
          <p>{insightComment}</p>
          <p>{reasonText}</p>
        </div>
      ) : null}
    </section>
  );
}

