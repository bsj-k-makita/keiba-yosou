#!/usr/bin/env python3
"""
Phase 1 Step 1: LightGBM + Isotonic 予測を src/data/races/*.json にバックフィルする。

追記フィールド（既存フィールドは上書きしない）:
  - ai_predicted_win_rate
  - ai_effective_ev  (= ai_predicted_win_rate * odds - margin)

使い方:
  cd 競馬最強予想ファイルの改善版
  python3 scripts/backfill-ai-predictions.py
  python3 scripts/backfill-ai-predictions.py --race-id 202604010601
"""

from __future__ import annotations

import argparse
import json
import pickle
import sys
from pathlib import Path

import numpy as np

REPO_ROOT = Path(__file__).resolve().parent.parent
PYTHON_DIR = REPO_ROOT / "python"
sys.path.insert(0, str(PYTHON_DIR))

from config import MODEL_DIR  # noqa: E402
from feature_bridge import (  # noqa: E402
    build_features_for_race,
    load_entity_stats_snapshot,
)
from model import Model  # noqa: E402

TS_RACES_DIR = REPO_ROOT / "src" / "data" / "races"
EV_MARGIN = 0.15


def _normalize_race_probs(calibrated: np.ndarray) -> np.ndarray:
    total = float(np.sum(calibrated))
    if total < 1e-9:
        return np.ones_like(calibrated) / len(calibrated)
    return calibrated / total


def backfill_one_race(
    race_id: str,
    model: Model,
    evaluator,
    snapshot: dict,
    *,
    prefer_db: bool = True,
    dry_run: bool = False,
) -> bool:
    json_path = TS_RACES_DIR / f"{race_id}.json"
    if not json_path.is_file():
        print(f"[skip] JSON not found: {race_id}")
        return False

    df = build_features_for_race(race_id, entity_stats_snapshot=snapshot, prefer_db=prefer_db)
    if df is None or df.empty:
        print(f"[skip] no features: {race_id}")
        return False

    feature_cols = getattr(model, "feature_cols_", None)
    if not feature_cols:
        print(f"[skip] model has no feature_cols_: {race_id}")
        return False

    X = df[feature_cols]
    raw_preds = model.predict_proba(X)
    calibrated = evaluator._apply_calibration(np.asarray(raw_preds, dtype=float))
    ai_win_rates = _normalize_race_probs(calibrated)

    pred_by_horse: dict[int, float] = {}
    odds_by_horse: dict[int, float] = {}
    for i, row in df.reset_index(drop=True).iterrows():
        hn = int(row["horse_number"])
        pred_by_horse[hn] = float(ai_win_rates[i])
        o = row.get("odds")
        odds_by_horse[hn] = float(o) if o is not None and np.isfinite(o) and o > 0 else 0.0

    with json_path.open(encoding="utf-8") as f:
        race_json = json.load(f)

    updated = 0
    for entry in race_json.get("entries", []):
        hn = int(entry.get("horseNumber") or entry.get("gate") or 0)
        if hn not in pred_by_horse:
            continue
        rate = pred_by_horse[hn]
        odds = odds_by_horse.get(hn, 0.0)
        entry["ai_predicted_win_rate"] = round(rate, 4)
        entry["ai_effective_ev"] = round(
            (rate * odds - EV_MARGIN) if odds > 0 else -EV_MARGIN,
            4,
        )
        updated += 1

    if updated == 0:
        print(f"[skip] no entries matched: {race_id}")
        return False

    if dry_run:
        print(f"[dry-run] {race_id}: updated {updated} entries")
        return True

    temp_path = json_path.with_suffix(".tmp")
    with temp_path.open("w", encoding="utf-8") as f:
        json.dump(race_json, f, ensure_ascii=False, indent=2)
        f.write("\n")
    temp_path.replace(json_path)
    print(f"[ok] {race_id}: {updated} entries")
    return True


def main() -> int:
    parser = argparse.ArgumentParser(description="Backfill AI predictions into race JSON")
    parser.add_argument("--race-id", action="append", help="対象 race_id（省略時は全12桁JSON）")
    parser.add_argument("--dry-run", action="store_true", help="書き込まず検証のみ")
    parser.add_argument(
        "--ts-only",
        action="store_true",
        help="DB を使わず TS JSON Bridge のみ（parity 検証用）",
    )
    args = parser.parse_args()

    model_path = MODEL_DIR / "lgbm_model.pkl"
    evaluator_path = MODEL_DIR / "betting_evaluator.pkl"
    if not model_path.is_file():
        print(f"Error: {model_path} がありません。先に python main.py train を実行してください。")
        return 1
    if not evaluator_path.is_file():
        print(f"Warning: {evaluator_path} がありません。simulate 後に再実行を推奨。")

    model = Model.load(str(model_path))
    evaluator = None
    if evaluator_path.is_file():
        with evaluator_path.open("rb") as f:
            evaluator = pickle.load(f)
    else:
        from betting_evaluator import BettingEvaluator
        evaluator = BettingEvaluator(margin=EV_MARGIN)

    snapshot = load_entity_stats_snapshot()

    if args.race_id:
        race_ids = sorted(set(args.race_id))
    else:
        race_ids = sorted(p.stem for p in TS_RACES_DIR.glob("*.json") if p.stem.isdigit() and len(p.stem) == 12)

    print(f"Backfill targets: {len(race_ids)} races (prefer_db={not args.ts_only})")

    ok = 0
    for race_id in race_ids:
        try:
            if backfill_one_race(
                race_id,
                model,
                evaluator,
                snapshot,
                prefer_db=not args.ts_only,
                dry_run=args.dry_run,
            ):
                ok += 1
        except Exception as e:
            print(f"[error] {race_id}: {e}")

    print(f"\nDone: {ok}/{len(race_ids)} races updated.")
    return 0 if ok > 0 else 1


if __name__ == "__main__":
    raise SystemExit(main())
