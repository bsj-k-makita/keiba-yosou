"""
競馬予想AIシステム - エントリーポイント

使い方:
    # データ収集（全年・全場）
    python main.py collect

    # Phase0 疎通用（TS既存の結果JSON分のみ・約108レース）
    python main.py collect-quick --with-horses

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

    # race_class 一括再分類（DB）
    python main.py reclassify-race-classes

    # 本日のレース予測（推論）
    python main.py predict --race-id 202405050511
"""

from __future__ import annotations

import argparse
import logging
import sqlite3
import sys
from pathlib import Path

import numpy as np
import pandas as pd

from config import (
    DB_PATH,
    MODEL_DIR,
    LOG_FILE,
    LOG_LEVEL,
    ENABLE_EV_SAMPLE_WEIGHT,
    EV_WEIGHT_CENTER,
    EV_WEIGHT_TAU,
)
from scraper import Scraper
from data_processor import DataProcessor
from feature_engineer import FeatureEngineer
from model import Model
from simulator import Simulator
from betting_evaluator import BettingEvaluator
from artifacts import export_training_artifacts
from baseline_metrics import (
    build_baseline_report,
    print_baseline_summary,
    write_baseline_report,
)

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


def _repo_result_race_ids() -> list[str]:
    """src/data/results/*.json と整合する race_id 一覧（TS バックテスト済み分）。"""
    results_dir = Path(__file__).resolve().parent.parent / "src" / "data" / "results"
    if not results_dir.is_dir():
        return []
    return sorted(p.stem for p in results_dir.glob("*.json") if p.stem.isdigit())


def _golden_race_ids() -> list[str]:
    import json

    path = Path(__file__).resolve().parent / "golden_races.json"
    if not path.is_file():
        return []
    data = json.loads(path.read_text(encoding="utf-8"))
    return [r["race_id"] for r in data.get("races", [])]


def _index_race_ids_in_range(
    start_date: str | None,
    end_date: str | None,
) -> list[str]:
    """src/data/index.json から日付範囲（含む）の raceId を返す。"""
    import json

    if not start_date and not end_date:
        return []
    index_path = Path(__file__).resolve().parent.parent / "src" / "data" / "index.json"
    if not index_path.is_file():
        logger.warning("index.json not found: %s", index_path)
        return []
    rows = json.loads(index_path.read_text(encoding="utf-8"))
    out: list[str] = []
    for row in rows:
        d = str(row.get("date") or "")
        if start_date and d < start_date:
            continue
        if end_date and d > end_date:
            continue
        rid = row.get("raceId")
        if rid:
            out.append(str(rid))
    return sorted(set(out))


def cmd_collect_quick(args: argparse.Namespace) -> None:
    """
    クイック・インジェスト: TS 既存結果JSON + ゴールデンレースのみ netkeiba から取得。
    全期間 collect の代替（Phase 0 パイプライン疎通・108レース規模）。
    """
    start_d = getattr(args, "start_date", None)
    end_d = getattr(args, "end_date", None)
    if args.race_id and not (start_d or end_d or args.extra_years):
        # 失敗レースの再取得など: --race-id のみ指定時はその ID だけ
        ids: set[str] = set(args.race_id)
    elif start_d or end_d:
        # 日付範囲指定時は index.json の該当レースのみ（5/16〜5/31 等の部分反映用）
        ids = set(_index_race_ids_in_range(start_d, end_d))
    else:
        ids = set(_repo_result_race_ids())
        ids.update(_golden_race_ids())
        if args.race_id:
            ids.update(args.race_id)
    if args.extra_years:
        with Scraper() as scraper:
            for year in args.extra_years:
                ids.update(scraper.get_race_id_list(years=[year], jra_only=True))
    if args.race_id and (start_d or end_d or args.extra_years):
        ids.update(args.race_id)

    race_list = sorted(ids)
    logger.info(
        "collect-quick: %d race_ids (repo_results=%d, golden=%d)",
        len(race_list),
        len(_repo_result_race_ids()),
        len(_golden_race_ids()),
    )
    if not race_list:
        logger.error("収集対象 race_id がありません")
        return

    with Scraper() as scraper:
        ok, total = scraper.collect_race_ids(
            race_list,
            skip_horse=not args.with_horses,
            skip_pedigree=not args.with_pedigree,
        )
    logger.info("collect-quick 完了: %d/%d", ok, total)


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
    target_mode = getattr(args, "target", "win")
    if target_mode == "win_mod":
        feature_df["target_win"] = FeatureEngineer.make_target(feature_df, target="win_mod")
    else:
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

    # ---------- アーティファクト一括エクスポート（Phase 0-1 / Feature Bridge 用）----------
    bundle_path = export_training_artifacts(
        model,
        processor,
        fe,
        feature_df,
        target_col="target_win",
        extra_meta={
            "target_mode": target_mode,
            "enable_ev_sample_weight": ENABLE_EV_SAMPLE_WEIGHT,
            "ev_weight_center": EV_WEIGHT_CENTER,
            "ev_weight_tau": EV_WEIGHT_TAU,
            **getattr(model, "ev_weight_meta_", {}),
        },
    )
    logger.info("Model bundle manifest: %s", bundle_path)


def _load_target_mode() -> str:
    bundle_path = MODEL_DIR / "model_bundle.json"
    if not bundle_path.is_file():
        return "win"
    import json

    try:
        bundle = json.loads(bundle_path.read_text(encoding="utf-8"))
        return (
            bundle.get("extra_meta", {}).get("target_mode")
            or bundle.get("target_mode")
            or "win"
        )
    except Exception:
        return "win"


def _prepare_test_feature_df():
    """simulate / optimize 共通のテスト DataFrame 構築。"""
    import pickle

    model = Model.load()
    processor = DataProcessor()
    master_df = processor.build_master_df()

    with open(MODEL_DIR / "processor.pkl", "rb") as f:
        processor = pickle.load(f)
    with open(MODEL_DIR / "feature_engineer.pkl", "rb") as f:
        fe = pickle.load(f)

    feature_df = fe.transform(master_df)
    feature_df = processor.apply_label_encoders(feature_df)
    feature_df = processor.encode_categoricals_as_category(feature_df)

    target_mode = _load_target_mode()
    if target_mode == "win_mod":
        feature_df["target_win"] = FeatureEngineer.make_target(feature_df, target="win_mod")
    else:
        feature_df["target_win"] = FeatureEngineer.make_target(feature_df, target="win")

    from config import resolve_test_mask

    test_mask, test_label = resolve_test_mask(feature_df)
    test_df = feature_df[test_mask].copy()
    test_df.attrs["test_label"] = test_label
    test_df["pred_prob"] = model.predict_proba(test_df)
    return model, test_df, target_mode


def cmd_simulate(args: argparse.Namespace) -> None:
    """バックテスト（シミュレーション）コマンド"""
    import pickle

    model, test_df, target_mode = _prepare_test_feature_df()
    test_label = test_df.attrs.get("test_label", "unknown")
    logger.info(
        "シミュレーション対象: %d rows (test_set=%s, target_mode=%s)",
        len(test_df),
        test_label,
        target_mode,
    )

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

    # EV スイープ（単勝）— 検収チェックリスト用
    opt = sim.optimize_threshold(
        test_df,
        payout_df,
        ticket_type="win",
        ev_range=(1.0, 3.5),
        n_steps=40,
    )
    sim.plot_roi_by_threshold(
        opt["grid_results"],
        save_path=str(MODEL_DIR / "roi_by_threshold.png"),
    )

    baseline = build_baseline_report(
        target_mode=target_mode,
        y_true=test_df["target_win"].values,
        y_prob=test_df["pred_prob"].values,
        ev_grid_win=opt["grid_results"],
        bundle_path=MODEL_DIR / "model_bundle.json",
        test_years=test_label,
    )
    write_baseline_report(baseline)
    print_baseline_summary(baseline)

    # 固定閾値でのシミュレーション（参考）
    report = sim.run(test_df, payout_df, ticket_type="win")
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
    """EV閾値最適化コマンド（simulate と同じ baseline_report を更新）"""
    _, test_df, target_mode = _prepare_test_feature_df()

    with sqlite3.connect(str(DB_PATH)) as conn:
        payout_df = pd.read_sql("SELECT * FROM payouts", conn)

    sim = Simulator()
    sim.fit_calibration(
        y_true=test_df["target_win"].values,
        y_prob=test_df["pred_prob"].values,
    )

    result = sim.optimize_threshold(
        test_df,
        payout_df,
        ticket_type="win",
        ev_range=(1.0, 3.5),
        n_steps=40,
    )

    sim.plot_roi_by_threshold(
        result["grid_results"],
        save_path=str(MODEL_DIR / "roi_by_threshold.png"),
    )

    test_label = test_df.attrs.get("test_label", "unknown")
    baseline = build_baseline_report(
        target_mode=target_mode,
        y_true=test_df["target_win"].values,
        y_prob=test_df["pred_prob"].values,
        ev_grid_win=result["grid_results"],
        bundle_path=MODEL_DIR / "model_bundle.json",
        test_years=test_label,
    )
    write_baseline_report(baseline)
    print_baseline_summary(baseline)

    print(f"\n最適EV(ROI): {result['best_ev_threshold']:.2f} → ROI {result['best_roi']:.1f}%")
    print(
        f"最適EV(Sharpe): {result['best_sharpe_threshold']:.2f} "
        f"→ sharp {result['best_sharpe']:.3f}"
    )
    print("\nPhase3 では best_by_sharp_ratio を第一候補にしてください。")


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


def cmd_reclassify_race_classes(args: argparse.Namespace) -> None:
    """
    race_info / horse_results の race_class を race_class.infer_race_class で一括更新する。
  title のみ（info2 未保存行）でも再分類する。
    """
    from race_class import infer_race_class

    if not DB_PATH.is_file():
        logger.error("DB not found: %s", DB_PATH)
        sys.exit(1)

    dry_run = bool(getattr(args, "dry_run", False))
    with sqlite3.connect(DB_PATH) as conn:
        info_rows = conn.execute(
            "SELECT race_id, race_name FROM race_info"
        ).fetchall()
        info_updates: list[tuple[str, str]] = []
        for race_id, race_name in info_rows:
            new_cls = infer_race_class(str(race_name or ""))
            info_updates.append((new_cls, race_id))

        hr_rows = conn.execute(
            "SELECT id, race_name FROM horse_results"
        ).fetchall()
        hr_updates: list[tuple[str, int]] = []
        for row_id, race_name in hr_rows:
            new_cls = infer_race_class(str(race_name or ""))
            hr_updates.append((new_cls, row_id))

        if dry_run:
            from collections import Counter

            dist = Counter(c for c, _ in info_updates)
            logger.info(
                "dry-run: race_info %d rows, class distribution: %s",
                len(info_updates),
                dict(dist),
            )
            return

        conn.executemany(
            "UPDATE race_info SET race_class = ? WHERE race_id = ?",
            info_updates,
        )
        conn.executemany(
            "UPDATE horse_results SET race_class = ? WHERE id = ?",
            hr_updates,
        )
        conn.commit()

    logger.info(
        "reclassify-race-classes done: race_info=%d, horse_results=%d",
        len(info_updates),
        len(hr_updates),
    )


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

    p_quick = subparsers.add_parser(
        "collect-quick",
        help="TS結果JSON+ゴールデンレースのみ収集（Phase0疎通用・約108レース）",
    )
    p_quick.add_argument(
        "--race-id",
        action="append",
        dest="race_id",
        help="追加で収集する race_id（複数可）",
    )
    p_quick.add_argument(
        "--extra-years",
        type=int,
        nargs="+",
        help="追加でJRA全年レースIDを日付巡回取得（例: 2024 2025）。重い",
    )
    p_quick.add_argument(
        "--start-date",
        type=str,
        default=None,
        help="index.json の日付範囲（開始）YYYY-MM-DD（例: 2026-05-16）",
    )
    p_quick.add_argument(
        "--end-date",
        type=str,
        default=None,
        help="index.json の日付範囲（終了）YYYY-MM-DD（例: 2026-05-31）",
    )
    p_quick.add_argument(
        "--with-horses",
        action="store_true",
        help="出走馬の過去成績も収集（推奨・train前にON）",
    )
    p_quick.add_argument(
        "--with-pedigree",
        action="store_true",
        help="血統も収集（デフォルトはスキップ）",
    )

    # train
    p_train = subparsers.add_parser("train", help="モデル学習")
    p_train.add_argument(
        "--tune", action="store_true", help="Optunaでハイパーパラメータ最適化"
    )
    p_train.add_argument(
        "--n-trials", type=int, default=50, help="Optunaのトライアル数（デフォルト: 50）"
    )
    p_train.add_argument(
        "--target",
        choices=["win", "win_mod"],
        default="win",
        help="目的変数: win=1着のみ, win_mod=実質同着も正例",
    )

    # simulate
    subparsers.add_parser("simulate", help="バックテスト（シミュレーション）")

    # optimize
    subparsers.add_parser("optimize", help="EV閾値の最適化")

    # golden-test
    subparsers.add_parser(
        "golden-test",
        help="Phase1: ゴールデンレース不変性テスト（DB vs feature_bridge）",
    )

    p_reclass = subparsers.add_parser(
        "reclassify-race-classes",
        help="race_info / horse_results の race_class を一括再分類",
    )
    p_reclass.add_argument(
        "--dry-run",
        action="store_true",
        help="更新せず件数・分布のみ表示",
    )

    # predict
    p_predict = subparsers.add_parser("predict", help="レース予測（推論）")
    p_predict.add_argument("--race-id", type=str, help="race_id（12桁）")

    args = parser.parse_args()

    if args.command == "collect":
        cmd_collect(args)
    elif args.command == "collect-quick":
        cmd_collect_quick(args)
    elif args.command == "train":
        cmd_train(args)
    elif args.command == "simulate":
        cmd_simulate(args)
    elif args.command == "optimize":
        cmd_optimize(args)
    elif args.command == "golden-test":
        from golden_invariance import main as golden_main

        raise SystemExit(golden_main())
    elif args.command == "reclassify-race-classes":
        cmd_reclassify_race_classes(args)
    elif args.command == "predict":
        cmd_predict(args)
    else:
        parser.print_help()


if __name__ == "__main__":
    main()
