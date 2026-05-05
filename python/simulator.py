"""
競馬予想AIシステム - シミュレーション・評価モジュール

- 的中率・回収率のバックテスト
- キャリブレーションプロット（予測確率 vs 実際の勝率）
- 期待値ベースの購入戦略シミュレーション
- 閾値最適化
"""

import logging
from dataclasses import dataclass, field
from typing import Optional

import numpy as np
import pandas as pd
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import matplotlib.font_manager as fm
from sklearn.calibration import calibration_curve, CalibratedClassifierCV
from sklearn.isotonic import IsotonicRegression

from config import BET_UNIT, MIN_EV_THRESHOLD, TICKET_CONFIGS
from betting_evaluator import BettingEvaluator

logger = logging.getLogger(__name__)

# 日本語フォント設定（matplotlib）
try:
    plt.rcParams["font.family"] = "Hiragino Sans"
except Exception:
    pass


# ============================================================
# データクラス
# ============================================================
@dataclass
class BetResult:
    race_id: str
    horse_id: str
    horse_name: str
    ticket_type: str
    bet_amount: int
    payout: int
    is_hit: bool
    odds: float
    pred_prob: float
    expected_value: float


@dataclass
class SimulationReport:
    n_races: int = 0
    n_bets: int = 0
    total_bet: int = 0
    total_payout: int = 0
    n_hits: int = 0
    hit_rate: float = 0.0
    roi: float = 0.0       # 回収率（%）
    profit: int = 0
    avg_ev: float = 0.0
    results: list[BetResult] = field(default_factory=list)


# ============================================================
# Simulator クラス
# ============================================================
class Simulator:
    """
    予測モデルの購入戦略をシミュレートし、的中率・回収率を評価するクラス。

    - キャリブレーション補正
    - EV（期待値）ベースの購入戦略
    - 月次・年次の損益推移
    """

    def __init__(
        self,
        ev_threshold: float = MIN_EV_THRESHOLD,
        bet_unit: int = BET_UNIT,
        min_odds: float = 1.5,
        margin: float = 0.15,
        kelly_fraction: float = 0.25,
    ):
        self.ev_threshold = ev_threshold
        self.bet_unit = bet_unit
        self.min_odds = min_odds
        self.calibrator: Optional[IsotonicRegression] = None

        # BettingEvaluator: 実質期待値とケリー基準を管理するエンジン
        self.evaluator = BettingEvaluator(
            margin=margin,
            kelly_fraction=kelly_fraction,
            min_odds=min_odds,
        )

    # ----------------------------------------------------------
    # キャリブレーション補正
    # ----------------------------------------------------------
    def fit_calibration(
        self,
        y_true: np.ndarray,
        y_prob: np.ndarray,
        method: str = "isotonic",
    ) -> "Simulator":
        """
        予測確率を実際の勝率に合わせてキャリブレーションする。

        【重要】データリーク防止のため、学習データのみを渡すこと。
                テストデータを混入させると過学習の原因となる。

        Args:
            y_true: 実際の結果（0/1）の学習データ
            y_prob: モデルの予測確率の学習データ
            method: "isotonic"（アイソトニック回帰）or "sigmoid"（Platt Scaling）
        """
        # BettingEvaluator のキャリブレーション機能を使用（単一責任）
        self.evaluator.fit_calibration(
            train_scores=y_prob,
            train_labels=y_true,
            method=method,
        )

        # 後方互換性のため、従来の calibrator 属性も同期
        self.calibrator = self.evaluator.calibrator
        return self

    def calibrate(self, y_prob: np.ndarray) -> np.ndarray:
        """キャリブレーション補正を適用する"""
        if self.calibrator is None:
            return y_prob
        if hasattr(self.calibrator, "predict_proba"):
            return self.calibrator.predict_proba(y_prob.reshape(-1, 1))[:, 1]
        return self.calibrator.predict(y_prob)

    # ----------------------------------------------------------
    # バックテスト（シミュレーション）
    # ----------------------------------------------------------
    def run(
        self,
        df: pd.DataFrame,
        payout_df: pd.DataFrame,
        ticket_type: str = "win",
        use_calibration: bool = True,
    ) -> SimulationReport:
        """
        過去データを使って購入戦略のバックテストを行う。

        Args:
            df: 予測確率付きDataFrame（race_id, horse_id, pred_prob, odds, finish_pos を含む）
            payout_df: 払い戻しテーブル（race_id, ticket_type, combination, payout）
            ticket_type: "win" (単勝) or "place" (複勝)
            use_calibration: キャリブレーション補正を適用するか

        Returns:
            SimulationReport
        """
        report = SimulationReport()
        df = df.copy()

        # ----------------------------------------------------------
        # BettingEvaluator を使った評価ロジック
        # キャリブレーション・実質期待値・ケリー基準を統合適用
        # ----------------------------------------------------------

        # キャリブレーション補正（BettingEvaluator が内部で処理）
        if use_calibration and self.evaluator.calibrator is not None:
            df["pred_prob"] = self.evaluator._apply_calibration(df["pred_prob"].values)
        elif use_calibration and self.calibrator is not None:
            # 後方互換: 旧 calibrator が直接セットされている場合
            df["pred_prob"] = self.calibrate(df["pred_prob"].values)

        # レース内確率正規化（レースごとに合計=1 にする）
        df["pred_prob_norm"] = df.groupby("race_id")["pred_prob"].transform(
            lambda x: x / x.sum().clip(lower=1e-9)
        )

        # 実質期待値計算: E = (P × O) - Margin（単純な P×O ではなくマージン控除）
        effective_ev = self.evaluator.calculate_ev(
            probs=df["pred_prob_norm"].values,
            odds=df["odds"].values,
        )
        df["expected_value"] = effective_ev

        race_ids = df["race_id"].unique()
        report.n_races = len(race_ids)

        for race_id in race_ids:
            race = df[df["race_id"] == race_id].copy()

            # 購入候補：実質EV閾値 & オッズ最低ラインを満たす馬
            candidates = race[
                (race["expected_value"] >= self.ev_threshold) &
                (race["odds"] >= self.min_odds) &
                (race["odds"].notna())
            ]

            if candidates.empty:
                continue

            # 最も実質期待値が高い馬を選択（単点賭け）
            best = candidates.sort_values("expected_value", ascending=False).iloc[0]

            # 実際の払い戻し確認
            if ticket_type == "win":
                is_hit = best["finish_pos"] == 1
                actual_payout = self._get_win_payout(payout_df, race_id, best["horse_number"])
            elif ticket_type == "place":
                is_hit = best["finish_pos"] <= 3
                actual_payout = self._get_place_payout(payout_df, race_id, best["horse_number"])
            else:
                is_hit = False
                actual_payout = 0

            payout_amount = (actual_payout * self.bet_unit // 100) if is_hit else 0

            bet = BetResult(
                race_id=race_id,
                horse_id=best.get("horse_id", ""),
                horse_name=best.get("horse_name", ""),
                ticket_type=ticket_type,
                bet_amount=self.bet_unit,
                payout=payout_amount,
                is_hit=is_hit,
                odds=best["odds"],
                pred_prob=best["pred_prob_norm"],
                expected_value=best["expected_value"],
            )
            report.results.append(bet)

        # 集計
        if report.results:
            report.n_bets = len(report.results)
            report.total_bet = sum(r.bet_amount for r in report.results)
            report.total_payout = sum(r.payout for r in report.results)
            report.n_hits = sum(1 for r in report.results if r.is_hit)
            report.hit_rate = report.n_hits / report.n_bets
            report.roi = (report.total_payout / report.total_bet * 100) if report.total_bet > 0 else 0
            report.profit = report.total_payout - report.total_bet
            report.avg_ev = np.mean([r.expected_value for r in report.results])

        self._print_report(report)
        return report

    def _get_win_payout(
        self,
        payout_df: pd.DataFrame,
        race_id: str,
        horse_number: int,
    ) -> int:
        """単勝払い戻し金額を取得する（100円あたり）"""
        rows = payout_df[
            (payout_df["race_id"] == race_id) &
            (payout_df["ticket_type"].str.contains("単勝")) &
            (payout_df["combination"].astype(str) == str(int(horse_number)))
        ]
        if rows.empty:
            return 0
        return int(rows.iloc[0]["payout"])

    def _get_place_payout(
        self,
        payout_df: pd.DataFrame,
        race_id: str,
        horse_number: int,
    ) -> int:
        """複勝払い戻し金額を取得する（100円あたり）"""
        rows = payout_df[
            (payout_df["race_id"] == race_id) &
            (payout_df["ticket_type"].str.contains("複勝")) &
            (payout_df["combination"].astype(str) == str(int(horse_number)))
        ]
        if rows.empty:
            return 0
        return int(rows.iloc[0]["payout"])

    # ----------------------------------------------------------
    # 閾値最適化
    # ----------------------------------------------------------
    def optimize_threshold(
        self,
        df: pd.DataFrame,
        payout_df: pd.DataFrame,
        ticket_type: str = "win",
        ev_range: tuple[float, float] = (1.0, 2.0),
        n_steps: int = 20,
    ) -> dict:
        """
        EV閾値をグリッドサーチして最適な閾値を見つける。

        Returns:
            {"best_ev_threshold": float, "best_roi": float, "grid_results": DataFrame}
        """
        thresholds = np.linspace(ev_range[0], ev_range[1], n_steps)
        results = []

        for threshold in thresholds:
            sim = Simulator(ev_threshold=threshold, bet_unit=self.bet_unit)
            sim.calibrator = self.calibrator
            report = sim.run(df, payout_df, ticket_type=ticket_type)
            results.append({
                "ev_threshold": threshold,
                "n_bets": report.n_bets,
                "hit_rate": report.hit_rate,
                "roi": report.roi,
                "profit": report.profit,
            })

        grid_df = pd.DataFrame(results)

        # ROIが最大かつベット数が一定以上の閾値を選択
        valid = grid_df[grid_df["n_bets"] >= 10]
        if valid.empty:
            valid = grid_df
        best_row = valid.loc[valid["roi"].idxmax()]

        logger.info(
            "最適閾値: EV=%.2f, ROI=%.1f%%, ベット数=%d",
            best_row["ev_threshold"], best_row["roi"], best_row["n_bets"],
        )

        return {
            "best_ev_threshold": best_row["ev_threshold"],
            "best_roi": best_row["roi"],
            "grid_results": grid_df,
        }

    # ----------------------------------------------------------
    # 評価グラフ
    # ----------------------------------------------------------
    def plot_calibration(
        self,
        y_true: np.ndarray,
        y_prob: np.ndarray,
        save_path: str = "calibration_plot.png",
        n_bins: int = 10,
    ) -> None:
        """
        キャリブレーションプロットを出力する。

        X軸: モデルの予測確率（平均）
        Y軸: 実際の勝率
        理想は y=x の対角線
        """
        fig, axes = plt.subplots(1, 2, figsize=(14, 6))

        # --- キャリブレーション前 ---
        fraction_of_positives_raw, mean_predicted_value_raw = calibration_curve(
            y_true, y_prob, n_bins=n_bins, strategy="uniform"
        )
        axes[0].plot(
            mean_predicted_value_raw,
            fraction_of_positives_raw,
            "s-",
            label="モデル予測",
            color="royalblue",
        )
        axes[0].plot([0, 1], [0, 1], "k--", label="完全キャリブレーション")
        axes[0].set_title("キャリブレーション（補正前）")
        axes[0].set_xlabel("予測勝率（モデル）")
        axes[0].set_ylabel("実際の勝率")
        axes[0].legend()
        axes[0].grid(True, alpha=0.3)

        # --- キャリブレーション後 ---
        if self.calibrator is not None:
            y_prob_cal = self.calibrate(y_prob)
            fraction_of_positives_cal, mean_predicted_value_cal = calibration_curve(
                y_true, y_prob_cal, n_bins=n_bins, strategy="uniform"
            )
            axes[1].plot(
                mean_predicted_value_cal,
                fraction_of_positives_cal,
                "s-",
                label="補正後",
                color="tomato",
            )
            axes[1].plot([0, 1], [0, 1], "k--", label="完全キャリブレーション")
            axes[1].set_title("キャリブレーション（補正後）")
            axes[1].set_xlabel("予測勝率（補正後）")
            axes[1].set_ylabel("実際の勝率")
            axes[1].legend()
            axes[1].grid(True, alpha=0.3)

        plt.tight_layout()
        plt.savefig(save_path, dpi=120)
        plt.close()
        logger.info("Calibration plot saved: %s", save_path)

    def plot_cumulative_profit(
        self,
        report: SimulationReport,
        save_path: str = "cumulative_profit.png",
    ) -> None:
        """累積損益グラフを出力する"""
        if not report.results:
            return

        cumulative = []
        running_profit = 0
        for i, bet in enumerate(report.results):
            running_profit += bet.payout - bet.bet_amount
            cumulative.append({"bet_num": i + 1, "profit": running_profit})

        profit_df = pd.DataFrame(cumulative)

        fig, ax = plt.subplots(figsize=(12, 5))
        ax.plot(profit_df["bet_num"], profit_df["profit"], color="royalblue", lw=1.5)
        ax.axhline(0, color="black", lw=0.8, linestyle="--")
        ax.fill_between(
            profit_df["bet_num"],
            profit_df["profit"],
            0,
            where=(profit_df["profit"] >= 0),
            alpha=0.3,
            color="green",
            label="利益",
        )
        ax.fill_between(
            profit_df["bet_num"],
            profit_df["profit"],
            0,
            where=(profit_df["profit"] < 0),
            alpha=0.3,
            color="red",
            label="損失",
        )
        ax.set_title(
            f"累積損益推移\n"
            f"回収率: {report.roi:.1f}% | 総損益: {report.profit:+,}円 | "
            f"ベット数: {report.n_bets}"
        )
        ax.set_xlabel("ベット番号")
        ax.set_ylabel("累積損益（円）")
        ax.legend()
        ax.grid(True, alpha=0.3)
        plt.tight_layout()
        plt.savefig(save_path, dpi=120)
        plt.close()
        logger.info("Profit plot saved: %s", save_path)

    def plot_roi_by_threshold(
        self,
        grid_results: pd.DataFrame,
        save_path: str = "roi_by_threshold.png",
    ) -> None:
        """EV閾値ごとの回収率グラフを出力する"""
        fig, ax1 = plt.subplots(figsize=(10, 5))

        ax1.plot(
            grid_results["ev_threshold"],
            grid_results["roi"],
            "o-",
            color="royalblue",
            label="回収率 (%)",
        )
        ax1.axhline(100, color="red", lw=0.8, linestyle="--", label="回収率100%")
        ax1.set_xlabel("期待値閾値")
        ax1.set_ylabel("回収率 (%)")
        ax1.legend(loc="upper left")
        ax1.grid(True, alpha=0.3)

        ax2 = ax1.twinx()
        ax2.bar(
            grid_results["ev_threshold"],
            grid_results["n_bets"],
            alpha=0.3,
            color="gray",
            width=0.03,
            label="ベット数",
        )
        ax2.set_ylabel("ベット数")
        ax2.legend(loc="upper right")

        plt.title("EV閾値 vs 回収率")
        plt.tight_layout()
        plt.savefig(save_path, dpi=120)
        plt.close()
        logger.info("ROI threshold plot saved: %s", save_path)

    # ----------------------------------------------------------
    # レポート出力
    # ----------------------------------------------------------
    @staticmethod
    def _print_report(report: SimulationReport) -> None:
        """シミュレーション結果をコンソール出力する"""
        print("\n" + "=" * 50)
        print("  シミュレーション結果")
        print("=" * 50)
        print(f"  対象レース数  : {report.n_races:,}")
        print(f"  ベット数      : {report.n_bets:,}")
        print(f"  的中数        : {report.n_hits:,}")
        print(f"  的中率        : {report.hit_rate * 100:.1f}%")
        print(f"  総投資額      : {report.total_bet:,} 円")
        print(f"  総払戻額      : {report.total_payout:,} 円")
        print(f"  回収率        : {report.roi:.1f}%")
        print(f"  純損益        : {report.profit:+,} 円")
        print(f"  平均期待値    : {report.avg_ev:.3f}")
        print("=" * 50 + "\n")
