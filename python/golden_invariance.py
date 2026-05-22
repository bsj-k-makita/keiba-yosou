#!/usr/bin/env python3
"""
Phase 1 ゴールデンレース不変性テスト。

  python golden_invariance.py

前提:
  - python main.py collect && train 済み（keiba.db + models/）
  - golden_races.json の race_id は src/data/races + results 両方あり

DB 正解行 vs TS feature_bridge 行を突合。Bridge 未実装時は
「DB のみ取得できた」ステータスを返し、Phase 1 着手前のゲートとして使う。
"""

from __future__ import annotations

import json
import logging
import sys
from collections import Counter
from pathlib import Path

from config import DB_PATH, MODEL_DIR
from feature_bridge import (
    GOLDEN_RACES_PATH,
    build_features_from_db,
    build_features_from_ts_json,
    compare_feature_frames,
    load_golden_race_ids,
)
from model import FEATURE_COLS

logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
logger = logging.getLogger("golden_invariance")


def load_manifest_cols() -> list[str]:
    manifest_path = MODEL_DIR / "feature_manifest.json"
    if manifest_path.is_file():
        data = json.loads(manifest_path.read_text(encoding="utf-8"))
        cols = list(data.get("feature_cols", FEATURE_COLS))
    else:
        cols = list(FEATURE_COLS)
    # 照合キーは compare_feature_frames 側で使うため、特徴量比較対象からは除外。
    return [c for c in cols if c not in {"horse_number"}]


def main() -> int:
    golden = json.loads(GOLDEN_RACES_PATH.read_text(encoding="utf-8"))
    race_ids = load_golden_race_ids()
    feature_cols = load_manifest_cols()

    if not DB_PATH.is_file():
        logger.error("keiba.db がありません: %s — 先に python main.py collect", DB_PATH)
        return 1

    results_summary: list[dict] = []
    bridge_ready = 0
    db_only = 0
    failed = 0
    mismatch_counter: Counter[str] = Counter()

    for entry in golden["races"]:
        race_id = entry["race_id"]
        label = entry.get("label", race_id)
        db_df = build_features_from_db(race_id)
        ts_df = build_features_from_ts_json(race_id, parity_use_db=True)

        if db_df is None:
            logger.warning("[%s] DB 行なし", race_id)
            results_summary.append({"race_id": race_id, "label": label, "status": "db_missing"})
            failed += 1
            continue

        if ts_df is None:
            logger.info("[%s] DB OK (%d rows), Bridge 未実装", race_id, len(db_df))
            results_summary.append({
                "race_id": race_id,
                "label": label,
                "status": "bridge_pending",
                "db_rows": len(db_df),
            })
            db_only += 1
            continue

        cmp = compare_feature_frames(db_df, ts_df, feature_cols)
        status = "pass" if cmp.get("ok") else "fail"
        logger.info("[%s] invariance %s (horses=%s)", race_id, status, cmp.get("n_horses"))
        results_summary.append({"race_id": race_id, "label": label, "status": status, **cmp})
        if status == "pass":
            bridge_ready += 1
        else:
            failed += 1
            for m in cmp.get("mismatches", []):
                if m.get("reason") == "missing_column":
                    continue
                col = str(m.get("col") or "unknown")
                mismatch_counter[col] += 1

    out_path = MODEL_DIR / "golden_invariance_report.json"
    out_path.parent.mkdir(parents=True, exist_ok=True)
    payload = {
        "n_races": len(race_ids),
        "bridge_pass": bridge_ready,
        "bridge_pending": db_only,
        "failed": failed,
        "mismatch_top_columns": mismatch_counter.most_common(20),
        "races": results_summary,
    }
    out_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    print("\n" + "=" * 60)
    print("Golden Race Invariance Report")
    print(f"  pass={bridge_ready}  pending(bridge未実装)={db_only}  fail={failed}")
    if mismatch_counter:
        top = ", ".join(f"{k}:{v}" for k, v in mismatch_counter.most_common(8))
        print(f"  mismatch_top_columns: {top}")
    print(f"  written: {out_path}")
    print("=" * 60)

    return 0 if failed == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
