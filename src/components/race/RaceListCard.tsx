import { Link } from "react-router-dom";
import type { RaceBettingOutcome } from "../../domain/betting/computeRaceBettingOutcome";
import type { RaceIndexItem } from "../../lib/race-data/raceEvaluationTypes";
import { NetkeibaRaceLinks } from "./NetkeibaRaceLinks";

type PreviewBadge = { label: string; tone: string } | null;
type GradeBadge = { label: string; variant: string } | null;

type Props = {
  item: RaceIndexItem;
  outcome?: RaceBettingOutcome | null;
  previewBadge?: PreviewBadge;
  gradeBadge?: GradeBadge;
  previewText?: string;
  featured?: boolean;
  surfaceBadgeClass: (surface: string) => string;
  surfaceShort: (surface: string) => string;
  raceIcon: (surface: "芝" | "ダート") => string;
};

function cardTone(outcome: RaceBettingOutcome | null | undefined): "hit" | "miss" | "neutral" {
  if (outcome == null || outcome.status !== "resolved") return "neutral";
  if (outcome.isHit || outcome.hasFormationHit) return "hit";
  return "miss";
}

function hitStatusLabel(outcome: RaceBettingOutcome): string {
  if (outcome.isHit && outcome.totalPayout > 0) return "🎯 的中";
  if (outcome.hasFormationHit) return "印的中";
  return missStatusLabel(outcome);
}

function missStatusLabel(outcome: RaceBettingOutcome): string {
  return outcome.isSecondRowDead ? "2列目全滅" : "不的中";
}

export function RaceListCard({
  item,
  outcome,
  previewBadge,
  gradeBadge,
  previewText,
  featured = false,
  surfaceBadgeClass,
  surfaceShort,
  raceIcon,
}: Props) {
  const tone = cardTone(outcome);
  const resolved = outcome?.status === "resolved";

  if (tone === "neutral") {
    return (
      <div className={`rl-race-card-wrap${featured ? " rl-race-card-wrap--featured" : ""}`}>
        <Link to={`/race/${item.raceId}`} className="rl-race-row" title={item.raceName ?? item.raceId}>
          <div className="rl-race-row__top">
            <div className="rl-race-row__left">
              <div className="rl-race-row__r-badge" aria-label={`${item.raceNumber}レース`}>
                <span className="rl-race-row__r-label">R</span>
                <span className="rl-race-row__r-num">{item.raceNumber}</span>
              </div>
              <div className="rl-race-row__lead">
                {previewBadge ? (
                  <span className={`rl-race-row__feature rl-race-row__feature--${previewBadge.tone}`}>
                    {previewBadge.label}
                  </span>
                ) : null}
              </div>
            </div>
            <span className="rl-race-row__arrow" aria-hidden>
              ›
            </span>
          </div>
          <div className="rl-race-row__info">
            <div className="rl-race-row__name-row">
              <span className="rl-race-row__name" title={item.raceName}>
                {item.raceName ?? `${item.raceNumber}R`}
              </span>
              {gradeBadge ? (
                <span className={`rl-race-grade rl-race-grade--${gradeBadge.variant}`}>{gradeBadge.label}</span>
              ) : null}
            </div>
            {previewText ? <p className="rl-race-row__preview">{previewText}</p> : null}
            <div className="rl-race-row__meta">
              <span className={surfaceBadgeClass(item.surface)}>
                {raceIcon(item.surface)} {surfaceShort(item.surface)} {item.distance}m
              </span>
              {!resolved && <span className="rl-race-list__recovery rl-race-list__recovery--pending">回収 未確定</span>}
            </div>
          </div>
        </Link>
        <NetkeibaRaceLinks raceId={item.raceId} variant="cardBar" />
      </div>
    );
  }

  return (
    <div className={`bt-hit-card bt-hit-card--${tone}`}>
      <Link to={`/race/${item.raceId}`} className="bt-hit-card__link" title={item.raceName ?? item.raceId}>
        <div className="bt-hit-card__top">
          <div className="bt-hit-card__left">
            <div className="bt-hit-card__r-badge" aria-label={`${item.raceNumber}レース`}>
              <span className="bt-hit-card__r-label">R</span>
              <span className="bt-hit-card__r-num">{item.raceNumber}</span>
            </div>
            {outcome ? (
              <span
                className={
                  tone === "hit"
                    ? "bt-hit-card__status bt-hit-card__status--hit"
                    : "bt-hit-card__status bt-hit-card__status--miss"
                }
              >
                {hitStatusLabel(outcome)}
              </span>
            ) : null}
          </div>
          {tone === "hit" && outcome && outcome.totalPayout > 0 && (
            <span className="bt-hit-card__payout">{outcome.totalPayout.toLocaleString()}円</span>
          )}
          {resolved && outcome && (
            <span
              className={`bt-hit-card__recovery${outcome.recoveryRate >= 100 ? " bt-hit-card__recovery--plus" : ""}`}
            >
              回収 {outcome.recoveryRate}%
            </span>
          )}
          <span className="bt-hit-card__arrow" aria-hidden>
            ›
          </span>
        </div>
        <div className="bt-hit-card__body">
          <div className="bt-hit-card__name-row">
            <span className="bt-hit-card__name">{item.raceName ?? `${item.raceNumber}R`}</span>
            {gradeBadge ? <span className="bt-hit-card__tier">{gradeBadge.label}</span> : null}
          </div>
          {previewText ? <p className="bt-hit-card__diagnosis">{previewText}</p> : null}
          <div className="bt-hit-card__tickets">
            <span className={surfaceBadgeClass(item.surface)}>
              {raceIcon(item.surface)} {surfaceShort(item.surface)} {item.distance}m
            </span>
          </div>
        </div>
      </Link>
      <NetkeibaRaceLinks raceId={item.raceId} variant="cardBar" />
    </div>
  );
}
