"""
last_final3f 系の定数化を切り分けるための診断スクリプト。

実行:
    python debug_final3f_diagnostics.py
"""

from __future__ import annotations

import json
import sqlite3
from pathlib import Path

import numpy as np
import pandas as pd

from config import DB_PATH
from data_processor import DataProcessor
from feature_engineer import FeatureEngineer


def _to_dict(obj: object) -> dict:
    if isinstance(obj, dict):
        return obj
    return {}


def diagnose_db_final3f(conn: sqlite3.Connection) -> dict:
    total_rows = conn.execute("SELECT COUNT(*) FROM horse_results").fetchone()[0]
    null_or_zero = conn.execute(
        "SELECT COUNT(*) FROM horse_results WHERE final_3f IS NULL OR final_3f <= 0"
    ).fetchone()[0]
    valid_rows = total_rows - null_or_zero
    stats = conn.execute(
        """
        SELECT
            AVG(final_3f),
            MIN(final_3f),
            MAX(final_3f)
        FROM horse_results
        WHERE final_3f IS NOT NULL AND final_3f > 0
        """
    ).fetchone()
    q_rows = conn.execute(
        """
        SELECT final_3f
        FROM horse_results
        WHERE final_3f IS NOT NULL AND final_3f > 0
        ORDER BY final_3f
        """
    ).fetchall()
    arr = np.array([float(r[0]) for r in q_rows], dtype=float) if q_rows else np.array([])
    quantiles = (
        {
            "p01": float(np.quantile(arr, 0.01)),
            "p05": float(np.quantile(arr, 0.05)),
            "p50": float(np.quantile(arr, 0.50)),
            "p95": float(np.quantile(arr, 0.95)),
            "p99": float(np.quantile(arr, 0.99)),
        }
        if arr.size > 0
        else {}
    )
    return {
        "horse_results_total_rows": int(total_rows),
        "final_3f_null_or_zero_rows": int(null_or_zero),
        "final_3f_null_or_zero_ratio": float(null_or_zero / total_rows) if total_rows else 0.0,
        "final_3f_valid_rows": int(valid_rows),
        "final_3f_avg": float(stats[0]) if stats and stats[0] is not None else None,
        "final_3f_min": float(stats[1]) if stats and stats[1] is not None else None,
        "final_3f_max": float(stats[2]) if stats and stats[2] is not None else None,
        "final_3f_quantiles": quantiles,
    }


def diagnose_key_and_date_integrity(processor: DataProcessor) -> dict:
    race_df = processor.clean_race_results(processor.load_race_results())
    hr = processor.clean_horse_results(processor.load_horse_results())

    race_horses = set(race_df["horse_id"].astype(str))
    hr_horses = set(hr["horse_id"].astype(str))
    common_horses = race_horses & hr_horses

    # 対象レース行が「過去の有効final_3fを持つか」を判定
    hr_valid = hr[
        hr["horse_id"].notna()
        & hr["race_date"].notna()
        & hr["final_3f"].notna()
        & (pd.to_numeric(hr["final_3f"], errors="coerce") > 0)
    ][["horse_id", "race_date", "final_3f"]].copy()
    hr_valid = hr_valid.dropna(subset=["horse_id", "race_date"])
    hr_valid["horse_id"] = hr_valid["horse_id"].astype(str)
    hr_valid = hr_valid.sort_values(["race_date", "horse_id"])

    race_probe = race_df[["race_id", "horse_id", "race_date"]].copy()
    race_probe = race_probe.dropna(subset=["horse_id", "race_date"])
    race_probe["horse_id"] = race_probe["horse_id"].astype(str)
    race_probe = race_probe.sort_values(["race_date", "horse_id"])

    merged = pd.merge_asof(
        race_probe,
        hr_valid,
        on="race_date",
        by="horse_id",
        direction="backward",
        allow_exact_matches=False,
    )
    matched = int(merged["final_3f"].notna().sum())

    # 日付フォーマットの崩れ確認（NaT化）
    raw_hr = processor.load_horse_results()
    raw_hr_date_nat = int(pd.to_datetime(raw_hr["race_date"], errors="coerce").isna().sum())

    return {
        "race_results_rows": int(len(race_df)),
        "horse_results_rows": int(len(hr)),
        "race_unique_horses": int(len(race_horses)),
        "horse_results_unique_horses": int(len(hr_horses)),
        "horse_id_overlap_count": int(len(common_horses)),
        "horse_id_overlap_ratio_vs_race": float(len(common_horses) / len(race_horses)) if race_horses else 0.0,
        "rows_with_prior_valid_final3f": matched,
        "rows_with_prior_valid_final3f_ratio": float(matched / len(race_df)) if len(race_df) else 0.0,
        "rows_without_prior_valid_final3f": int(len(race_df) - matched),
        "horse_results_race_date_parse_nat_rows": raw_hr_date_nat,
    }


def diagnose_feature_engineer_flow(processor: DataProcessor) -> dict:
    race_df = processor.build_master_df()
    hr = processor.clean_horse_results(processor.load_horse_results())
    fe = FeatureEngineer(hr)
    out = fe.transform(race_df)

    # FeatureEngineer._add_speed_index の主要ステップを再計測
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
    hr_speed = hr[[c for c in hr_cols if c in hr.columns]].copy()
    hr_speed["race_date"] = pd.to_datetime(hr_speed["race_date"], errors="coerce")
    hr_speed["final_3f"] = pd.to_numeric(hr_speed["final_3f"], errors="coerce")
    n_before = int(len(hr_speed))
    hr_speed = hr_speed[hr_speed["final_3f"].notna() & (hr_speed["final_3f"] > 0)]
    n_after_valid = int(len(hr_speed))

    if "distance" in hr_speed.columns:
        hr_speed["distance_cat"] = FeatureEngineer._distance_cat_series(hr_speed["distance"])
    else:
        hr_speed["distance_cat"] = "中距離"
    for col in ("surface", "ground_state", "venue"):
        if col not in hr_speed.columns:
            hr_speed[col] = "不明"
        hr_speed[col] = hr_speed[col].fillna("不明").astype(str)

    hr_speed = hr_speed.sort_values(["horse_id", "race_date"])
    sgb = hr_speed.groupby("horse_id", sort=False)
    prev_run = hr_speed.copy()
    prev_run["last_final3f"] = sgb["final_3f"].shift(1)
    prev_run = prev_run.dropna(subset=["last_final3f"])
    n_prev = int(len(prev_run))

    asof_cols = ["horse_id", "race_date", "last_final3f"]
    prev_for_asof = prev_run[asof_cols].sort_values(["race_date", "horse_id"])
    prev_for_asof = prev_for_asof.dropna(subset=["horse_id", "race_date"])
    prev_for_asof["horse_id"] = prev_for_asof["horse_id"].astype(str)
    df_sorted = race_df.sort_values(["race_date", "horse_id"])[["race_id", "horse_id", "race_date"]].copy()
    df_sorted = df_sorted.dropna(subset=["horse_id", "race_date"])
    df_sorted["horse_id"] = df_sorted["horse_id"].astype(str)
    merged = pd.merge_asof(
        df_sorted,
        prev_for_asof,
        on="race_date",
        by="horse_id",
        direction="backward",
    )
    asof_match = int(merged["last_final3f"].notna().sum())

    feature_stats = {}
    for col in ("last_final3f", "avg_final3f", "final3f_rank", "last_final3f_z"):
        if col in out.columns:
            s = pd.to_numeric(out[col], errors="coerce")
            feature_stats[col] = {
                "mean": float(s.mean()) if s.notna().any() else None,
                "std": float(s.std()) if s.notna().any() else None,
                "nunique": int(s.nunique(dropna=True)),
                "na_ratio": float(s.isna().mean()),
            }

    return {
        "hr_speed_rows_before_valid_filter": n_before,
        "hr_speed_rows_after_valid_filter": n_after_valid,
        "prev_run_rows_after_shift_dropna": n_prev,
        "merge_asof_matched_rows": asof_match,
        "merge_asof_matched_ratio": float(asof_match / len(df_sorted)) if len(df_sorted) else 0.0,
        "feature_output_stats": feature_stats,
    }


def locate_default_fill_sources() -> dict:
    # 調査対象を固定（学習・推論パス）
    targets = {
        "feature_engineer.py": Path(__file__).resolve().parent / "feature_engineer.py",
        "feature_bridge.py": Path(__file__).resolve().parent / "feature_bridge.py",
    }
    needles = ["35.0", "fillna(", "last_final3f", "avg_final3f", "final3f_rank", "last_final3f_z"]
    out: dict[str, list[str]] = {}
    for name, path in targets.items():
        lines = path.read_text(encoding="utf-8").splitlines()
        hits: list[str] = []
        for i, line in enumerate(lines, start=1):
            if any(n in line for n in needles) and (
                "35.0" in line
                or "last_final3f" in line
                or "avg_final3f" in line
                or "final3f_rank" in line
                or "last_final3f_z" in line
            ):
                hits.append(f"L{i}: {line.strip()}")
        out[name] = hits
    return out


def main() -> None:
    if not Path(DB_PATH).is_file():
        raise FileNotFoundError(f"DB not found: {DB_PATH}")

    processor = DataProcessor(str(DB_PATH))
    with sqlite3.connect(DB_PATH) as conn:
        db_stats = diagnose_db_final3f(conn)
    key_date_stats = diagnose_key_and_date_integrity(processor)
    fe_flow_stats = diagnose_feature_engineer_flow(processor)
    fill_sources = locate_default_fill_sources()

    report = {
        "db_final3f": db_stats,
        "key_date_integrity": key_date_stats,
        "feature_engineer_flow": fe_flow_stats,
        "default_fill_sources": fill_sources,
    }
    print(json.dumps(report, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
