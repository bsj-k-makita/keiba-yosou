"""
競馬予想AIシステム - データ前処理モジュール
DBから生データを読み込み、学習用DataFrameに整形する
"""

import re
import logging
import sqlite3
from typing import Optional

import numpy as np
import pandas as pd
from sklearn.preprocessing import LabelEncoder

from config import DB_PATH, CATEGORICAL_COLS

logger = logging.getLogger(__name__)


class DataProcessor:
    """
    生データの読み込み・クレンジング・基本変換を行うクラス。

    - SQLiteから各テーブルを読み込む
    - 欠損値処理・型変換
    - 不要文字の除去
    - カテゴリ変数のLabel Encoding
    - 学習・推論の両方で同じ変換を再現できるようにエンコーダを保持する
    """

    def __init__(self, db_path: str = str(DB_PATH)):
        self.db_path = db_path
        self.label_encoders: dict[str, LabelEncoder] = {}

    # ----------------------------------------------------------
    # データ読み込み
    # ----------------------------------------------------------
    def load_race_results(self) -> pd.DataFrame:
        """race_results + race_info を結合したDataFrameを返す"""
        with sqlite3.connect(self.db_path) as conn:
            df = pd.read_sql(
                """
                SELECT
                    rr.*,
                    ri.race_date,
                    ri.venue,
                    ri.race_name,
                    ri.surface,
                    ri.distance,
                    ri.weather,
                    ri.ground_state,
                    ri.horse_count,
                    ri.race_class,
                    ri.around
                FROM race_results rr
                JOIN race_info ri ON rr.race_id = ri.race_id
                ORDER BY ri.race_date, rr.race_id, rr.horse_number
                """,
                conn,
                parse_dates=["race_date"],
            )
        logger.info("race_results loaded: %d rows", len(df))
        return df

    def load_horse_results(self) -> pd.DataFrame:
        """horse_results テーブルを返す"""
        with sqlite3.connect(self.db_path) as conn:
            df = pd.read_sql(
                "SELECT * FROM horse_results ORDER BY horse_id, race_date",
                conn,
            )
        logger.info("horse_results loaded: %d rows", len(df))
        return df

    def load_pedigree(self) -> pd.DataFrame:
        """pedigree テーブルを返す"""
        with sqlite3.connect(self.db_path) as conn:
            df = pd.read_sql("SELECT * FROM pedigree", conn)
        logger.info("pedigree loaded: %d rows", len(df))
        return df

    # ----------------------------------------------------------
    # クレンジング
    # ----------------------------------------------------------
    def clean_race_results(self, df: pd.DataFrame) -> pd.DataFrame:
        """
        レース結果DataFrameの基本クレンジングを行う。

        - 着順が数値でない行（取消・除外）を除去
        - race_date を datetime型に統一
        - 数値列の型変換
        - 欠損値の補完
        """
        df = df.copy()

        # 着順を整数変換。変換できない行（"取消"など）は除去
        df["finish_pos"] = pd.to_numeric(df["finish_pos"], errors="coerce")
        df = df.dropna(subset=["finish_pos"]).copy()
        df["finish_pos"] = df["finish_pos"].astype(int)

        # race_date
        if not pd.api.types.is_datetime64_any_dtype(df["race_date"]):
            df["race_date"] = pd.to_datetime(df["race_date"], errors="coerce")

        # 数値列
        for col in ["age", "weight_carried", "body_weight", "body_weight_diff",
                    "odds", "popularity", "distance", "horse_count",
                    "frame_number", "horse_number"]:
            if col in df.columns:
                df[col] = pd.to_numeric(df[col], errors="coerce")

        # 欠損補完
        df["body_weight_diff"] = df["body_weight_diff"].fillna(0)
        df["body_weight"] = df["body_weight"].fillna(df["body_weight"].median())
        df["odds"] = df["odds"].fillna(df["odds"].median())

        # 性別正規化（"牡" / "牝" / "セ"）
        if "sex" in df.columns:
            df["sex"] = df["sex"].str.strip().fillna("不明")

        # surface正規化
        if "surface" in df.columns:
            df["surface"] = df["surface"].str.replace(r"[左右内外]", "", regex=True).str.strip()
            df["surface"] = df["surface"].map(
                lambda x: "ダート" if "ダ" in str(x) else "芝"
            )

        # ground_state 正規化
        if "ground_state" in df.columns:
            df["ground_state"] = df["ground_state"].str.strip()
            df["ground_state"] = df["ground_state"].map({
                "良": "良", "稍重": "稍重", "重": "重", "不良": "不良",
            }).fillna("良")

        # finish_time を秒数float化
        df["finish_time_sec"] = df["finish_time"].apply(self._time_to_sec)

        logger.info("clean_race_results done: %d rows", len(df))
        return df

    def clean_horse_results(self, df: pd.DataFrame) -> pd.DataFrame:
        """馬過去成績DataFrameのクレンジングを行う"""
        df = df.copy()

        df["finish_pos"] = pd.to_numeric(df["finish_pos"], errors="coerce")
        df = df.dropna(subset=["finish_pos"]).copy()
        df["finish_pos"] = df["finish_pos"].astype(int)

        df["race_date"] = pd.to_datetime(df["race_date"], errors="coerce")

        for col in ["distance", "horse_count", "frame_number", "horse_number",
                    "odds", "popularity", "final_3f", "body_weight", "body_weight_diff"]:
            if col in df.columns:
                df[col] = pd.to_numeric(df[col], errors="coerce")

        # surface 正規化
        if "surface" in df.columns:
            df["surface"] = df["surface"].str.strip().map(
                lambda x: "ダート" if "ダ" in str(x) else "芝"
            )

        df["body_weight_diff"] = df["body_weight_diff"].fillna(0)

        return df

    # ----------------------------------------------------------
    # Label Encoding
    # ----------------------------------------------------------
    def fit_label_encoders(self, df: pd.DataFrame) -> "DataProcessor":
        """
        カテゴリ列のLabelEncoderをfitする（学習時のみ呼ぶ）。
        """
        for col in CATEGORICAL_COLS:
            if col not in df.columns:
                continue
            le = LabelEncoder()
            df[col] = df[col].fillna("不明").astype(str)
            le.fit(df[col])
            self.label_encoders[col] = le
            logger.debug("LabelEncoder fitted: %s (%d classes)", col, len(le.classes_))
        return self

    def apply_label_encoders(self, df: pd.DataFrame) -> pd.DataFrame:
        """
        fitされたLabelEncoderを適用する（学習・推論共通）。
        未知ラベルは "不明" にフォールバックする。
        """
        df = df.copy()
        for col, le in self.label_encoders.items():
            if col not in df.columns:
                continue
            df[col] = df[col].fillna("不明").astype(str)
            # 未知ラベルを "不明" にマップ
            known = set(le.classes_)
            df[col] = df[col].map(lambda x: x if x in known else "不明")
            df[col] = le.transform(df[col])
        return df

    def encode_categoricals_as_category(self, df: pd.DataFrame) -> pd.DataFrame:
        """LightGBM用にカテゴリ列を category dtype に変換する"""
        df = df.copy()
        for col in CATEGORICAL_COLS:
            if col in df.columns:
                df[col] = df[col].astype("category")
        return df

    # ----------------------------------------------------------
    # 統合前処理パイプライン
    # ----------------------------------------------------------
    def build_master_df(self) -> pd.DataFrame:
        """
        全テーブルを結合・クレンジングしたマスターDataFrameを作成する。
        FeatureEngineerの入力として使う。
        """
        race_df = self.clean_race_results(self.load_race_results())
        pedigree_df = self.load_pedigree()

        # 血統を結合
        df = race_df.merge(pedigree_df, on="horse_id", how="left")

        # 血統列の欠損補完
        for col in ["sire", "dam_sire", "sire_sire", "dam_sire_sire"]:
            if col in df.columns:
                df[col] = df[col].fillna("不明")

        # horse_results は FeatureEngineer 内でグループ集計に使うため返さない
        logger.info("master_df built: %d rows, %d cols", len(df), df.shape[1])
        return df

    # ----------------------------------------------------------
    # ユーティリティ
    # ----------------------------------------------------------
    @staticmethod
    def _time_to_sec(time_str: str) -> Optional[float]:
        """
        '1:33.5' → 93.5 秒 に変換する。
        変換不可は None を返す。
        """
        if pd.isna(time_str) or str(time_str).strip() == "":
            return None
        m = re.match(r"(\d+):(\d+\.\d+)", str(time_str).strip())
        if m:
            return int(m.group(1)) * 60 + float(m.group(2))
        try:
            return float(time_str)
        except ValueError:
            return None
