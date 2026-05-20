/** enrich の final_expected_value がこれを超えたら「推奨」系バッジ（UI 共通） */
export const FINAL_EXPECTED_RECOMMEND_THRESHOLD = 1.2;

/** Python ML 実質 EV の控除（`betting_evaluator` / backfill と同型） */
export const PYTHON_EV_MARGIN = 0.15;

/**
 * AI モード単勝 EV 推奨閾値。
 * 2パス再学習後の ai_effective_ev インフレに合わせて 1.05 → 1.30 に引き上げ。
 */
export const AI_EFFECTIVE_EV_THRESHOLD = 1.3;

/** 馬連（REN）EV 推奨閾値（◎軸） */
export const REN_EV_THRESHOLD = 1.6;

/**
 * ワイド（WREN）EV 推奨閾値（◎軸・複勝圏保険）。
 * 馬連より緩め。単勝10倍以上の大穴相手の滑り込みを拾う。
 */
export const WIDE_EV_THRESHOLD = 1.2;

/** ワイド（WREN）相手馬の単勝オッズ下限（大穴限定トリミング） */
export const WIDE_PARTNER_MIN_WIN_ODDS = 10.0;

/** 3連複（TRI）EV 推奨閾値（◎軸・万馬券ハント） */
export const TRI_EV_THRESHOLD = 1.4;

/** EV推奨券 券種ごと上限（単勝・馬連・ワイド） */
export const EV_MAX_TICKETS_PER_TYPE = 10;

/** ワイドのみ EV 上位厳選上限（コスト最適化） */
export const EV_MAX_WIDE_TICKETS_PER_TYPE = 5;

/** 3連複のみ EV 上位厳選上限 */
export const EV_MAX_TRI_TICKETS_PER_TYPE = 3;
