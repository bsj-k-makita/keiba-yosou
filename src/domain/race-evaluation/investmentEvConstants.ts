/** enrich の final_expected_value がこれを超えたら「推奨」系バッジ（UI 共通） */
export const FINAL_EXPECTED_RECOMMEND_THRESHOLD = 1.2;

/** Python ML 実質 EV の控除（`betting_evaluator` / backfill と同型） */
export const PYTHON_EV_MARGIN = 0.15;

/** AI モード単勝 EV 推奨閾値（`python/config.py` MIN_EV_THRESHOLD と整合） */
export const AI_EFFECTIVE_EV_THRESHOLD = 1.05;
