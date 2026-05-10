import { FINAL_EXPECTED_RECOMMEND_THRESHOLD } from "../../domain/race-evaluation/investmentEvConstants";

export { FINAL_EXPECTED_RECOMMEND_THRESHOLD };

type Props = {
  /** JSON の final_expected_value（単勝・引き算期待値） */
  finalExpectedValue: number | null | undefined;
  /** 既定 1.2。1.0 にしたい場合のみ上書き */
  threshold?: number;
  className?: string;
};

export function FinalExpectedRecommendBadge({
  finalExpectedValue,
  threshold = FINAL_EXPECTED_RECOMMEND_THRESHOLD,
  className,
}: Props) {
  if (finalExpectedValue == null || !Number.isFinite(finalExpectedValue)) return null;
  if (finalExpectedValue <= threshold) return null;
  return (
    <span
      className={className ?? "horse-card__special-badge"}
      data-kind="positive"
      title={`final_expected_value ${finalExpectedValue.toFixed(2)} > ${threshold}（単勝 P×オッズ − 動的マージン）`}
    >
      推奨
    </span>
  );
}
