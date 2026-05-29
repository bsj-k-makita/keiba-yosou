"""
競馬予想AIシステム - 特徴量エンジニアリングモジュール

データリークを防ぎながら以下の特徴量を生成する:
1. 馬の過去成績集計（勝率・連対率・平均着順）
2. 騎手・調教師の成績（勝率）
3. 条件別（距離・コース・馬場）の過去成績
4. 血統カテゴリ変数（父・母父）
5. 馬の得意な季節・月別成績
6. 脚質分類（逃げ・先行・差し・追込）
7. スピード指数・上がり3F比較
8. 馬齢・斤量・体重変動など基本情報
"""

from __future__ import annotations

import logging
from typing import Optional

import numpy as np
import pandas as pd

logger = logging.getLogger(__name__)

_RACE_CLASS_TIER_MAP = {
    "未勝利": 0.0,
    "新馬": 0.0,
    "1勝クラス": 1.0,
    "2勝クラス": 2.0,
    "3勝クラス": 3.0,
    "OP": 4.0,
    "L": 5.0,
    "G3": 6.0,
    "G2": 7.0,
    "G1": 8.0,
}

_FINAL3F_Z_EPS = 1e-6


class FeatureEngineer:
    """
    マスターDataFrameに特徴量を追加するクラス。

    全ての集計処理でデータリーク（未来情報の混入）を防ぐため、
    "その日より前の成績"のみを使う shift + expanding/rolling パターンを採用する。
    """

    def __init__(self, horse_results_df: pd.DataFrame):
        """
        Args:
            horse_results_df: DataProcessor.clean_horse_results() の結果
        """
        self.horse_results = horse_results_df.copy()
        self.horse_results["race_date"] = pd.to_datetime(
            self.horse_results["race_date"], errors="coerce"
        )
        self.horse_results = self.horse_results.sort_values(
            ["horse_id", "race_date"]
        ).reset_index(drop=True)

    # ----------------------------------------------------------
    # パブリック: 全特徴量を追加する
    # ----------------------------------------------------------
    def transform(self, df: pd.DataFrame) -> pd.DataFrame:
        """
        マスターDataFrameに全特徴量を追加して返す。

        Args:
            df: DataProcessor.build_master_df() の結果
        Returns:
            特徴量追加済みDataFrame
        """
        df = df.copy()
        df["race_date"] = pd.to_datetime(df["race_date"], errors="coerce")

        logger.info("特徴量生成開始: %d rows", len(df))

        df = self._add_horse_stats(df)
        df = self._add_jockey_stats(df)
        df = self._add_trainer_stats(df)
        df = self._add_condition_specific_stats(df)
        df = self._add_seasonal_stats(df)
        df = self._add_running_style(df)
        df = self._add_speed_index(df)
        df = self._add_basic_features(df)
        df = self._add_outcome_context(df)
        df = self.add_interactions(df)

        logger.info("特徴量生成完了: %d cols", df.shape[1])
        return df

    # ----------------------------------------------------------
    # 交差特徴量・Pass2高度重み
    # ----------------------------------------------------------
    @staticmethod
    def compute_margin_sec_series(df: pd.DataFrame) -> pd.Series:
        """
        レース内1着タイムとの差（秒）。1着は 0、欠損は NaN。
        学習サンプル重み用（当該レースの結果）。推論特徴量には使わない。
        """
        if "race_id" not in df.columns:
            return pd.Series(np.nan, index=df.index, dtype=float)

        time_sec = None
        if "finish_time_sec" in df.columns:
            time_sec = pd.to_numeric(df["finish_time_sec"], errors="coerce")
        elif "time_sec" in df.columns:
            time_sec = pd.to_numeric(df["time_sec"], errors="coerce")

        finish_pos = pd.to_numeric(
            df.get("finish_pos", pd.Series(np.nan, index=df.index)),
            errors="coerce",
        )

        if time_sec is not None and time_sec.notna().any():
            winner_time = time_sec.groupby(df["race_id"]).transform("min")
            margin = (time_sec - winner_time).clip(lower=0.0)
            margin = margin.where(finish_pos != 1, 0.0)
            return margin

        if finish_pos is not None:
            return finish_pos.where(finish_pos == 1, 1.0).astype(float)

        return pd.Series(np.nan, index=df.index, dtype=float)

    @staticmethod
    def _parse_margin_to_sec(margin: object) -> float | None:
        """netkeiba 着差文字列をおおよそ秒に変換（解析不能は None）。"""
        if pd.isna(margin):
            return None
        text = str(margin).strip()
        if not text or text in ("-", "同", "同着"):
            return 0.0
        try:
            return float(text)
        except ValueError:
            pass
        import re

        m = re.match(r"^(\d+(?:\.\d+)?)", text)
        if m:
            return float(m.group(1)) * 0.2
        return None

    def _add_outcome_context(self, df: pd.DataFrame) -> pd.DataFrame:
        """
        Pass2 高度重み用の文脈列（margin_sec / class_tier）。
        margin_sec は学習時の結果由来。推論時は欠損のまま重み補正に影響しない。
        """
        df = df.copy()
        race_class = df.get("race_class", pd.Series("", index=df.index)).astype(str)
        if "graded_race_tier" in df.columns:
            df["class_tier"] = pd.to_numeric(df["graded_race_tier"], errors="coerce").fillna(0.0)
        else:
            df["class_tier"] = race_class.map(_RACE_CLASS_TIER_MAP).fillna(0.0)
        df["margin_sec"] = self.compute_margin_sec_series(df)
        return df

    def add_interactions(self, df: pd.DataFrame) -> pd.DataFrame:
        """
        クラス格×パフォーマンス安定度の交差特徴量（リーク回避: 前走着差のみ使用）。
        """
        df = df.copy()
        class_tier = pd.to_numeric(
            df.get("class_tier", df.get("graded_race_tier", 0.0)),
            errors="coerce",
        ).fillna(0.0)

        if "horse_last_margin" in df.columns:
            hist_margin = df["horse_last_margin"].map(self._parse_margin_to_sec)
            margin_hist = hist_margin.fillna(1.0)
        else:
            margin_hist = pd.Series(1.0, index=df.index)

        top3_col = "horse_top3_rate" if "horse_top3_rate" in df.columns else "top3_rate"
        if top3_col in df.columns:
            top3_rate = pd.to_numeric(df[top3_col], errors="coerce").fillna(0.0)
        elif "horse_win_rate" in df.columns:
            top3_rate = pd.to_numeric(df["horse_win_rate"], errors="coerce").fillna(0.0) * 1.5
        else:
            top3_rate = pd.Series(0.0, index=df.index)

        graded = pd.to_numeric(df.get("graded_race_tier", 0.0), errors="coerce").fillna(0.0)
        df["inter_class_margin"] = class_tier * margin_hist
        df["inter_graded_top3"] = graded * top3_rate
        return df

    @staticmethod
    def calculate_advanced_weights(
        df: pd.DataFrame,
        base_weights: np.ndarray,
        *,
        graded_buff_win: float = 1.5,
        graded_buff_close: float = 1.3,
        flock_debuff: float = 0.7,
        flock_debuff_slow: float = 0.6,
        flock_odds_min: float = 50.0,
        class_tier_max: float = 3.0,
        graded_min_tier: float = 6.0,
        close_margin_sec: float = 0.2,
    ) -> np.ndarray:
        """
        Pass2 シグモイド重みに実力馬バフ / フロックデバフのマルチプライヤーを適用する。
        """
        adjusted = np.asarray(base_weights, dtype=float).copy()
        n = len(df)
        if n == 0:
            return adjusted
        if len(adjusted) != n:
            raise ValueError(
                f"base_weights length {len(adjusted)} != df rows {n}"
            )

        if "margin_sec" in df.columns:
            margin_sec = pd.to_numeric(df["margin_sec"], errors="coerce").fillna(99.0).to_numpy()
        else:
            margin_sec = np.full(n, 99.0, dtype=float)

        win_odds = np.ones(n, dtype=float)
        for col in ("win_odds", "odds"):
            if col in df.columns:
                win_odds = pd.to_numeric(df[col], errors="coerce").fillna(1.0).to_numpy()
                break

        if "graded_race_tier" in df.columns:
            graded_src = df["graded_race_tier"]
        elif "class_tier" in df.columns:
            graded_src = df["class_tier"]
        else:
            graded_src = pd.Series(0.0, index=df.index)
        graded_tier = pd.to_numeric(graded_src, errors="coerce").fillna(0.0).to_numpy()

        if "class_tier" in df.columns:
            class_tier = pd.to_numeric(df["class_tier"], errors="coerce").fillna(0.0).to_numpy()
        else:
            class_tier = graded_tier.copy()
        pace_is_slow = (
            df["pace_is_slow"].to_numpy()
            if "pace_is_slow" in df.columns
            else np.zeros(n, dtype=int)
        )

        for idx in range(n):
            multiplier = 1.0
            if graded_tier[idx] >= graded_min_tier:
                if margin_sec[idx] <= 0.0:
                    multiplier = graded_buff_win
                elif margin_sec[idx] <= close_margin_sec:
                    multiplier = graded_buff_close
            elif class_tier[idx] <= class_tier_max:
                if margin_sec[idx] <= 0.0 and win_odds[idx] >= flock_odds_min:
                    multiplier = flock_debuff
                    if pace_is_slow[idx] == 1:
                        multiplier = flock_debuff_slow
            adjusted[idx] *= multiplier

        return adjusted

    # ----------------------------------------------------------
    # 1. 馬の過去成績集計
    # ----------------------------------------------------------
    def _add_horse_stats(self, df: pd.DataFrame) -> pd.DataFrame:
        """
        各レース時点での馬の過去全成績集計を追加する。

        追加特徴量:
        - horse_win_rate: 勝率（1着率）
        - horse_top2_rate: 連対率（1-2着率）
        - horse_top3_rate: 複勝率（1-3着率）
        - horse_avg_finish: 平均着順
        - horse_race_count: 過去レース数
        - horse_last_finish: 前走着順
        - horse_last_margin: 前走タイム差
        - horse_recent3_avg: 直近3走平均着順
        - horse_days_since_last: 前走からの日数
        """
        hr = self.horse_results[
            ["horse_id", "race_date", "finish_pos", "margin", "horse_count"]
        ].copy()

        # 馬ごとに時系列ソート済みで累積集計（shift(1)でデータリーク防止）
        hr = hr.sort_values(["horse_id", "race_date"])
        gb = hr.groupby("horse_id", sort=False)

        hr["horse_race_count"] = gb["finish_pos"].transform(
            lambda s: s.shift(1).expanding().count()
        )
        hr["horse_win_rate"] = gb["finish_pos"].transform(
            lambda s: s.shift(1).eq(1).expanding().mean()
        )
        hr["horse_top2_rate"] = gb["finish_pos"].transform(
            lambda s: s.shift(1).le(2).expanding().mean()
        )
        hr["horse_top3_rate"] = gb["finish_pos"].transform(
            lambda s: s.shift(1).le(3).expanding().mean()
        )
        hr["horse_avg_finish"] = gb["finish_pos"].transform(
            lambda s: s.shift(1).expanding().mean()
        )
        hr["horse_last_finish"] = gb["finish_pos"].shift(1)
        hr["horse_last_margin"] = gb["margin"].shift(1)
        hr["horse_recent3_avg"] = gb["finish_pos"].transform(
            lambda s: s.shift(1).rolling(3, min_periods=1).mean()
        )
        hr["horse_days_since_last"] = gb["race_date"].transform(
            lambda s: s.diff().dt.days
        )

        stats = hr[
            ["horse_id", "race_date", "horse_race_count", "horse_win_rate",
             "horse_top2_rate", "horse_top3_rate", "horse_avg_finish",
             "horse_last_finish", "horse_last_margin", "horse_recent3_avg",
             "horse_days_since_last"]
        ]

        df = df.merge(stats, on=["horse_id", "race_date"], how="left")

        # 欠損補完（初出走など）
        df["horse_race_count"] = df["horse_race_count"].fillna(0)
        df["horse_win_rate"] = df["horse_win_rate"].fillna(0)
        df["horse_top2_rate"] = df["horse_top2_rate"].fillna(0)
        df["horse_top3_rate"] = df["horse_top3_rate"].fillna(0)
        df["horse_avg_finish"] = df["horse_avg_finish"].fillna(
            df["horse_count"].fillna(10)
        )
        df["horse_last_finish"] = df["horse_last_finish"].fillna(-1)
        df["horse_days_since_last"] = df["horse_days_since_last"].fillna(999)

        return df

    # ----------------------------------------------------------
    # 2. 騎手の過去成績集計
    # ----------------------------------------------------------
    def _add_jockey_stats(self, df: pd.DataFrame) -> pd.DataFrame:
        """
        騎手の通算・コース別勝率を追加する。

        追加特徴量:
        - jockey_win_rate: 騎手通算勝率
        - jockey_top3_rate: 騎手通算複勝率
        - jockey_venue_win_rate: 騎手×場所の勝率
        """
        if "jockey_id" not in df.columns:
            return df

        df = df.sort_values(["jockey_id", "race_date"])
        jgb = df.groupby("jockey_id", sort=False)
        # merge しない（同一日・同一騎手の複数頭で行が爆発するため）
        df["jockey_win_rate"] = jgb["finish_pos"].transform(
            lambda s: s.shift(1).eq(1).expanding().mean()
        )
        df["jockey_top3_rate"] = jgb["finish_pos"].transform(
            lambda s: s.shift(1).le(3).expanding().mean()
        )

        # 騎手×場所 勝率（全期間平均、推論時も利用可）
        venue_win = (
            df.groupby(["jockey_id", "venue"])["finish_pos"]
            .apply(lambda x: (x == 1).mean())
            .reset_index()
            .rename(columns={"finish_pos": "jockey_venue_win_rate"})
        )
        df = df.merge(venue_win, on=["jockey_id", "venue"], how="left")

        df["jockey_win_rate"] = df["jockey_win_rate"].fillna(
            df["jockey_win_rate"].median()
        )
        df["jockey_top3_rate"] = df["jockey_top3_rate"].fillna(
            df["jockey_top3_rate"].median()
        )
        df["jockey_venue_win_rate"] = df["jockey_venue_win_rate"].fillna(0)

        return df

    # ----------------------------------------------------------
    # 3. 調教師の過去成績集計
    # ----------------------------------------------------------
    def _add_trainer_stats(self, df: pd.DataFrame) -> pd.DataFrame:
        """
        調教師の通算勝率を追加する。

        追加特徴量:
        - trainer_win_rate: 調教師通算勝率
        - trainer_top3_rate: 調教師通算複勝率
        """
        if "trainer_id" not in df.columns:
            return df

        df = df.sort_values(["trainer_id", "race_date"])
        tgb = df.groupby("trainer_id", sort=False)
        df["trainer_win_rate"] = tgb["finish_pos"].transform(
            lambda s: s.shift(1).eq(1).expanding().mean()
        )
        df["trainer_top3_rate"] = tgb["finish_pos"].transform(
            lambda s: s.shift(1).le(3).expanding().mean()
        )
        df["trainer_win_rate"] = df["trainer_win_rate"].fillna(
            df["trainer_win_rate"].median()
        )
        df["trainer_top3_rate"] = df["trainer_top3_rate"].fillna(
            df["trainer_top3_rate"].median()
        )
        return df

    # ----------------------------------------------------------
    # 4. 条件別（距離・コース・馬場）の過去成績
    # ----------------------------------------------------------
    def _add_condition_specific_stats(self, df: pd.DataFrame) -> pd.DataFrame:
        """
        馬の特定条件下での過去成績を追加する（データリーク防止）。

        追加特徴量:
        - horse_same_distance_win_rate: 同距離勝率
        - horse_same_surface_win_rate: 同コース種別勝率
        - horse_same_ground_win_rate: 同馬場状態勝率
        - horse_same_venue_win_rate: 同競馬場勝率
        """
        hr = self.horse_results[
            ["horse_id", "race_date", "finish_pos",
             "distance", "surface", "ground_state", "venue"]
        ].copy()
        hr["race_date"] = pd.to_datetime(hr["race_date"], errors="coerce")

        # 距離カテゴリ（短距離/マイル/中距離/長距離）
        hr["distance_cat"] = pd.cut(
            hr["distance"],
            bins=[0, 1400, 1800, 2200, 9999],
            labels=["短距離", "マイル", "中距離", "長距離"],
        ).astype(str)
        df["distance_cat"] = pd.cut(
            df["distance"],
            bins=[0, 1400, 1800, 2200, 9999],
            labels=["短距離", "マイル", "中距離", "長距離"],
        ).astype(str)

        for cond_col, feat_name in [
            ("distance_cat", "horse_same_distance_win_rate"),
            ("surface", "horse_same_surface_win_rate"),
            ("ground_state", "horse_same_ground_win_rate"),
            ("venue", "horse_same_venue_win_rate"),
        ]:
            cond_stats = self._expanding_win_rate_by_condition(
                hr, cond_col=cond_col, out_col=feat_name
            )
            # race_dateが重複しやすいのでhorse_id + race_date + cond_colでmerge
            merge_keys = ["horse_id", "race_date", cond_col]
            # dfのcond_col列確認
            if cond_col not in df.columns:
                continue
            df = df.merge(
                cond_stats[[*merge_keys, feat_name]],
                on=merge_keys,
                how="left",
            )
            df[feat_name] = df[feat_name].fillna(0)

        return df

    def _expanding_win_rate_by_condition(
        self,
        hr: pd.DataFrame,
        cond_col: str,
        out_col: str,
    ) -> pd.DataFrame:
        """
        条件ごとに expanding 勝率を計算する（データリーク防止）。
        """
        hr = hr.copy().sort_values(["horse_id", cond_col, "race_date"])
        hr[out_col] = hr.groupby(["horse_id", cond_col], sort=False)["finish_pos"].transform(
            lambda s: s.shift(1).eq(1).expanding().mean()
        )
        return hr

    # ----------------------------------------------------------
    # 5. 季節・月別の過去成績
    # ----------------------------------------------------------
    def _add_seasonal_stats(self, df: pd.DataFrame) -> pd.DataFrame:
        """
        馬の季節・月別成績を追加する。

        追加特徴量:
        - horse_month_win_rate: 同月での勝率
        - horse_season_win_rate: 同季節での勝率（春夏秋冬）
        """
        hr = self.horse_results[
            ["horse_id", "race_date", "finish_pos"]
        ].copy()
        hr["race_date"] = pd.to_datetime(hr["race_date"], errors="coerce")
        hr["month"] = hr["race_date"].dt.month
        hr["season"] = hr["month"].map(self._month_to_season)

        df["month"] = df["race_date"].dt.month
        df["season"] = df["month"].map(self._month_to_season)

        for cond_col, feat_name in [
            ("month", "horse_month_win_rate"),
            ("season", "horse_season_win_rate"),
        ]:
            cond_stats = self._expanding_win_rate_by_condition(
                hr, cond_col=cond_col, out_col=feat_name
            )
            df = df.merge(
                cond_stats[["horse_id", "race_date", cond_col, feat_name]],
                on=["horse_id", "race_date", cond_col],
                how="left",
            )
            df[feat_name] = df[feat_name].fillna(0)

        return df

    @staticmethod
    def _month_to_season(month: int) -> str:
        if month in [3, 4, 5]:
            return "春"
        elif month in [6, 7, 8]:
            return "夏"
        elif month in [9, 10, 11]:
            return "秋"
        else:
            return "冬"

    # ----------------------------------------------------------
    # 6. 脚質分類
    # ----------------------------------------------------------
    def _add_running_style(self, df: pd.DataFrame) -> pd.DataFrame:
        """
        過去成績の通過順位から脚質を分類する。

        passage_rankは "2-2-3-3" 形式の通過順位文字列。
        最初のコーナー通過順位の平均から脚質を判定する。

        分類:
        - 逃げ: 平均1着通過
        - 先行: 平均2-3着通過
        - 差し: 平均4-6着通過
        - 追込: 平均7着以上通過
        """
        hr = self.horse_results[
            ["horse_id", "race_date", "passage_rank", "horse_count"]
        ].copy()
        hr["race_date"] = pd.to_datetime(hr["race_date"], errors="coerce")

        # passage_rankから第1コーナー通過順位を抽出
        hr["first_corner_rank"] = hr["passage_rank"].apply(
            self._extract_first_corner_rank
        )

        # 過去全走の第1コーナー平均
        hr = hr.sort_values(["horse_id", "race_date"])
        hr["avg_first_corner"] = hr.groupby("horse_id", sort=False)[
            "first_corner_rank"
        ].transform(lambda s: s.shift(1).expanding().mean())
        style_df = hr[["horse_id", "race_date", "avg_first_corner"]]

        df = df.merge(style_df, on=["horse_id", "race_date"], how="left")

        # 脚質分類
        df["running_style"] = df["avg_first_corner"].apply(
            self._classify_running_style
        )
        df["running_style"] = df["running_style"].fillna("自在")
        df["avg_first_corner"] = df["avg_first_corner"].fillna(
            df["horse_count"].fillna(10) / 2
        )

        return df

    @staticmethod
    def _extract_first_corner_rank(passage_rank: str) -> Optional[float]:
        """'2-2-3-3' → 2.0"""
        if pd.isna(passage_rank) or str(passage_rank).strip() == "":
            return None
        parts = str(passage_rank).strip().split("-")
        try:
            return float(parts[0])
        except (ValueError, IndexError):
            return None

    @staticmethod
    def _classify_running_style(avg_rank: Optional[float]) -> str:
        if avg_rank is None or pd.isna(avg_rank):
            return "自在"
        if avg_rank <= 1.5:
            return "逃げ"
        elif avg_rank <= 3.5:
            return "先行"
        elif avg_rank <= 6.5:
            return "差し"
        else:
            return "追込"

    @staticmethod
    def _distance_cat_series(distance: pd.Series) -> pd.Series:
        return pd.cut(
            pd.to_numeric(distance, errors="coerce"),
            bins=[0, 1400, 1800, 2200, 9999],
            labels=["短距離", "マイル", "中距離", "長距離"],
        ).astype(str)

    # ----------------------------------------------------------
    # 7. スピード指数・上がり3F
    # ----------------------------------------------------------
    def _add_speed_index(self, df: pd.DataFrame) -> pd.DataFrame:
        """
        レース内スピード指数と、前走上がり3Fの相対化特徴量を追加する。

        追加特徴量:
        - speed_index: レース内偏差値（finish_time_sec がある場合のみ）
        - last_final3f / avg_final3f: 前走・過去平均の上がり3F（秒）
        - final3f_rank: 同レース出走馬内での前走上がり3F順位（1=最速）
        - last_final3f_z: 前走の馬場×距離帯ごとの標準化上がり3F
        """
        if "finish_time_sec" in df.columns:
            df["speed_index"] = df.groupby("race_id")["finish_time_sec"].transform(
                lambda x: (x.mean() - x) / (x.std() + 1e-6) * 10 + 50
            )

        if "final_3f" not in self.horse_results.columns:
            return df

        hr_cols = [
            "horse_id",
            "race_date",
            "final_3f",
            "surface",
            "ground_state",
            "distance",
            "venue",
            "race_number",
        ]
        hr_speed = self.horse_results[
            [c for c in hr_cols if c in self.horse_results.columns]
        ].copy()
        hr_speed["race_date"] = pd.to_datetime(hr_speed["race_date"], errors="coerce")
        hr_speed["final_3f"] = pd.to_numeric(hr_speed["final_3f"], errors="coerce")
        hr_speed = hr_speed[hr_speed["final_3f"].notna() & (hr_speed["final_3f"] > 0)]

        if hr_speed.empty:
            return df

        if "distance" in hr_speed.columns:
            hr_speed["distance_cat"] = self._distance_cat_series(hr_speed["distance"])
        else:
            hr_speed["distance_cat"] = "中距離"

        for col in ("surface", "ground_state", "venue"):
            if col not in hr_speed.columns:
                hr_speed[col] = "不明"
            hr_speed[col] = hr_speed[col].fillna("不明").astype(str)
        if "race_number" not in hr_speed.columns:
            hr_speed["race_number"] = 0

        ref = hr_speed.dropna(subset=["final_3f"])
        group_stats = (
            ref.groupby(["surface", "ground_state", "distance_cat"], observed=True)[
                "final_3f"
            ]
            .agg(mean="mean", std="std")
            .reset_index()
        )
        group_stats["std"] = group_stats["std"].fillna(0).replace(0, np.nan)

        hr_speed = hr_speed.sort_values(["horse_id", "race_date"])
        sgb = hr_speed.groupby("horse_id", sort=False)
        hr_speed["avg_final3f"] = sgb["final_3f"].transform(
            lambda s: s.shift(1).expanding().mean()
        )

        # 前走行: shift(1) 後の行（当該レース直前の出走）を merge_asof で master に接続
        prev_run = hr_speed.copy()
        prev_run["last_final3f"] = sgb["final_3f"].shift(1)
        prev_run["prev_surface"] = sgb["surface"].shift(1)
        prev_run["prev_ground"] = sgb["ground_state"].shift(1)
        prev_run["prev_distance_cat"] = sgb["distance_cat"].shift(1)
        prev_run = prev_run.dropna(subset=["last_final3f"])
        prev_run = prev_run.merge(
            group_stats,
            left_on=["prev_surface", "prev_ground", "prev_distance_cat"],
            right_on=["surface", "ground_state", "distance_cat"],
            how="left",
        )
        std_safe = prev_run["std"].fillna(prev_run["mean"] * 0.05 + _FINAL3F_Z_EPS)
        prev_run["last_final3f_z"] = (
            prev_run["last_final3f"] - prev_run["mean"]
        ) / (std_safe + _FINAL3F_Z_EPS)

        asof_cols = [
            "horse_id",
            "race_date",
            "last_final3f",
            "avg_final3f",
            "last_final3f_z",
        ]
        prev_for_asof = prev_run[asof_cols].dropna(subset=["race_date"]).sort_values(["race_date", "horse_id"])

        # merge_asof は key 列の NaT を許容しないため、左辺も非NaTのみで実行して戻す
        df_base = df.copy()
        df_sorted = df_base.sort_values(["race_date", "horse_id"])
        valid_left = df_sorted[df_sorted["race_date"].notna()].copy()
        invalid_left = df_sorted[df_sorted["race_date"].isna()].copy()

        if not valid_left.empty and not prev_for_asof.empty:
            valid_left = pd.merge_asof(
                valid_left,
                prev_for_asof,
                on="race_date",
                by="horse_id",
                direction="backward",
            )
        else:
            for col in ("last_final3f", "avg_final3f", "last_final3f_z"):
                if col not in valid_left.columns:
                    valid_left[col] = np.nan

        merged = pd.concat([valid_left, invalid_left], axis=0).sort_index()
        df = merged

        if "race_id" in df.columns:
            df["final3f_rank"] = df.groupby("race_id", sort=False)["last_final3f"].rank(
                method="min",
                ascending=True,
            )
        else:
            df["final3f_rank"] = np.nan

        med_f3f = (
            float(df["last_final3f"].median())
            if df["last_final3f"].notna().any()
            else 35.0
        )
        med_avg = (
            float(df["avg_final3f"].median()) if df["avg_final3f"].notna().any() else 35.0
        )
        med_rank = (
            float(df["final3f_rank"].median())
            if df["final3f_rank"].notna().any()
            else float(df["horse_count"].median())
            if "horse_count" in df.columns and df["horse_count"].notna().any()
            else 8.0
        )
        df["last_final3f"] = df["last_final3f"].fillna(med_f3f)
        df["avg_final3f"] = df["avg_final3f"].fillna(med_avg)
        df["final3f_rank"] = df["final3f_rank"].fillna(med_rank)
        df["last_final3f_z"] = df["last_final3f_z"].fillna(0.0)

        return df

    # ----------------------------------------------------------
    # 8. 基本特徴量の追加・整形
    # ----------------------------------------------------------
    def _add_basic_features(self, df: pd.DataFrame) -> pd.DataFrame:
        """
        基本情報から派生特徴量を追加する。

        追加特徴量:
        - year, month, day_of_week: 日付分解
        - horse_age_group: 馬齢グループ（2-3歳/4-5歳/6歳以上）
        - weight_carried_diff_from_avg: 平均斤量との差
        - is_outside_frame: 外枠かどうか（7-8枠）
        - is_inner_frame: 内枠かどうか（1-2枠）
        - log_odds: オッズの対数（正規化）
        - popularity_ratio: 人気÷頭数（相対人気）
        """
        df = df.copy()

        if "race_date" in df.columns:
            df["year"] = df["race_date"].dt.year
            df["day_of_week"] = df["race_date"].dt.dayofweek

        if "age" in df.columns:
            df["horse_age_group"] = pd.cut(
                df["age"],
                bins=[0, 3, 5, 99],
                labels=["2-3歳", "4-5歳", "6歳以上"],
            ).astype(str)

        if "weight_carried" in df.columns:
            avg_wc = df.groupby("race_id")["weight_carried"].transform("mean")
            df["weight_carried_diff_from_avg"] = df["weight_carried"] - avg_wc

        if "frame_number" in df.columns:
            df["is_outer_frame"] = (df["frame_number"] >= 7).astype(int)
            df["is_inner_frame"] = (df["frame_number"] <= 2).astype(int)

        if "odds" in df.columns:
            df["log_odds"] = np.log1p(df["odds"])

        if "popularity" in df.columns and "horse_count" in df.columns:
            df["popularity_ratio"] = df["popularity"] / df["horse_count"].replace(0, 1)

        # クラスの段階を数値化（G1/G2文脈の識別用）
        race_class = df.get("race_class", pd.Series("", index=df.index)).astype(str)
        df["graded_race_tier"] = race_class.map(_RACE_CLASS_TIER_MAP).fillna(0.0).astype(float)
        df["is_g1"] = race_class.eq("G1").astype(float)

        # G1限定で上がり相対値を独立学習できる交差特徴量
        last_f3f_z = pd.to_numeric(
            df.get("last_final3f_z", pd.Series(0.0, index=df.index)),
            errors="coerce",
        ).fillna(0.0)
        f3f_rank = pd.to_numeric(
            df.get("final3f_rank", pd.Series(0.0, index=df.index)),
            errors="coerce",
        ).fillna(0.0)
        df["g1_last_final3f_z"] = df["is_g1"] * last_f3f_z
        df["g1_final3f_rank"] = df["is_g1"] * f3f_rank

        # 前走近傍フォームをクラス文脈で補正（同じ着順でも重賞実績を相対的に高評価）
        recent3 = pd.to_numeric(
            df.get("horse_recent3_avg", pd.Series(np.nan, index=df.index)),
            errors="coerce",
        ).fillna(8.0)
        recent3_score = (1.0 - ((recent3 - 1.0) / 17.0)).clip(0.0, 1.0)
        base_score = df["graded_race_tier"] * recent3_score
        grp_mean = base_score.groupby(df["race_id"]).transform("mean")
        grp_std = base_score.groupby(df["race_id"]).transform("std").replace(0, np.nan)
        df["class_adjusted_score"] = ((base_score - grp_mean) / grp_std).fillna(0.0)

        return df

    # ----------------------------------------------------------
    # 目的変数の生成
    # ----------------------------------------------------------
    @staticmethod
    def make_target(df: pd.DataFrame, target: str = "win") -> pd.Series:
        """
        目的変数を生成する。

        Args:
            df: マスターDataFrame
            target: "win"（単勝）/ "top3"（複勝）/ "win_mod"（実質同着を1着扱い）

        Returns:
            0/1のSeries
        """
        if target == "win":
            return (df["finish_pos"] == 1).astype(int)
        if target == "win_mod":
            return FeatureEngineer.make_target_mod(df)
        if target == "top3":
            return (df["finish_pos"] <= 3).astype(int)
        raise ValueError(f"Unknown target: {target}")

    @staticmethod
    def make_target_mod(df: pd.DataFrame) -> pd.Series:
        """
        実質同着対応: 1着、または1着とのタイム差が0（同着）の馬を正例とする。
        `time` 列（秒）または `margin_to_winner_sec` が利用可能な場合に適用。
        """
        base = (df["finish_pos"] == 1).astype(int)
        if "race_id" not in df.columns:
            return base

        out = base.copy()
        time_sec = None
        if "time_sec" in df.columns:
            time_sec = pd.to_numeric(df["time_sec"], errors="coerce")
        elif "time" in df.columns:
            time_sec = df["time"].map(FeatureEngineer._time_to_sec_static)

        if time_sec is not None:
            for race_id, grp in df.groupby("race_id"):
                idx = grp.index
                times = time_sec.loc[idx]
                winner_time = times[grp["finish_pos"] == 1].min()
                if pd.isna(winner_time):
                    continue
                dead_heat = (times - winner_time).abs() <= 1e-6
                out.loc[idx] = (out.loc[idx] | dead_heat.astype(int)).astype(int)
            return out

        if "margin_to_winner_sec" in df.columns:
            margin = pd.to_numeric(df["margin_to_winner_sec"], errors="coerce")
            dead_heat = margin.fillna(999) <= 1e-6
            return (base | dead_heat.astype(int)).astype(int)

        return base

    @staticmethod
    def _time_to_sec_static(time_str: object) -> float | None:
        if pd.isna(time_str) or str(time_str).strip() == "":
            return None
        import re

        m = re.match(r"(\d+):(\d+\.\d+)", str(time_str).strip())
        if m:
            return int(m.group(1)) * 60 + float(m.group(2))
        try:
            return float(time_str)
        except (TypeError, ValueError):
            return None
