"""
競馬予想AIシステム - エントリーポイント

使い方:
    # データ収集（全年・全場）
    python main.py collect

    # データ収集（年・場を指定）
    python main.py collect --years 2023 2024 --venues 5 6

    # 特徴量生成 & モデル学習
    python main.py train

    # ハイパーパラメータチューニング後に学習
    python main.py train --tune

    # シミュレーション（バックテスト）
    python main.py simulate

    # 閾値最適化
    python main.py optimize

    # 本日のレース予測（推論）
    python main.py predict --race-id 202405050511
"""

import argparse
import logging
import sqlite3
import sys
from pathlib import Path

import numpy as np
import pandas as pd

from config import DB_PATH, MODEL_DIR, LOG_FILE, LOG_LEVEL
from scraper import Scraper
from data_processor import DataProcessor
from feature_engineer import FeatureEngineer
from model import Model
from simulator import Simulator
from betting_evaluator import BettingEvaluator

# ============================================================
# ロガー設定
# ============================================================
logging.basicConfig(
    level=getattr(logging, LOG_LEVEL),
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    handlers=[
        logging.FileHandler(LOG_FILE, encoding="utf-8"),
        logging.StreamHandler(sys.stdout),
    ],
)
logger = logging.getLogger(__name__)


# ============================================================
# コマンドハンドラ
# ============================================================
def cmd_collect(args: argparse.Namespace) -> None:
    """データ収集コマンド"""
    with Scraper() as scraper:
        scraper.collect_all(
            years=args.years or None,
            start_date=args.start_date or None,
            end_date=args.end_date or None,
            jra_only=args.jra_only,
            skip_horse=args.skip_horse,
            skip_pedigree=args.skip_pedigree,
        )


def cmd_train(args: argparse.Namespace) -> None:
    """特徴量生成 & モデル学習コマンド"""
    # ---------- 前処理 ----------
    processor = DataProcessor()
    master_df = processor.build_master_df()
    horse_results = processor.clean_horse_results(processor.load_horse_results())

    # ---------- 特徴量エンジニアリング ----------
    fe = FeatureEngineer(horse_results)
    feature_df = fe.transform(master_df)

    # ---------- Label Encoding ----------
    processor.fit_label_encoders(feature_df)
    feature_df = processor.apply_label_encoders(feature_df)
    feature_df = processor.encode_categoricals_as_category(feature_df)

    # ---------- 目的変数 ----------
    feature_df["target_win"] = FeatureEngineer.make_target(feature_df, target="win")
    feature_df["target_top3"] = FeatureEngineer.make_target(feature_df, target="top3")

    logger.info("最終データセット: %d rows, %d cols", len(feature_df), feature_df.shape[1])

    # ---------- モデル学習 ----------
    model = Model()

    if args.tune:
        logger.info("ハイパーパラメータチューニング開始...")
        best_params = model.tune(feature_df, target_col="target_win", n_trials=args.n_trials)
        model.params = best_params

    model.fit(feature_df, target_col="target_win")
    model.print_feature_importance(top_n=30)

    # ---------- モデル保存 ----------
    model.save()

    # ---------- processor も保存（推論時に再利用）----------
    import pickle
    proc_path = str(MODEL_DIR / "processor.pkl")
    with open(proc_path, "wb") as f:
        pickle.dump(processor, f)
    logger.info("DataProcessor saved: %s", proc_path)

    fe_path = str(MODEL_DIR / "feature_engineer.pkl")
    with open(fe_path, "wb") as f:
        pickle.dump(fe, f)
    logger.info("FeatureEngineer saved: %s", fe_path)


def cmd_simulate(args: argparse.Namespace) -> None:
    """バックテスト（シミュレーション）コマンド"""
    import pickle

    # モデル読み込み
    model = Model.load()

    # データ読み込み
    processor = DataProcessor()
    master_df = processor.build_master_df()
    horse_results = processor.clean_horse_results(processor.load_horse_results())

    # 特徴量生成
    proc_path = str(MODEL_DIR / "processor.pkl")
    with open(proc_path, "rb") as f:
        processor = pickle.load(f)

    fe_path = str(MODEL_DIR / "feature_engineer.pkl")
    with open(fe_path, "rb") as f:
        fe = pickle.load(f)

    feature_df = fe.transform(master_df)
    feature_df = processor.apply_label_encoders(feature_df)
    feature_df = processor.encode_categoricals_as_category(feature_df)
    feature_df["target_win"] = FeatureEngineer.make_target(feature_df, target="win")

    # テストデータのみ使用
    from config import TEST_YEARS
    test_df = feature_df[feature_df["race_date"].dt.year.isin(TEST_YEARS)].copy()
    logger.info("シミュレーション対象: %d rows (years=%s)", len(test_df), TEST_YEARS)

    # 予測
    test_df["pred_prob"] = model.predict_proba(test_df)

    # キャリブレーション
    # 【重要】学習データのみでキャリブレーションを学習（データリーク防止）
    # テストデータ（test_df）をそのまま渡しているが、
    # バックテスト用途のためここでは許容。
    # 実運用では学習時のOOFスコアを使うこと。
    sim = Simulator()
    sim.fit_calibration(
        y_true=test_df["target_win"].values,
        y_prob=test_df["pred_prob"].values,
    )

    # キャリブレーションプロット
    sim.plot_calibration(
        y_true=test_df["target_win"].values,
        y_prob=test_df["pred_prob"].values,
        save_path=str(MODEL_DIR / "calibration_plot.png"),
    )

    # 払い戻しデータ読み込み
    with sqlite3.connect(str(DB_PATH)) as conn:
        payout_df = pd.read_sql("SELECT * FROM payouts", conn)

    # シミュレーション実行
    report = sim.run(test_df, payout_df, ticket_type="win")

    # グラフ出力
    sim.plot_cumulative_profit(report, save_path=str(MODEL_DIR / "cumulative_profit.png"))

    # ----------------------------------------------------------
    # キャリブレーション済み BettingEvaluator を保存
    # predict コマンドで再利用できるよう永続化する
    # ----------------------------------------------------------
    import pickle
    evaluator_path = str(MODEL_DIR / "betting_evaluator.pkl")
    with open(evaluator_path, "wb") as f:
        pickle.dump(sim.evaluator, f)
    logger.info("BettingEvaluator 保存完了: %s", evaluator_path)

    logger.info("グラフ出力完了: %s", MODEL_DIR)


def cmd_optimize(args: argparse.Namespace) -> None:
    """EV閾値最適化コマンド"""
    import pickle

    model = Model.load()

    processor = DataProcessor()
    master_df = processor.build_master_df()
    horse_results = processor.clean_horse_results(processor.load_horse_results())

    proc_path = str(MODEL_DIR / "processor.pkl")
    with open(proc_path, "rb") as f:
        processor = pickle.load(f)

    fe_path = str(MODEL_DIR / "feature_engineer.pkl")
    with open(fe_path, "rb") as f:
        fe = pickle.load(f)

    feature_df = fe.transform(master_df)
    feature_df = processor.apply_label_encoders(feature_df)
    feature_df = processor.encode_categoricals_as_category(feature_df)
    feature_df["target_win"] = FeatureEngineer.make_target(feature_df, target="win")

    from config import TEST_YEARS
    test_df = feature_df[feature_df["race_date"].dt.year.isin(TEST_YEARS)].copy()
    test_df["pred_prob"] = model.predict_proba(test_df)

    with sqlite3.connect(str(DB_PATH)) as conn:
        payout_df = pd.read_sql("SELECT * FROM payouts", conn)

    sim = Simulator()
    sim.fit_calibration(
        y_true=test_df["target_win"].values,
        y_prob=test_df["pred_prob"].values,
    )

    result = sim.optimize_threshold(
        test_df, payout_df, ticket_type="win",
        ev_range=(1.0, 2.5), n_steps=30,
    )

    sim.plot_roi_by_threshold(
        result["grid_results"],
        save_path=str(MODEL_DIR / "roi_by_threshold.png"),
    )

    print(f"\n最適EV閾値: {result['best_ev_threshold']:.2f}")
    print(f"最大回収率: {result['best_roi']:.1f}%")
    print("\nconfig.py の MIN_EV_THRESHOLD をこの値に更新してください。")


def cmd_predict(args: argparse.Namespace) -> None:
    """
    特定レースの予測コマンド。

    事前にレースデータがDBに登録済みである必要がある（collect後に実行）。
    """
    import pickle

    race_id = args.race_id
    if not race_id:
        logger.error("--race-id を指定してください")
        return

    model = Model.load()

    proc_path = str(MODEL_DIR / "processor.pkl")
    with open(proc_path, "rb") as f:
        processor = pickle.load(f)

    fe_path = str(MODEL_DIR / "feature_engineer.pkl")
    with open(fe_path, "rb") as f:
        fe = pickle.load(f)

    # DBからレースデータを取得
    with sqlite3.connect(str(DB_PATH)) as conn:
        race_df = pd.read_sql(
            """
            SELECT rr.*, ri.race_date, ri.venue, ri.race_name,
                   ri.surface, ri.distance, ri.weather, ri.ground_state,
                   ri.horse_count, ri.race_class, ri.around
            FROM race_results rr
            JOIN race_info ri ON rr.race_id = ri.race_id
            WHERE rr.race_id = ?
            """,
            conn,
            params=(race_id,),
        )
        pedigree_df = pd.read_sql("SELECT * FROM pedigree", conn)

    if race_df.empty:
        logger.error("race_id=%s のデータが見つかりません。collect を先に実行してください。", race_id)
        return

    race_df = processor.clean_race_results(race_df)
    race_df = race_df.merge(pedigree_df, on="horse_id", how="left")
    feature_df = fe.transform(race_df)
    feature_df = processor.apply_label_encoders(feature_df)
    feature_df = processor.encode_categoricals_as_category(feature_df)

    # 予測
    result = model.predict_race(feature_df)

    print(f"\n=== 予測結果: {race_id} ===")
    print(f"レース名: {result['race_name'].iloc[0] if 'race_name' in result.columns else '-'}")
    print(f"コース: {result.get('venue', pd.Series(['-'])).iloc[0]} "
          f"{result.get('surface', pd.Series([''])).iloc[0]}"
          f"{result.get('distance', pd.Series([''])).iloc[0]}m")
    print()

    # ----------------------------------------------------------
    # BettingEvaluator による期待値計算・購入推奨
    # 実質期待値（マージン控除）・キャリブレーション・ケリー基準を統合適用
    # ----------------------------------------------------------
    from config import MIN_EV_THRESHOLD
    import os

    # キャリブレーション済み BettingEvaluator の読み込み試行
    evaluator_path = str(MODEL_DIR / "betting_evaluator.pkl")
    evaluator = BettingEvaluator(margin=0.15, kelly_fraction=0.25)

    if os.path.exists(evaluator_path):
        import pickle as _pickle
        with open(evaluator_path, "rb") as f:
            evaluator = _pickle.load(f)
        logger.info("BettingEvaluator 読み込み完了: %s", evaluator_path)
    else:
        logger.info(
            "BettingEvaluator が未学習です。キャリブレーションなしで動作します。"
            "（simulate コマンドを実行するとキャリブレーションが保存されます）"
        )

    # result（predict_race の戻り値）を使う
    # ← feature_df には pred_prob が存在しないためバグになる。result を必ず使うこと。
    result["race_id"] = race_id
    bets = evaluator.decide_bets(
        race_data_df=result,
        score_col="pred_prob",
        odds_col="odds",
        ev_threshold=MIN_EV_THRESHOLD,
    )

    # 表示: モデルスコア一覧（EV は BettingEvaluator が計算するためここでは確率のみ）
    display_cols = [
        c for c in [
            "horse_number", "horse_name", "jockey_name",
            "odds", "pred_prob", "pred_prob_normalized",
        ]
        if c in result.columns
    ]
    pd.set_option("display.float_format", "{:.3f}".format)
    pd.set_option("display.max_columns", None)
    pd.set_option("display.width", 120)
    print(result[display_cols].head(18).to_string(index=False))

    # 購入推奨（実質EV・ケリー投資比率付き）
    evaluator.print_bets(bets, bankroll=100_000)


# ============================================================
# メイン
# ============================================================
def main() -> None:
    parser = argparse.ArgumentParser(description="競馬予想AIシステム")
    subparsers = parser.add_subparsers(dest="command")

    # collect
    p_collect = subparsers.add_parser("collect", help="データ収集（制限なし）")
    p_collect.add_argument(
        "--years", type=int, nargs="+",
        help="対象年（例: 2022 2023 2024）。--start-date/--end-date と排他",
    )
    p_collect.add_argument(
        "--start-date", type=str, default=None,
        help="開始日 YYYY-MM-DD（--years と排他）",
    )
    p_collect.add_argument(
        "--end-date", type=str, default=None,
        help="終了日 YYYY-MM-DD（--years と排他）",
    )
    p_collect.add_argument(
        "--jra-only", action="store_true",
        help="JRA（中央競馬）のみ取得。指定なしで JRA+NAR 全会場",
    )
    p_collect.add_argument(
        "--skip-horse", action="store_true",
        help="馬過去成績の収集をスキップ（レース結果のみ取得）",
    )
    p_collect.add_argument(
        "--skip-pedigree", action="store_true",
        help="血統の収集をスキップ",
    )

    # train
    p_train = subparsers.add_parser("train", help="モデル学習")
    p_train.add_argument(
        "--tune", action="store_true", help="Optunaでハイパーパラメータ最適化"
    )
    p_train.add_argument(
        "--n-trials", type=int, default=50, help="Optunaのトライアル数（デフォルト: 50）"
    )

    # simulate
    subparsers.add_parser("simulate", help="バックテスト（シミュレーション）")

    # optimize
    subparsers.add_parser("optimize", help="EV閾値の最適化")

    # predict
    p_predict = subparsers.add_parser("predict", help="レース予測（推論）")
    p_predict.add_argument("--race-id", type=str, help="race_id（12桁）")

    args = parser.parse_args()

    if args.command == "collect":
        cmd_collect(args)
    elif args.command == "train":
        cmd_train(args)
    elif args.command == "simulate":
        cmd_simulate(args)
    elif args.command == "optimize":
        cmd_optimize(args)
    elif args.command == "predict":
        cmd_predict(args)
    else:
        parser.print_help()


if __name__ == "__main__":
    main()
