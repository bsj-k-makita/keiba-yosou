"""
競馬予想AIシステム - 馬券評価エンジン

機械学習モデルのスコアから最終的な馬券購入意思決定を行うクラス。
以下を統合したプロレベルの意思決定ロジック:
  - 統計的信頼性（キャリブレーション）
  - 控除率を考慮した実質期待値（Effective EV）
  - 資金管理（ケリー基準 / Fractional Kelly）
  - 人気バイアス補正（オプション）
"""

from __future__ import annotations

import logging
from typing import Optional

import numpy as np
import pandas as pd
from sklearn.isotonic import IsotonicRegression
from sklearn.linear_model import LogisticRegression

logger = logging.getLogger(__name__)


class BettingEvaluator:
    """
    機械学習スコアから馬券購入の意思決定を行う評価エンジン。

    使用例:
        evaluator = BettingEvaluator(margin=0.15, kelly_fraction=0.25)
        evaluator.fit_calibration(train_scores, train_labels)
        bets = evaluator.decide_bets(race_df)
    """

    def __init__(
        self,
        margin: float = 0.15,
        kelly_fraction: float = 0.25,
        prob_threshold: float = 0.05,
        min_odds: float = 1.5,
        max_kelly: float = 0.25,
        apply_popularity_bias: bool = True,
    ):
        """
        パラメータ初期化。

        Args:
            margin: 安全マージン（実質期待値の計算で控除する値。デフォルト 0.15）
                    競馬の控除率（約25%）を考慮した保守的な設定値。
            kelly_fraction: フラクショナルケリー係数（デフォルト 0.25 = クォーターケリー）
                           1.0 にするとフルケリー（リスク大）。0.25 が実用的な安全値。
            prob_threshold: ベット対象とする最低予測確率（デフォルト 0.05 = 5%）
            min_odds: ベット対象とする最低オッズ（デフォルト 1.5）
            max_kelly: ケリー比率の上限（デフォルト 0.25 = 全資金の25%）
            apply_popularity_bias: 過剰人気補正を適用するか（デフォルト True）
        """
        self.margin = margin
        self.kelly_fraction = kelly_fraction
        self.prob_threshold = prob_threshold
        self.min_odds = min_odds
        self.max_kelly = max_kelly
        self.apply_popularity_bias = apply_popularity_bias

        # キャリブレーションモデル（fit_calibration後に設定）
        self.calibrator: Optional[object] = None
        self._calibration_method: str = "isotonic"

    # ============================================================
    # A. 確率変換（Calibration）
    # ============================================================
    def fit_calibration(
        self,
        train_scores: np.ndarray,
        train_labels: np.ndarray,
        method: str = "isotonic",
    ) -> "BettingEvaluator":
        """
        キャリブレーションモデルを学習する。

        モデル出力スコアを「真の勝率」に変換するための変換器を構築する。
        【重要】データリーク防止のため、必ず過去の学習データのみを渡すこと。
                テストデータや未来のデータを混入させないこと。

        Args:
            train_scores: 学習データのモデル出力スコア（shape: [N]）
            train_labels:  学習データの実際の結果（0/1）（shape: [N]）
            method: "isotonic"（アイソトニック回帰）or "sigmoid"（Platt Scaling）

        Returns:
            self（メソッドチェーン可）
        """
        train_scores = np.asarray(train_scores, dtype=float)
        train_labels = np.asarray(train_labels, dtype=float)

        if len(train_scores) == 0:
            raise ValueError("train_scores が空です。学習データを確認してください。")

        if method == "isotonic":
            # アイソトニック回帰: 単調増加制約付き非線形変換
            # out_of_bounds="clip" により学習範囲外のスコアも安全に処理
            cal = IsotonicRegression(out_of_bounds="clip")
            cal.fit(train_scores, train_labels)
            self.calibrator = cal

        elif method == "sigmoid":
            # Platt Scaling: ロジスティック回帰による線形変換（シグモイド関数）
            # 高C値でほぼ正則化なし（スコアへの直接フィット）
            cal = LogisticRegression(C=1e10, solver="lbfgs", max_iter=1000)
            cal.fit(train_scores.reshape(-1, 1), train_labels)
            self.calibrator = cal

        else:
            raise ValueError(f"未対応のmethod: {method}。'isotonic' または 'sigmoid' を指定してください。")

        self._calibration_method = method
        logger.info(
            "キャリブレーション学習完了: method=%s, N=%d, 正例率=%.3f",
            method, len(train_labels), train_labels.mean()
        )
        return self

    def require_calibrator(self) -> None:
        """学習済みキャリブレーター必須チェック（バックフィル・本番推論用）。"""
        if self.calibrator is None:
            raise RuntimeError(
                "キャリブレーションモデルが未ロードです。"
                " `python main.py simulate` 実行後の betting_evaluator.pkl を配置するか、"
                " evaluator.fit_calibration() を先に実行してください。"
            )

    def _apply_calibration(self, scores: np.ndarray) -> np.ndarray:
        """
        学習済みキャリブレーターでスコアを確率に変換する。
        キャリブレーターが未学習の場合はそのままの値を返す（decide_bets 等の後方互換）。
        """
        if self.calibrator is None:
            logger.debug("キャリブレーターが未学習。スコアをそのまま使用します。")
            return np.asarray(scores, dtype=float)

        if self._calibration_method == "sigmoid":
            return self.calibrator.predict_proba(scores.reshape(-1, 1))[:, 1]
        return self.calibrator.predict(scores)

    def calibrated_normalized_probs(self, raw_scores: np.ndarray) -> np.ndarray:
        """
        LightGBM 生スコア → キャリブレーション → レース内合計1正規化。

        JSON バックフィル用の単一レース確率（全頭分）を返す。
        """
        self.require_calibrator()
        calibrated = np.asarray(self._apply_calibration(raw_scores), dtype=float)
        total = float(np.sum(calibrated))
        if total < 1e-9:
            n = len(calibrated)
            if n == 0:
                return calibrated
            return np.ones(n, dtype=float) / n
        return calibrated / total

    @classmethod
    def load(cls, path: str | "Path") -> "BettingEvaluator":
        """betting_evaluator.pkl を読み込み、キャリブレーター有無を検証する。"""
        import pickle
        from pathlib import Path as PathLib

        p = PathLib(path)
        if not p.is_file():
            raise FileNotFoundError(f"betting_evaluator.pkl not found: {p}")
        with p.open("rb") as f:
            obj = pickle.load(f)
        if not isinstance(obj, cls):
            raise TypeError(f"Expected BettingEvaluator, got {type(obj).__name__}")
        obj.require_calibrator()
        return obj

    # ============================================================
    # B. 実質期待値（Effective EV）の算出
    # ============================================================
    def calculate_ev(
        self,
        probs: np.ndarray,
        odds: np.ndarray,
    ) -> np.ndarray:
        """
        安全マージンを考慮した実質期待値を計算する。

        数式:
            E_effective = (P × O) - Margin

        - P × O: 理論上の期待値（1.0 = 収支トントン）
        - Margin: 控除率・予測誤差・取引コストを考慮した安全マージン

        例: P=0.20, O=8.0, Margin=0.15 → EV = (0.20 × 8.0) - 0.15 = 1.45

        Args:
            probs: 予測勝率の配列（shape: [N]）
            odds:  オッズの配列（shape: [N]）

        Returns:
            実質期待値の配列（shape: [N]）
        """
        probs = np.asarray(probs, dtype=float)
        odds = np.asarray(odds, dtype=float)

        # 不正値のチェック（0 や NaN は期待値を 0 に設定）
        valid_mask = (odds > 0) & np.isfinite(odds) & np.isfinite(probs)

        ev = np.zeros_like(probs)
        ev[valid_mask] = (probs[valid_mask] * odds[valid_mask]) - self.margin
        return ev

    # ============================================================
    # C. 人気バイアスの補正（オプション）
    # ============================================================
    def _adjust_for_popularity_bias(
        self,
        race_df: pd.DataFrame,
    ) -> pd.DataFrame:
        """
        過剰人気馬（1番人気等）の期待値を補正する。

        競馬では1番人気馬は過剰に支持される傾向があり、
        実際の回収率はランダムよりも低くなりやすい。
        この補正により1番人気馬へのベットを抑制する。

        補正ロジック:
            - 人気順1位（オッズ最小）かつ EV が閾値に近い場合、EVを割り引く
            - 大穴馬（オッズ > 20倍）も過剰人気補正の対象外とする
        """
        if "odds" not in race_df.columns:
            return race_df

        race_df = race_df.copy()

        # レース内でオッズ最小 = 1番人気
        min_odds_idx = race_df["odds"].idxmin()

        # 1番人気への補正: 期待値を -0.05 割り引く（慎重ゾーンへ移動）
        race_df.loc[min_odds_idx, "effective_ev"] = (
            race_df.loc[min_odds_idx, "effective_ev"] - 0.05
        )

        logger.debug(
            "1番人気補正適用: idx=%s, odds=%.1f",
            min_odds_idx,
            race_df.loc[min_odds_idx, "odds"]
        )
        return race_df

    # ============================================================
    # D. 資金配分（Kelly Criterion）
    # ============================================================
    def _calculate_kelly(
        self,
        prob: float,
        odds: float,
    ) -> float:
        """
        ケリー基準による最適投資比率を算出する。

        数式（単勝馬券の場合）:
            f* = (P × (O - 1) - (1 - P)) / (O - 1)
               = (P × O - 1) / (O - 1)

        フラクショナルケリー適用:
            f_actual = f* × kelly_fraction

        安全装置:
            - f* が負（期待値が1未満）の場合は 0.0 を返す（ベットしない）
            - f_actual が max_kelly を超えた場合は max_kelly に制限

        Args:
            prob: 予測勝率（0〜1）
            odds: 単勝オッズ

        Returns:
            全資金に対するベット比率（0.0〜max_kelly）
        """
        # オッズが 1.0 以下は計算不能（控除後に必ず損失）
        if odds <= 1.0 or not np.isfinite(odds) or not np.isfinite(prob):
            return 0.0

        net_odds = odds - 1.0  # 純利益オッズ（1単位ベットあたりの利益）

        # ケリー比率の計算
        # 分子: P×(O-1) - (1-P) = P×O - 1
        # 分母: O - 1
        kelly_f = (prob * net_odds - (1.0 - prob)) / net_odds

        # 期待値が負（ケリーが負）の場合はベットしない
        if kelly_f <= 0:
            return 0.0

        # フラクショナルケリー適用（リスク低減）
        kelly_f_fractional = kelly_f * self.kelly_fraction

        # 上限制限（破産リスク回避）
        return float(np.clip(kelly_f_fractional, 0.0, self.max_kelly))

    # ============================================================
    # メインメソッド: 馬券購入意思決定
    # ============================================================
    def decide_bets(
        self,
        race_data_df: pd.DataFrame,
        score_col: str = "pred_prob",
        odds_col: str = "odds",
        ev_threshold: float = 1.0,
    ) -> pd.DataFrame:
        """
        入力データから購入すべき馬のリストと投資ウェイトを返す。

        【処理フロー】
          1. スコアをキャリブレーション → 真の勝率 P に変換
          2. レース内で確率を正規化（合計が1になるよう）
          3. 実質期待値を計算: E = (P × O) - Margin
          4. 人気バイアス補正（オプション）
          5. フィルタリング: E > ev_threshold かつ P > prob_threshold かつ O > min_odds
          6. ケリー基準で投資ウェイトを決定

        【重要】購入判断はレースID（race_id）ごとに独立して行う。
               レースをまたいだ確率の比較は行わない（競馬の特性上、
               各レースは完全に独立したイベントのため）。

        Args:
            race_data_df: 以下の列を含むDataFrame
                - race_id: レース識別子
                - {score_col}: モデルの予測スコア（デフォルト: pred_prob）
                - {odds_col}: オッズ（realtime_odds または odds）
                - horse_name: 馬名（あれば）
                - horse_number: 馬番（あれば）
            score_col: スコア列名（デフォルト: "pred_prob"）
            odds_col: オッズ列名（デフォルト: "odds"）
            ev_threshold: 購入対象とする最低実質期待値（デフォルト: 1.0）

        Returns:
            購入推奨馬のDataFrame。以下の列を含む:
                - race_id, horse_name, horse_number（あれば）
                - calibrated_prob: キャリブレーション後の確率
                - prob_normalized: レース内正規化後の確率
                - odds: オッズ
                - effective_ev: 実質期待値
                - kelly_weight: ケリー基準による投資比率
        """
        if race_data_df.empty:
            logger.warning("入力データが空です。")
            return pd.DataFrame()

        # 必須列の存在チェック
        required_cols = ["race_id", score_col, odds_col]
        missing = [c for c in required_cols if c not in race_data_df.columns]
        if missing:
            raise ValueError(f"必須列が見つかりません: {missing}")

        df = race_data_df.copy()

        # ----------------------------------------------------------
        # ステップ1: スコアをキャリブレーション → 確率 P に変換
        # ----------------------------------------------------------
        raw_scores = df[score_col].values.astype(float)
        df["calibrated_prob"] = self._apply_calibration(raw_scores)

        # ----------------------------------------------------------
        # ステップ2: レースIDごとに確率を正規化（合計=1）
        # 競馬では1レースに必ず1頭しか勝てないため、
        # レース内の各馬の確率の合計を1に正規化する。
        # ----------------------------------------------------------
        df["prob_normalized"] = df.groupby("race_id")["calibrated_prob"].transform(
            lambda x: x / max(float(x.sum()), 1e-9)
        )

        # ----------------------------------------------------------
        # ステップ3: オッズの前処理（欠損値・ゼロ値の処理）
        # ----------------------------------------------------------
        df[odds_col] = pd.to_numeric(df[odds_col], errors="coerce")
        invalid_odds_mask = (df[odds_col].isna()) | (df[odds_col] <= 0)
        n_invalid = invalid_odds_mask.sum()
        if n_invalid > 0:
            logger.warning("無効なオッズが %d 件あります。これらはスキップします。", n_invalid)
            df.loc[invalid_odds_mask, odds_col] = np.nan

        df = df.rename(columns={odds_col: "odds"}) if odds_col != "odds" else df

        # ----------------------------------------------------------
        # ステップ4: 実質期待値の計算
        # E_effective = (P × O) - Margin
        # ----------------------------------------------------------
        df["effective_ev"] = self.calculate_ev(
            probs=df["prob_normalized"].values,
            odds=df["odds"].values,
        )

        # ----------------------------------------------------------
        # ステップ5〜6: レースIDごとに独立して判定・ケリー計算
        # 競馬の特性上、レースをまたいだ判定は行わない。
        # ----------------------------------------------------------
        bet_candidates = []

        for race_id, race_group in df.groupby("race_id"):
            race_df = race_group.copy()

            # 人気バイアス補正（オプション）
            if self.apply_popularity_bias and "odds" in race_df.columns:
                race_df = self._adjust_for_popularity_bias(race_df)

            # フィルタリング:
            #   - 実質期待値 > ev_threshold（デフォルト 1.0）
            #   - 予測確率 > prob_threshold（低確率馬を除外）
            #   - オッズ >= min_odds（大本命すぎる馬を除外）
            #   - オッズが有効な値（NaN でない）
            candidates = race_df[
                (race_df["effective_ev"] > ev_threshold) &
                (race_df["prob_normalized"] > self.prob_threshold) &
                (race_df["odds"] >= self.min_odds) &
                (race_df["odds"].notna())
            ].copy()

            if candidates.empty:
                continue

            # ケリー基準による投資比率を各馬に対して計算
            candidates["kelly_weight"] = candidates.apply(
                lambda row: self._calculate_kelly(
                    prob=row["prob_normalized"],
                    odds=row["odds"],
                ),
                axis=1,
            )

            # ケリー比率が 0 の馬は対象外（期待値が実質的に負）
            candidates = candidates[candidates["kelly_weight"] > 0]

            if candidates.empty:
                continue

            bet_candidates.append(candidates)

        if not bet_candidates:
            logger.info(
                "購入推奨馬なし（EV閾値=%.2f, マージン=%.2f）",
                ev_threshold, self.margin
            )
            return pd.DataFrame()

        # 全レースの購入候補を結合
        result_df = pd.concat(bet_candidates, ignore_index=True)

        # 出力列を選択・整理
        output_cols = ["race_id"]
        for col in ["horse_number", "horse_name", "jockey_name"]:
            if col in result_df.columns:
                output_cols.append(col)
        output_cols += ["calibrated_prob", "prob_normalized", "odds", "effective_ev", "kelly_weight"]

        result_df = result_df[output_cols].sort_values(
            ["race_id", "effective_ev"], ascending=[True, False]
        ).reset_index(drop=True)

        logger.info(
            "購入推奨馬: %d 頭（%d レース中）",
            len(result_df),
            result_df["race_id"].nunique(),
        )
        return result_df

    # ----------------------------------------------------------
    # ユーティリティ: 推奨内容の表示
    # ----------------------------------------------------------
    def print_bets(self, bets_df: pd.DataFrame, bankroll: int = 100_000) -> None:
        """
        decide_bets の結果を見やすく表示する。

        Args:
            bets_df: decide_bets の戻り値
            bankroll: 全資金額（円）。ケリー比率からの実際の投資額を計算するために使用。
        """
        if bets_df.empty:
            print("\n【購入推奨なし】条件を満たす馬がありません。")
            return

        print("\n" + "=" * 65)
        print("  馬券購入推奨リスト（BettingEvaluator）")
        print(f"  マージン={self.margin:.2f} / ケリー分数={self.kelly_fraction}")
        print("=" * 65)

        for race_id, group in bets_df.groupby("race_id"):
            print(f"\nレースID: {race_id}")
            print("-" * 60)
            for _, row in group.iterrows():
                horse_name = row.get("horse_name", f"馬番{row.get('horse_number', '?')}")
                bet_amount = int(bankroll * row["kelly_weight"] // 100 * 100)  # 100円単位切り捨て
                print(
                    f"  {horse_name:12s} | "
                    f"確率: {row['prob_normalized']*100:5.1f}% | "
                    f"オッズ: {row['odds']:5.1f}倍 | "
                    f"EV: {row['effective_ev']:.3f} | "
                    f"Kelly: {row['kelly_weight']*100:.1f}% | "
                    f"推奨額: {bet_amount:,}円"
                )

        print("=" * 65 + "\n")
