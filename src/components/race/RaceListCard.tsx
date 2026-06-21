import { Link } from "react-router-dom";
import type { RaceBettingOutcome } from "../../domain/betting/computeRaceBettingOutcome";
import type { RaceIndexItem } from "../../lib/race-data/raceEvaluationTypes";

type GradeBadge = { label: string; variant: string } | null;

type Props = {
  item: RaceIndexItem;
  outcome?: RaceBettingOutcome | null;
  gradeBadge?: GradeBadge;
  honmeiHorseName?: string;
  surfaceBadgeClass: (surface: string) => string;
  surfaceShort: (surface: string) => string;
};

function cardTone(outcome: RaceBettingOutcome | null | undefined): "hit" | "skip" | "miss" | "neutral" {
  if (outcome == null || outcome.status !== "resolved") return "neutral";
  if (outcome.totalInvested === 0) return "skip";
  if (outcome.isHit) return "hit";
  return "miss";
}

function statusLabel(tone: ReturnType<typeof cardTone>, outcome: RaceBettingOutcome): string {
  if (tone === "skip") return "買い目なし";
  if (tone === "hit") return "的中";
  if (tone === "miss") return outcome.isSecondRowDead ? "2列目全滅" : "不的中";
  return "未確定";
}

function formatRecoveryRate(rate: number): string {
  return Number.isInteger(rate) ? String(rate) : rate.toFixed(1);
}

function recoveryLabel(outcome: RaceBettingOutcome | null | undefined): {
  text: string;
  tone: "pending" | "skip" | "plus" | "minus";
} {
  if (outcome == null || outcome.status !== "resolved") {
    return { text: "—", tone: "pending" };
  }
  if (outcome.totalInvested <= 0) {
    return { text: "—", tone: "skip" };
  }
  return {
    text: `${formatRecoveryRate(outcome.recoveryRate)}%`,
    tone: outcome.recoveryRate >= 100 ? "plus" : "minus",
  };
}

export function RaceListCard({
  item,
  outcome,
  gradeBadge,
  honmeiHorseName,
  surfaceBadgeClass,
  surfaceShort,
}: Props) {
  const tone = cardTone(outcome);
  const resolved = outcome?.status === "resolved";
  const raceLabel = item.raceName ?? `${item.raceNumber}R`;
  const recovery = recoveryLabel(outcome);

  return (
    <Link
      to={`/race/${item.raceId}`}
      className={`rl-card rl-card--${tone}`}
      title={raceLabel}
    >
      <div className="rl-card__top">
        <span className="rl-card__r">{item.raceNumber}R</span>
        {gradeBadge ? (
          <span className={`rl-card__grade rl-card__grade--${gradeBadge.variant}`}>{gradeBadge.label}</span>
        ) : null}
      </div>

      <p className="rl-card__name">{raceLabel}</p>

      {honmeiHorseName ? (
        <p className="rl-card__honmei">
          <span className="rl-card__honmei-mark" aria-hidden>
            ◎
          </span>
          <span className="rl-card__honmei-name">{honmeiHorseName}</span>
        </p>
      ) : null}

      <div className="rl-card__foot">
        <span className={surfaceBadgeClass(item.surface)}>
          {surfaceShort(item.surface)} {item.distance}m
        </span>
        <div className="rl-card__meta">
          <span
            className={`rl-card__recovery rl-card__recovery--${recovery.tone}`}
            aria-label={`回収率 ${recovery.text}`}
          >
            回収 {recovery.text}
          </span>
          {resolved && outcome ? (
            <span className={`rl-card__badge rl-card__badge--${tone}`}>{statusLabel(tone, outcome)}</span>
          ) : (
            <span className="rl-card__badge rl-card__badge--pending">未確定</span>
          )}
        </div>
      </div>
    </Link>
  );
}
