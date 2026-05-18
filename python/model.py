"""
競馬予想AIシステム - 機械学習モデルモジュール

LightGBMを用いた勝率予測モデルの学習・評価・推論。
ハイパーパラメータチューニング（Optuna）付き。
"""

from __future__ import annotations

import logging
import pickle
from typing import Optional

import numpy as np
import pandas as pd
import lightgbm as lgb
from sklearn.metrics import roc_auc_score
from sklearn.model_selection import StratifiedGroupKFold

from config import (
    LGBM_PARAMS,
    CV_FOLDS,
    RANDOM_SEED,
    MODEL_DIR,
    resolve_test_mask,
    ENABLE_EV_SAMPLE_WEIGHT,
    EV_WEIGHT_CENTER,
    EV_WEIGHT_TAU,
)

logger = logging.getLogger(__name__)

_EPS = 1e-9

# ============================================================
# 使用特徴量（学習・推論共通）
# speed_index は当該レース finish_time 由来のため恒久的除外
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
    # 脚質・上がり（speed_index はリークのため除外）
    "last_final3f", "avg_final3f",
    "avg_first_corner",
]


def calculate_ev_weight(
    ev: np.ndarray,
    center: float = EV_WEIGHT_CENTER,
    tau: float = EV_WEIGHT_TAU,
) -> np.ndarray:
    """
    理論期待値からシグモイド学習重みを算出する。

    weight = 1.0 + sigmoid((ev - center) / tau)  → 範囲 [1.0, 2.0]
    """
    ev = np.asarray(ev, dtype=float)
    sig = 1.0 / (1.0 + np.exp(-(ev - center) / tau))
    return 1.0 + sig


def _normalize_oof_per_race(oof_pred: pd.Series, race_id: pd.Series) -> pd.Series:
    """OOF予測確率を race_id 単位で合計1に正規化（ゼロ除算ガード付き）。"""
    frame = pd.DataFrame({"oof_pred": oof_pred, "race_id": race_id})

    def _norm_group(s: pd.Series) -> pd.Series:
        total = float(s.sum())
        if total < _EPS:
            return pd.Series(1.0 / len(s), index=s.index)
        return s / max(total, _EPS)

    return frame.groupby("race_id", sort=False)["oof_pred"].transform(_norm_group)


def _normalize_raw_weights_per_race(
    raw_weight: np.ndarray,
    race_id: pd.Series,
) -> np.ndarray:
    """raw_weight を race_id 単位で合計1に正規化。"""
    series = pd.Series(raw_weight, index=race_id.index)

    def _norm_group(s: pd.Series) -> pd.Series:
        total = float(s.sum())
        if total < _EPS:
            return pd.Series(1.0 / len(s), index=s.index)
        return s / max(total, _EPS)

    return series.groupby(race_id, sort=False).transform(_norm_group).to_numpy()


def compute_train_sample_weights(
    df_train: pd.DataFrame,
    oof_preds: np.ndarray,
    *,
    center: float = EV_WEIGHT_CENTER,
    tau: float = EV_WEIGHT_TAU,
) -> np.ndarray:
    """
    OOF予測と odds から学習用サンプル重みを算出する。

    1. race_id 単位で oof_pred を正規化
    2. 理論EV = oof_pred_norm * odds
    3. シグモイド重み（不正オッズは raw_weight=1.0）
    4. race_id 単位で weight 合計=1
    """
    if len(df_train) != len(oof_preds):
        raise ValueError(
            f"df_train と oof_preds の長さが一致しません: {len(df_train)} vs {len(oof_preds)}"
        )

    race_id = df_train["race_id"].reset_index(drop=True)
    odds = pd.to_numeric(df_train["odds"], errors="coerce").reset_index(drop=True)
    oof_series = pd.Series(oof_preds, index=race_id.index)

    oof_norm = _normalize_oof_per_race(oof_series, race_id)
    ev = oof_norm * odds

    valid_odds = odds.notna() & (odds > 0)
    raw_weight = np.ones(len(df_train), dtype=float)
    if valid_odds.any():
        raw_weight[valid_odds.to_numpy()] = calculate_ev_weight(
            ev[valid_odds].to_numpy(), center=center, tau=tau
        )

    weights = _normalize_raw_weights_per_race(raw_weight, race_id)

    n_ev_gt_1 = int((ev[valid_odds] > 1.0).sum()) if valid_odds.any() else 0
    logger.info(
        "EV sample weights: min=%.4f max=%.4f mean=%.4f | EV>1 rows=%d/%d (%.1f%%)",
        weights.min(),
        weights.max(),
        weights.mean(),
        n_ev_gt_1,
        len(df_train),
        100.0 * n_ev_gt_1 / max(len(df_train), 1),
    )
    return weights


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
        self.oof_auc_pass1_: Optional[float] = None
        self.ev_weight_meta_: dict = {}

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

        ENABLE_EV_SAMPLE_WEIGHT=True のとき:
          Pass1: 重みなしOOF → EV重み算出 → Pass2: 重み付きCV → 重み付き最終学習
        """
        feature_cols = feature_cols or self._available_features(df)
        logger.info("学習開始: %d rows, %d features", len(df), len(feature_cols))

        X = df[feature_cols].copy()
        y = df[target_col].copy()

        for col in X.columns:
            if X[col].dtype.name == "category":
                pass
            elif X[col].dtype == object:
                X[col] = X[col].astype("category")

        df_sorted = df.sort_values("race_date").reset_index(drop=True)
        X_sorted = X.loc[df_sorted.index]
        y_sorted = y.loc[df_sorted.index]
        groups = df_sorted["race_id"]

        test_mask, test_label = resolve_test_mask(df_sorted)
        X_train_all = X_sorted[~test_mask]
        y_train_all = y_sorted[~test_mask]
        X_test = X_sorted[test_mask]
        y_test = y_sorted[test_mask]
        groups_train = groups[~test_mask]
        df_train = df_sorted.loc[~test_mask].reset_index(drop=True)

        logger.info(
            "train: %d rows, test: %d rows (test_set=%s, ev_weights=%s)",
            len(X_train_all),
            len(X_test),
            test_label,
            ENABLE_EV_SAMPLE_WEIGHT,
        )

        gkf = StratifiedGroupKFold(
            n_splits=CV_FOLDS, shuffle=True, random_state=RANDOM_SEED
        )
        fold_splits = list(gkf.split(X_train_all, y_train_all, groups=groups_train))

        use_ev_weights = ENABLE_EV_SAMPLE_WEIGHT
        train_weight: np.ndarray | None = None

        if use_ev_weights:
            oof_preds = self._run_group_cv(
                X_train_all,
                y_train_all,
                fold_splits,
                sample_weight=None,
                pass_label="Pass1 (OOF)",
            )
            self.oof_auc_pass1_ = roc_auc_score(y_train_all, oof_preds)
            logger.info("Pass1 OOF AUC: %.4f", self.oof_auc_pass1_)

            train_weight = compute_train_sample_weights(
                df_train,
                oof_preds,
                center=EV_WEIGHT_CENTER,
                tau=EV_WEIGHT_TAU,
            )
            self.ev_weight_meta_ = {
                "enable_ev_sample_weight": True,
                "center": EV_WEIGHT_CENTER,
                "tau": EV_WEIGHT_TAU,
            }

            self.cv_scores_ = self._run_group_cv(
                X_train_all,
                y_train_all,
                fold_splits,
                sample_weight=train_weight,
                pass_label="Pass2 (weighted CV)",
                return_scores=True,
            )
            logger.info(
                "Pass2 mean fold AUC: %.4f (Pass1 OOF AUC: %.4f)",
                float(np.mean(self.cv_scores_)),
                self.oof_auc_pass1_ or float("nan"),
            )
        else:
            self.oof_auc_pass1_ = None
            self.ev_weight_meta_ = {"enable_ev_sample_weight": False}
            oof_preds = self._run_group_cv(
                X_train_all,
                y_train_all,
                fold_splits,
                sample_weight=None,
                pass_label="CV",
            )
            self.cv_scores_ = [
                roc_auc_score(y_train_all.iloc[val_idx], oof_preds[val_idx])
                for _, val_idx in fold_splits
            ]
            logger.info(
                "OOF AUC: %.4f (mean fold AUC: %.4f)",
                roc_auc_score(y_train_all, oof_preds),
                float(np.mean(self.cv_scores_)),
            )

        params = {**self.params}
        n_estimators = params.pop("n_estimators", 1000)
        params.pop("early_stopping_rounds", None)

        final_weight = train_weight if use_ev_weights else None
        train_set = lgb.Dataset(
            X_train_all,
            label=y_train_all,
            weight=final_weight,
        )
        self.booster = lgb.train(
            params,
            train_set,
            num_boost_round=int(n_estimators * 1.1),
        )

        self.feature_importances_ = pd.DataFrame({
            "feature": feature_cols,
            "importance": self.booster.feature_importance(importance_type="gain"),
        }).sort_values("importance", ascending=False).reset_index(drop=True)

        if len(X_test) > 0:
            test_preds = self.booster.predict(X_test)
            test_auc = roc_auc_score(y_test, test_preds)
            logger.info("Test AUC (test_set=%s): %.4f", test_label, test_auc)

        self.feature_cols_ = feature_cols
        return self

    def _run_group_cv(
        self,
        X_train_all: pd.DataFrame,
        y_train_all: pd.Series,
        fold_splits: list,
        *,
        sample_weight: np.ndarray | None,
        pass_label: str,
        return_scores: bool = False,
    ) -> list[float] | np.ndarray:
        """
        GroupKFold CV を1パス実行する。

        return_scores=True のとき各FoldのAUCリストを返す。
        それ以外は OOF 予測配列を返す。
        """
        oof_preds = np.zeros(len(X_train_all))
        scores: list[float] = []

        for fold, (tr_idx, val_idx) in enumerate(fold_splits):
            X_tr = X_train_all.iloc[tr_idx]
            X_val = X_train_all.iloc[val_idx]
            y_tr = y_train_all.iloc[tr_idx]
            y_val = y_train_all.iloc[val_idx]

            w_tr = None
            if sample_weight is not None:
                w_tr = sample_weight[tr_idx]

            params = {**self.params}
            n_estimators = params.pop("n_estimators", 1000)
            early_stopping_rounds = params.pop("early_stopping_rounds", 50)

            train_set = lgb.Dataset(X_tr, label=y_tr, weight=w_tr)
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
            if return_scores:
                fold_auc = roc_auc_score(y_val, val_preds)
                scores.append(fold_auc)
                logger.info("%s Fold %d AUC: %.4f", pass_label, fold + 1, fold_auc)
            else:
                oof_preds[val_idx] = val_preds
                fold_auc = roc_auc_score(y_val, val_preds)
                logger.info("%s Fold %d AUC: %.4f", pass_label, fold + 1, fold_auc)

        if return_scores:
            return scores
        return oof_preds

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
        EVサンプル重みは常に無効（探索のブレ防止）。

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

        for col in X.columns:
            if X[col].dtype == object:
                X[col] = X[col].astype("category")

        df_sorted = df.sort_values("race_date").reset_index(drop=True)
        X = X.loc[df_sorted.index]
        y = y.loc[df_sorted.index]
        test_mask, _ = resolve_test_mask(df_sorted)
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

        total = df["pred_prob"].sum()
        if total > 0:
            df["pred_prob_normalized"] = df["pred_prob"] / total
        else:
            df["pred_prob_normalized"] = 1 / len(df)

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
