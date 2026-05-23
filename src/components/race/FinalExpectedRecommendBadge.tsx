import { FINAL_EXPECTED_RECOMMEND_THRESHOLD } from "../../domain/race-evaluation/investmentEvConstants";
import type { EffectiveEvSource } from "../../domain/race-evaluation/resolveHorseEffectiveEv";

export { FINAL_EXPECTED_RECOMMEND_THRESHOLD };

type Props = {
  /** ai_effective_ev 優先後の表示用期待値 */
  effectiveEv?: number | null;
  /** 期待値の由来（ツールチップ用） */
  evSource?: EffectiveEvSource | null;
  /** @deprecated effectiveEv を渡すこと */
  finalExpectedValue?: number | null | undefined;
  /** 既定 1.2。1.0 にしたい場合のみ上書き */
  threshold?: number;
  className?: string;
};

function sourceLabel(source: EffectiveEvSource | null | undefined): string {
  if (source === "ai") return "ai_effective_ev（Python AI）";
  if (source === "simple") return "final_expected_value（Node 簡易）";
  return "期待値";
}

export function FinalExpectedRecommendBadge({
  effectiveEv: effectiveEvProp,
  evSource,
  finalExpectedValue,
  threshold = FINAL_EXPECTED_RECOMMEND_THRESHOLD,
  className,
}: Props) {
  const effectiveEv = effectiveEvProp ?? finalExpectedValue;
  if (effectiveEv == null || !Number.isFinite(effectiveEv)) return null;
  if (effectiveEv <= threshold) return null;
  const src = sourceLabel(evSource);
  return (
    <span
      className={className ?? "horse-card__special-badge"}
      data-kind="positive"
      data-ev-source={evSource ?? undefined}
      title={`${src} ${effectiveEv.toFixed(2)} > ${threshold}`}
    >
      推奨
    </span>
  );
}
