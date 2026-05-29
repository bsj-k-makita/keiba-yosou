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
export const REN_EV_THRESHOLD = 1.8;

/**
 * ワイド（WREN）EV 推奨閾値（◎軸・複勝圏保険）。
 * 馬連より緩め。単勝10倍以上の大穴相手の滑り込みを拾う。
 */
export const WIDE_EV_THRESHOLD = 1.3;

/** ワイド（WREN）相手馬の単勝オッズ下限（大穴限定トリミング） */
export const WIDE_PARTNER_MIN_WIN_ODDS = 10.0;

/** 3連複（TRI）EV 推奨閾値 */
export const TRI_EV_THRESHOLD = 2.0;

/** AI 3連複: 3列目候補の単勝オッズ上限（100倍以上は最大2頭まで） */
export const AI_TRI_ULTRA_LONGSHOT_ODDS_CAP = 100.0;

/** AI 3連複: 100倍以上の3列目候補の最大頭数 */
export const AI_TRI_ULTRA_LONGSHOT_MAX_COUNT = 2;

/** AI 3連複: 無印・150倍以上は3列目ヒモ候補から完全除外 */
export const AI_TRI_NOISE_EXCLUSION_ODDS = 150.0;

/** AI 3連複: 3列目のEV上位候補枠 */
export const AI_TRI_THIRD_COLUMN_SIZE = 8;

/** AI 3連複: 2列目のEV上位候補枠 */
export const AI_TRI_SECOND_COLUMN_SIZE = 3;

/** AI 3連複: 3列目で優先する単勝オッズ帯（下限） */
export const AI_TRI_PREFERRED_ODDS_MIN = 10.0;

/** AI 3連複: 3列目で優先する単勝オッズ帯（上限） */
export const AI_TRI_PREFERRED_ODDS_MAX = 80.0;

/** EV推奨券 券種ごと上限（単勝・馬連・ワイド） */
export const EV_MAX_TICKETS_PER_TYPE = 10;

/** ワイドのみ EV 上位厳選上限（コスト最適化） */
export const EV_MAX_WIDE_TICKETS_PER_TYPE = 5;

/** 3連複のみ EV 上位厳選上限 */
export const EV_MAX_TRI_TICKETS_PER_TYPE = 3;

/** ◎軸として採用する最低予測勝率（8%） */
export const ANCHOR_MIN_PREDICTED_WIN_RATE = 0.08;

/** 動的EVしきい値の勝率ペナルティ係数（base + coeff / p） */
export const DYNAMIC_EV_THRESHOLD_PENALTY_COEFFICIENT = 0.05;
