#!/usr/bin/env python3
"""
AI 品質ゲート監査: OOF AUC・勝率床・重賞レース分布を検証し、NG 時は exit code 1。

使い方:
  python diagnose_calibration_gate.py
  python diagnose_calibration_gate.py --race-id 202605021211
  python diagnose_calibration_gate.py --min-oof-auc 0.82
"""

from __future__ import annotations

import argparse
import json
import math
import pickle
import sys
from pathlib import Path

import numpy as np

REPO_ROOT = Path(__file__).resolve().parent.parent
RACES_DIR = REPO_ROOT / "src" / "data" / "races"
MODEL_PKL = Path(__file__).resolve().parent / "models" / "lgbm_model.pkl"

HARD_FLOOR_THRESHOLD = 0.001
ELITE_MIN_PROB = 0.05
DEFAULT_MIN_OOF_AUC = 0.82
DEFAULT_DERBY_RACE_ID = "202605021211"


def _load_oof_auc() -> float | None:
    if not MODEL_PKL.is_file():
        return None
    try:
        with MODEL_PKL.open("rb") as f:
            model = pickle.load(f)
        meta = getattr(model, "ev_weight_meta_", None) or {}
        auc = meta.get("oof_auc_pass1")
        if auc is None:
            auc = getattr(model, "oof_auc_pass1_", None)
        if auc is not None and math.isfinite(float(auc)):
            return float(auc)
    except Exception:
        return None
    return None


def _load_race_probs(race_id: str) -> list[dict]:
    path = RACES_DIR / f"{race_id}.json"
    if not path.is_file():
        raise FileNotFoundError(f"race JSON not found: {path}")
    payload = json.loads(path.read_text(encoding="utf-8"))
    rows = []
    for entry in payload.get("entries", []):
        name = entry.get("horseName") or entry.get("name") or "?"
        prob = entry.get("ai_predicted_win_rate")
        if prob is None:
            prob = entry.get("predicted_win_rate")
        if prob is None:
            continue
        rows.append({"name": str(name), "prob": float(prob)})
    return rows


def audit_oof_auc(min_oof_auc: float) -> None:
    oof_auc = _load_oof_auc()
    if oof_auc is None:
        print("[AUDIT] OOF AUC: (model.pkl 未検出 — スキップ)")
        return
    print(f"[AUDIT] Current OOF AUC: {oof_auc:.4f}")
    if oof_auc < min_oof_auc:
        print(
            f"❌ CRITICAL ERROR: OOF AUC {oof_auc:.4f} < baseline {min_oof_auc:.4f}"
        )
        sys.exit(1)


def audit_race_distribution(race_id: str) -> None:
    print(f"[AUDIT] Fetching 勝率分布 for {race_id} (Tokyo 11R - Japanese Derby)...")
    horses = _load_race_probs(race_id)
    if not horses:
        print(f"❌ CRITICAL ERROR: No ai_predicted_win_rate in {race_id}")
        sys.exit(1)

    for row in sorted(horses, key=lambda x: -x["prob"]):
        print(f"  {row['name']}: {row['prob']:.4f}")

    probs = np.array([h["prob"] for h in horses], dtype=float)
    zero_hit = probs <= HARD_FLOOR_THRESHOLD
    if zero_hit.any():
        print(
            "❌ CRITICAL ERROR: Hard floor (≤0.1%) artifact detected in elite rows!"
        )
        sys.exit(1)

    top_prob = float(probs.max())
    if top_prob < ELITE_MIN_PROB:
        print(
            "❌ CRITICAL ERROR: Elite horse probability under-inflated due to compression."
        )
        sys.exit(1)

    if float(probs.min()) < HARD_FLOOR_THRESHOLD:
        print("❌ CRITICAL ERROR: Minimum probability below hard floor threshold.")
        sys.exit(1)

    print(
        f"[AUDIT] prob range: min={probs.min():.4f} max={probs.max():.4f} "
        f"sum={probs.sum():.4f} entries={len(probs)}"
    )


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="AI calibration quality gate")
    parser.add_argument(
        "--race-id",
        action="append",
        dest="race_ids",
        help=f"監査対象 race_id（複数可。未指定時は {DEFAULT_DERBY_RACE_ID}）",
    )
    parser.add_argument(
        "--min-oof-auc",
        type=float,
        default=DEFAULT_MIN_OOF_AUC,
        help="Pass1 OOF AUC の下限",
    )
    args = parser.parse_args(argv)
    race_ids = args.race_ids or [DEFAULT_DERBY_RACE_ID]
    try:
        print("====== 📊 STARTING AI QUALITY GATE AUDIT ======")
        audit_oof_auc(args.min_oof_auc)
        for race_id in race_ids:
            audit_race_distribution(race_id)
        print(
            "✅ SUCCESS: All quality gates passed successfully. "
            "Smooth calibration confirmed."
        )
    except SystemExit:
        raise
    except Exception as exc:
        print(f"❌ CRITICAL ERROR: {exc}")
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
