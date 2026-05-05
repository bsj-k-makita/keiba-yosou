"""
競馬予想AIシステム - 機械学習モデルモジュール

LightGBMを用いた勝率予測モデルの学習・評価・推論。
ハイパーパラメータチューニング（Optuna）付き。
"""

import logging
import pickle
from pathlib import Path
from typing import Optional

import numpy as np
import pandas as pd
import lightgbm as lgb
from sklearn.metrics import roc_auc_score
from sklearn.model_selection import StratifiedGroupKFold

from config import (
    LGBM_PARAMS, CV_FOLDS, RANDOM_SEED, TEST_YEARS, MODEL_DIR
)

logger = logging.getLogger(__name__)

# ============================================================
# 使用特徴量（学習・推論共通）
# ============================================================
FEATURE_COLS = [
    # 基本情報
    "frame_number", "horse_number", "age", "weight_carried",
    "body_weight", "body_weight_diff", "distance", "horse_count",
    "log_odds", "popularity_ratio",
    "is_outer_frame", "is_inner_frame", "weight_carried_diff_from_avg",
    # 日付
    "month", "day_of_week",
    # カテゴリ（Label Encoded / category型）
    "venue", "surface", "ground_state", "weather", "race_class", "around",
    "sex", "sire", "dam_sire", "running_style", "horse_age_group", "season",
    # 馬過去成績
    "horse_race_count", "horse_win_rate", "horse_top2_rate", "horse_top3_rate",
    "horse_avg_finish", "horse_last_finish", "horse_recent3_avg",
    "horse_days_since_last",
    # 条件別成績
    "horse_same_distance_win_rate", "horse_same_surface_win_rate",
    "horse_same_ground_win_rate", "horse_same_venue_win_rate",
    # 季節別成績
    "horse_month_win_rate", "horse_season_win_rate",
    # 騎手・調教師
    "jockey_win_rate", "jockey_top3_rate", "jockey_venue_win_rate",
    "trainer_win_rate", "trainer_top3_rate",
    # スピード指数
    "speed_index", "last_final3f", "avg_final3f",
    "avg_first_corner",
]


class Model:
    """
    LightGBM 競馬予想モデル。

    - 学習: 時系列を考慮したGroupKFoldで評価後、全データで最終学習
    - 推論: 予測確率を返す
    - 永続化: pickle でモデルを保存・読み込み
    - チューニング: Optunaによるベイズ最適化
    """

    def __init__(self, params: dict | None = None):
        self.params = params or dict(LGBM_PARAMS)
        self.booster: Optional[lgb.Booster] = None
        self.feature_importances_: Optional[pd.DataFrame] = None
        self.cv_scores_: list[float] = []

    # ----------------------------------------------------------
    # 学習
    # ----------------------------------------------------------
    def fit(
        self,
        df: pd.DataFrame,
        target_col: str = "target_win",
        feature_cols: list[str] | None = None,
    ) -> "Model":
        """
        データを学習・評価（TimeSeriesSplit的なGroupKFold）する。

        Args:
            df: 特徴量付きDataFrame（race_date, race_id 列を含む）
            target_col: 目的変数列名
            feature_cols: 使用特徴量（Noneで FEATURE_COLS を使用）
        """
        feature_cols = feature_cols or self._available_features(df)
        logger.info("学習開始: %d rows, %d features", len(df), len(feature_cols))

        X = df[feature_cols].copy()
        y = df[target_col].copy()

        # カテゴリ変数の型確保
        for col in X.columns:
            if X[col].dtype.name == "category":
                pass  # そのまま
            elif X[col].dtype == object:
                X[col] = X[col].astype("category")

        # ============================================================
        # 時系列考慮の交差検証
        # race_id を group として年度単位でフォールド分割
        # ============================================================
        df_sorted = df.sort_values("race_date").reset_index(drop=True)
        X_sorted = X.loc[df_sorted.index]
        y_sorted = y.loc[df_sorted.index]
        groups = df_sorted["race_id"]

        # テストデータ（最新年度）を分離
        test_mask = df_sorted["race_date"].dt.year.isin(TEST_YEARS)
        X_train_all = X_sorted[~test_mask]
        y_train_all = y_sorted[~test_mask]
        X_test = X_sorted[test_mask]
        y_test = y_sorted[test_mask]
        groups_train = groups[~test_mask]

        logger.info(
            "train: %d rows, test: %d rows (years=%s)",
            len(X_train_all), len(X_test), TEST_YEARS
        )

        # GroupKFold でCV
        gkf = StratifiedGroupKFold(n_splits=CV_FOLDS, shuffle=True, random_state=RANDOM_SEED)
        self.cv_scores_ = []
        oof_preds = np.zeros(len(X_train_all))

        for fold, (tr_idx, val_idx) in enumerate(
            gkf.split(X_train_all, y_train_all, groups=groups_train)
        ):
            X_tr, X_val = X_train_all.iloc[tr_idx], X_train_all.iloc[val_idx]
            y_tr, y_val = y_train_all.iloc[tr_idx], y_train_all.iloc[val_idx]

            params = {**self.params}
            n_estimators = params.pop("n_estimators", 1000)
            early_stopping_rounds = params.pop("early_stopping_rounds", 50)

            train_set = lgb.Dataset(X_tr, label=y_tr)
            val_set = lgb.Dataset(X_val, label=y_val, reference=train_set)

            booster = lgb.train(
                params,
                train_set,
                num_boost_round=n_estimators,
                valid_sets=[val_set],
                callbacks=[
                    lgb.early_stopping(early_stopping_rounds, verbose=False),
                    lgb.log_evaluation(200),
                ],
            )

            val_preds = booster.predict(X_val)
            oof_preds[val_idx] = val_preds
            fold_auc = roc_auc_score(y_val, val_preds)
            self.cv_scores_.append(fold_auc)
            logger.info("Fold %d AUC: %.4f", fold + 1, fold_auc)

        oof_auc = roc_auc_score(y_train_all, oof_preds)
        logger.info("OOF AUC: %.4f (mean fold AUC: %.4f)", oof_auc, np.mean(self.cv_scores_))

        # ============================================================
        # 全学習データで最終モデルを作成
        # ============================================================
        params = {**self.params}
        n_estimators = params.pop("n_estimators", 1000)
        params.pop("early_stopping_rounds", None)

        train_set = lgb.Dataset(X_train_all, label=y_train_all)
        self.booster = lgb.train(
            params,
            train_set,
            num_boost_round=int(n_estimators * 1.1),  # 早期停止なしで少し多めに
        )

        # 特徴量重要度
        self.feature_importances_ = pd.DataFrame({
            "feature": feature_cols,
            "importance": self.booster.feature_importance(importance_type="gain"),
        }).sort_values("importance", ascending=False).reset_index(drop=True)

        # テストデータで評価
        if len(X_test) > 0:
            test_preds = self.booster.predict(X_test)
            test_auc = roc_auc_score(y_test, test_preds)
            logger.info("Test AUC (years=%s): %.4f", TEST_YEARS, test_auc)

        self.feature_cols_ = feature_cols
        return self

    # ----------------------------------------------------------
    # ハイパーパラメータチューニング（Optuna）
    # ----------------------------------------------------------
    def tune(
        self,
        df: pd.DataFrame,
        target_col: str = "target_win",
        n_trials: int = 50,
    ) -> dict:
        """
        Optunaでハイパーパラメータを最適化する。

        Returns:
            最適パラメータの辞書
        """
        try:
            import optuna
            optuna.logging.set_verbosity(optuna.logging.WARNING)
        except ImportError:
            logger.error("optuna をインストールしてください: pip install optuna")
            return self.params

        feature_cols = self._available_features(df)
        X = df[feature_cols].copy()
        y = df[target_col].copy()

        # カテゴリ変換
        for col in X.columns:
            if X[col].dtype == object:
                X[col] = X[col].astype("category")

        df_sorted = df.sort_values("race_date").reset_index(drop=True)
        X = X.loc[df_sorted.index]
        y = y.loc[df_sorted.index]
        test_mask = df_sorted["race_date"].dt.year.isin(TEST_YEARS)
        X_tr = X[~test_mask]
        y_tr = y[~test_mask]
        groups_tr = df_sorted[~test_mask]["race_id"]

        def objective(trial: "optuna.Trial") -> float:
            params = {
                "objective": "binary",
                "metric": "auc",
                "boosting_type": "gbdt",
                "verbose": -1,
                "num_leaves": trial.suggest_int("num_leaves", 31, 255),
                "learning_rate": trial.suggest_float("learning_rate", 0.01, 0.1, log=True),
                "feature_fraction": trial.suggest_float("feature_fraction", 0.5, 1.0),
                "bagging_fraction": trial.suggest_float("bagging_fraction", 0.5, 1.0),
                "bagging_freq": trial.suggest_int("bagging_freq", 1, 10),
                "min_child_samples": trial.suggest_int("min_child_samples", 10, 100),
                "lambda_l1": trial.suggest_float("lambda_l1", 0.0, 1.0),
                "lambda_l2": trial.suggest_float("lambda_l2", 0.0, 1.0),
            }

            gkf = StratifiedGroupKFold(n_splits=3, shuffle=True, random_state=RANDOM_SEED)
            aucs = []
            for tr_idx, val_idx in gkf.split(X_tr, y_tr, groups=groups_tr):
                X_t, X_v = X_tr.iloc[tr_idx], X_tr.iloc[val_idx]
                y_t, y_v = y_tr.iloc[tr_idx], y_tr.iloc[val_idx]
                ds = lgb.Dataset(X_t, label=y_t)
                vs = lgb.Dataset(X_v, label=y_v, reference=ds)
                bst = lgb.train(
                    params, ds,
                    num_boost_round=500,
                    valid_sets=[vs],
                    callbacks=[
                        lgb.early_stopping(30, verbose=False),
                        lgb.log_evaluation(-1),
                    ],
                )
                preds = bst.predict(X_v)
                aucs.append(roc_auc_score(y_v, preds))
            return float(np.mean(aucs))

        study = optuna.create_study(direction="maximize")
        study.optimize(objective, n_trials=n_trials, show_progress_bar=True)

        best_params = {**self.params, **study.best_params}
        logger.info("Best AUC: %.4f", study.best_value)
        logger.info("Best params: %s", study.best_params)
        self.params = best_params
        return best_params

    # ----------------------------------------------------------
    # 推論
    # ----------------------------------------------------------
    def predict_proba(self, df: pd.DataFrame) -> np.ndarray:
        """
        各馬の勝利確率を予測する。

        Returns:
            shape (N,) の確率array
        """
        if self.booster is None:
            raise RuntimeError("モデルが学習されていません。fit() を先に呼んでください。")

        feature_cols = getattr(self, "feature_cols_", self._available_features(df))
        X = df[feature_cols].copy()
        for col in X.columns:
            if X[col].dtype == object:
                X[col] = X[col].astype("category")

        return self.booster.predict(X)

    def predict_race(self, df: pd.DataFrame) -> pd.DataFrame:
        """
        1レースの全馬を評価して予測確率順にソートして返す。

        Returns:
            horse_name, horse_id, pred_prob, odds, expected_value 列を含むDataFrame
        """
        df = df.copy()
        df["pred_prob"] = self.predict_proba(df)

        # レース内確率の正規化（合計が1になるよう）
        total = df["pred_prob"].sum()
        if total > 0:
            df["pred_prob_normalized"] = df["pred_prob"] / total
        else:
            df["pred_prob_normalized"] = 1 / len(df)

        # 期待値は BettingEvaluator.decide_bets() で算出するためここでは計算しない
        # （単純な P×O ではなく、マージン控除・ケリー基準を統合した計算が必要なため）

        return df.sort_values("pred_prob", ascending=False).reset_index(drop=True)

    # ----------------------------------------------------------
    # 保存・読み込み
    # ----------------------------------------------------------
    def save(self, path: str | None = None) -> str:
        """モデルをpickleで保存する"""
        if path is None:
            path = str(MODEL_DIR / "lgbm_model.pkl")
        with open(path, "wb") as f:
            pickle.dump(self, f)
        logger.info("Model saved: %s", path)
        return path

    @classmethod
    def load(cls, path: str | None = None) -> "Model":
        """保存済みモデルを読み込む"""
        if path is None:
            path = str(MODEL_DIR / "lgbm_model.pkl")
        with open(path, "rb") as f:
            model = pickle.load(f)
        logger.info("Model loaded: %s", path)
        return model

    # ----------------------------------------------------------
    # ユーティリティ
    # ----------------------------------------------------------
    def _available_features(self, df: pd.DataFrame) -> list[str]:
        """FEATURE_COLS のうちdfに存在する列のみ返す"""
        available = [c for c in FEATURE_COLS if c in df.columns]
        missing = [c for c in FEATURE_COLS if c not in df.columns]
        if missing:
            logger.debug("特徴量が見つかりません（%d件）: %s", len(missing), missing[:10])
        return available

    def print_feature_importance(self, top_n: int = 30) -> None:
        """特徴量重要度をコンソールに表示する"""
        if self.feature_importances_ is None:
            logger.warning("特徴量重要度がありません。fit()後に呼んでください。")
            return
        print("\n=== 特徴量重要度 Top {} ===".format(top_n))
        print(self.feature_importances_.head(top_n).to_string(index=False))
