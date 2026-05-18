"""
競馬予想AIシステム - 設定定数
"""

import os
from pathlib import Path

# ============================================================
# パス設定
# ============================================================
BASE_DIR = Path(__file__).parent
DATA_DIR = BASE_DIR / "data"
DB_DIR = DATA_DIR / "db"
MODEL_DIR = BASE_DIR / "models"
LOG_DIR = BASE_DIR / "logs"

for d in [DATA_DIR, DB_DIR, MODEL_DIR, LOG_DIR]:
    d.mkdir(parents=True, exist_ok=True)

# ============================================================
# データベース
# ============================================================
DB_PATH = DB_DIR / "keiba.db"

# ============================================================
# スクレイピング設定
# ============================================================
BASE_URL = "https://db.netkeiba.com"
RACE_URL = BASE_URL + "/race/{race_id}/"
HORSE_URL = BASE_URL + "/horse/{horse_id}/"
PED_URL = BASE_URL + "/horse/ped/{horse_id}/"

REQUEST_INTERVAL = 1.5      # リクエスト間隔（秒）
REQUEST_TIMEOUT = 30        # タイムアウト（秒）
MAX_RETRY = 3               # リトライ回数

# Seleniumドライバ設定
HEADLESS = True
CHROME_DRIVER_PATH = os.environ.get("CHROME_DRIVER_PATH", "chromedriver")

# ============================================================
# 対象年度
# ============================================================
TARGET_YEARS = list(range(2018, 2026))   # 学習対象年（2018〜2025）

# 注意: 会場コードによる絞り込みは廃止。
# 日付ベース取得（race/list/YYYYMMDD/）で JRA・NAR 全会場を自動取得する。
# JRAのみ対象にしたい場合は collect_all(jra_only=True) を指定する。

# ============================================================
# 特徴量設定
# ============================================================

# ラベルエンコードするカテゴリ列
CATEGORICAL_COLS = [
    "venue",
    "surface",
    "weather",
    "ground_state",
    "race_class",
    "running_style",
    "sex",
    "sire",
    "dam_sire",
]

# 数値変換する列（前処理後）
NUMERIC_COLS = [
    "frame_number",
    "horse_number",
    "age",
    "weight_carried",
    "body_weight",
    "body_weight_diff",
    "distance",
    "horse_count",
    "odds",
    "popularity",
]

# ============================================================
# モデル設定
# ============================================================
RANDOM_SEED = 42
CV_FOLDS = 5
TEST_YEARS = [2024, 2025]   # テスト（評価）に使う年

# OOF期待値に基づく学習サンプル重み（シグモイド）
ENABLE_EV_SAMPLE_WEIGHT = True
EV_WEIGHT_CENTER = 0.9
EV_WEIGHT_TAU = 0.02


def resolve_test_years(df, date_col: str = "race_date") -> list[int]:
    """TEST_YEARS のうちデータに存在する年。無ければ最新年（collect-quick 2026 等）。"""
    import pandas as pd

    years = pd.to_datetime(df[date_col], errors="coerce").dt.year.dropna().astype(int)
    if years.empty:
        return list(TEST_YEARS)
    avail = set(int(y) for y in years.unique())
    hit = [y for y in TEST_YEARS if y in avail]
    return hit if hit else [int(years.max())]


def resolve_test_mask(
    df,
    date_col: str = "race_date",
    race_col: str = "race_id",
    min_train_rows: int = 50,
):
    """
    評価用マスク。TEST_YEARS が全件を占める場合はレース時系列の末尾20%をホールドアウト。
    Returns: (test_mask: pd.Series, test_years_label: list | str)
    """
    import pandas as pd

    df = df.copy()
    df[date_col] = pd.to_datetime(df[date_col], errors="coerce")
    years = resolve_test_years(df, date_col=date_col)
    test_mask = df[date_col].dt.year.isin(years)
    if int((~test_mask).sum()) < min_train_rows:
        ordered = df.sort_values(date_col)[race_col].drop_duplicates()
        n_test = max(5, len(ordered) // 5)
        test_ids = set(ordered.iloc[-n_test:])
        test_mask = df[race_col].isin(test_ids)
        return test_mask, f"holdout_last_{n_test}_races"
    return test_mask, years

LGBM_PARAMS = {
    "objective": "binary",
    "metric": "auc",
    "boosting_type": "gbdt",
    "num_leaves": 63,
    "learning_rate": 0.05,
    "feature_fraction": 0.8,
    "bagging_fraction": 0.8,
    "bagging_freq": 5,
    "min_child_samples": 20,
    "lambda_l1": 0.1,
    "lambda_l2": 0.1,
    "verbose": -1,
    "n_estimators": 1000,
    "early_stopping_rounds": 50,
}

# ============================================================
# シミュレーション設定
# ============================================================
BET_UNIT = 100              # 1ベット単位（円）
MIN_ODDS_WIN = 1.5          # 単勝：最低オッズ閾値
MIN_EV_THRESHOLD = 1.05     # 期待値が1.05以上なら購入

# 馬券種別ごとの設定
TICKET_CONFIGS = {
    "win":   {"name": "単勝", "ev_threshold": 1.05},
    "place": {"name": "複勝", "ev_threshold": 1.03},
}

# ============================================================
# ロギング
# ============================================================
LOG_LEVEL = "INFO"
LOG_FILE = LOG_DIR / "keiba.log"
