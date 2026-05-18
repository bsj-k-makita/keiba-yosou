"""
学習完了時に推論用アーティファクトを models/ へ一括エクスポートする。

Feature Bridge（Phase 1）では DB なしで:
  - label_encoders（processor.pkl 内）
  - entity_stats_snapshot.pkl（騎手・調教師等の累積統計スナップショット）
  - feature_manifest.json（列順・デフォルト値）
  - lgbm_model.pkl
を参照する。
"""

from __future__ import annotations

import json
import logging
import pickle
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import numpy as np
import pandas as pd

from config import MODEL_DIR
from model import FEATURE_COLS, Model

logger = logging.getLogger(__name__)

BUNDLE_VERSION = "1.0.0"

# entity_id 列 → feature_df 内の累積統計列
ENTITY_STAT_SPECS: dict[str, list[str]] = {
    "jockey_id": ["jockey_win_rate", "jockey_top3_rate"],
    "trainer_id": ["trainer_win_rate", "trainer_top3_rate"],
}

# カテゴリ列（LabelEncoder 適用後のスナップショット用・raw 値で最終行を保持）
ENTITY_CATEGORY_COLS = ["sire", "dam_sire"]


def _utc_now_iso() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


def build_entity_stats_snapshot(feature_df: pd.DataFrame) -> dict[str, Any]:
    """
    学習データ全体の「最終時点」累積統計を entity ごとにスナップショット化。
    推論時は race_date 以前の厳密再現ではなく、学習終了時点マスターとして参照する。
    （Phase 1 Bridge: TS JSON から ID/名前で lookup）
    """
    if "race_date" not in feature_df.columns:
        feature_df = feature_df.copy()
        feature_df["race_date"] = pd.Timestamp("1970-01-01")

    df = feature_df.sort_values("race_date")
    snapshot: dict[str, Any] = {
        "jockeys": {},
        "trainers": {},
        "pedigree": {},
        "global_defaults": {},
    }

    for entity_col, stat_cols in ENTITY_STAT_SPECS.items():
        if entity_col not in df.columns:
            continue
        present_cols = [c for c in stat_cols if c in df.columns]
        if not present_cols:
            continue

        bucket_key = "jockeys" if entity_col == "jockey_id" else "trainers"
        last_rows = df.groupby(entity_col, as_index=False).tail(1)
        for _, row in last_rows.iterrows():
            eid = str(row[entity_col])
            if not eid or eid == "nan":
                continue
            entry: dict[str, float] = {}
            for col in present_cols:
                val = row[col]
                if pd.notna(val) and np.isfinite(val):
                    entry[col] = float(val)
            if entry:
                snapshot[bucket_key][eid] = entry

    for col in ENTITY_CATEGORY_COLS:
        if col not in df.columns:
            continue
        last_rows = df.groupby(col, as_index=False).tail(1)
        for _, row in last_rows.iterrows():
            key = str(row[col])
            if not key or key == "nan":
                continue
            snapshot["pedigree"][key] = {"raw": key}

    # 欠損フォールバック用（学習セット中央値）
    for col in [
        "jockey_win_rate",
        "jockey_top3_rate",
        "trainer_win_rate",
        "trainer_top3_rate",
        "horse_win_rate",
        "horse_top3_rate",
    ]:
        if col in df.columns:
            med = df[col].median()
            if pd.notna(med):
                snapshot["global_defaults"][col] = float(med)

    logger.info(
        "entity_stats_snapshot: jockeys=%d trainers=%d pedigree=%d",
        len(snapshot["jockeys"]),
        len(snapshot["trainers"]),
        len(snapshot["pedigree"]),
    )
    return snapshot


def build_feature_manifest(
    model: Model,
    feature_df: pd.DataFrame,
    target_col: str = "target_win",
) -> dict[str, Any]:
    """推論時に使用する特徴量列の固定順序とメタ情報。"""
    feature_cols = model._available_features(feature_df)
    dtypes: dict[str, str] = {}
    for col in feature_cols:
        if col in feature_df.columns:
            dtypes[col] = str(feature_df[col].dtype)

    return {
        "bundle_version": BUNDLE_VERSION,
        "feature_cols": feature_cols,
        "feature_cols_full": FEATURE_COLS,
        "dtypes": dtypes,
        "target_col": target_col,
        "row_count_train": int(len(feature_df)),
        "categorical_unknown_token": "不明",
    }


def export_training_artifacts(
    model: Model,
    processor: Any,
    feature_engineer: Any,
    feature_df: pd.DataFrame,
    *,
    target_col: str = "target_win",
    extra_meta: dict[str, Any] | None = None,
) -> Path:
    """
    train 完了後に models/ へ一式を書き出す。
    戻り値: bundle メタ JSON のパス
    """
    MODEL_DIR.mkdir(parents=True, exist_ok=True)

    model_path = model.save()

    proc_path = MODEL_DIR / "processor.pkl"
    with proc_path.open("wb") as f:
        pickle.dump(processor, f)

    fe_path = MODEL_DIR / "feature_engineer.pkl"
    with fe_path.open("wb") as f:
        pickle.dump(feature_engineer, f)

    entity_stats = build_entity_stats_snapshot(feature_df)
    stats_path = MODEL_DIR / "entity_stats_snapshot.pkl"
    with stats_path.open("wb") as f:
        pickle.dump(entity_stats, f)

    manifest = build_feature_manifest(model, feature_df, target_col=target_col)
    manifest_path = MODEL_DIR / "feature_manifest.json"
    manifest_path.write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )

    bundle_meta = {
        "bundle_version": BUNDLE_VERSION,
        "created_at": _utc_now_iso(),
        "target_col": target_col,
        "artifacts": {
            "model": str(model_path),
            "processor": str(proc_path),
            "feature_engineer": str(fe_path),
            "entity_stats_snapshot": str(stats_path),
            "feature_manifest": str(manifest_path),
        },
        "train_rows": int(len(feature_df)),
        "test_years_note": "評価は main.py simulate で TEST_YEARS を使用",
        **(extra_meta or {}),
    }
    bundle_path = MODEL_DIR / "model_bundle.json"
    bundle_path.write_text(
        json.dumps(bundle_meta, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )

    logger.info("Training artifacts exported to %s", MODEL_DIR)
    return bundle_path


def load_entity_stats_snapshot(path: Path | None = None) -> dict[str, Any]:
    p = path or (MODEL_DIR / "entity_stats_snapshot.pkl")
    with p.open("rb") as f:
        return pickle.load(f)


def lookup_entity_stat(
    snapshot: dict[str, Any],
    bucket: str,
    entity_id: str,
    stat_col: str,
) -> float | None:
    """推論 Bridge 用: jockeys/trainers バケットから統計を取得。"""
    bucket_map = snapshot.get(bucket, {})
    entry = bucket_map.get(str(entity_id))
    if not entry:
        return snapshot.get("global_defaults", {}).get(stat_col)
    return entry.get(stat_col) or snapshot.get("global_defaults", {}).get(stat_col)
