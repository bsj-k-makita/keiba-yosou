#!/usr/bin/env python3
"""
Phase 1: LightGBM + Isotonic キャリブレーション予測を src/data/races/*.json にバックフィルする。

パイプライン（レース単位）:
  1. LightGBM 生予測 (raw_pred)
  2. betting_evaluator.pkl の Isotonic/Platt でキャリブレーション
  3. レース内で合計 1 に正規化 → ai_predicted_win_rate
  4. ai_effective_ev = P × O - margin（margin=0.15）

前提:
  - python/main.py train 後に lgbm_model.pkl
  - python/main.py simulate 後に betting_evaluator.pkl（キャリブレーター学習済み）

使い方:
  cd 競馬最強予想ファイルの改善版
  python3 scripts/backfill-ai-predictions.py
  python3 scripts/backfill-ai-predictions.py --race-id 202604010601
"""

from __future__ import annotations

import argparse
import json
import sys
from dataclasses import dataclass
from pathlib import Path

import numpy as np

REPO_ROOT = Path(__file__).resolve().parent.parent
PYTHON_DIR = REPO_ROOT / "python"
sys.path.insert(0, str(PYTHON_DIR))

from config import MODEL_DIR  # noqa: E402
from betting_evaluator import BettingEvaluator  # noqa: E402
from feature_bridge import (  # noqa: E402
    build_features_for_race,
    load_entity_stats_snapshot,
)
from model import Model  # noqa: E402

TS_RACES_DIR = REPO_ROOT / "src" / "data" / "races"
INDEX_PATH = REPO_ROOT / "src" / "data" / "index.json"
EV_MARGIN = 0.15


@dataclass(frozen=True)
class BackfillArtifacts:
    model: Model
    evaluator: BettingEvaluator
    calibration_method: str


def _load_index_dates() -> dict[str, str]:
    if not INDEX_PATH.is_file():
        return {}
    rows = json.loads(INDEX_PATH.read_text(encoding="utf-8"))
    return {
        str(r["raceId"]): str(r.get("date") or "")
        for r in rows
        if r.get("raceId")
    }


def _race_date_for_filter(race_id: str, race_json: dict | None, index_dates: dict[str, str]) -> str:
    if race_json:
        d = str((race_json.get("raceInfo") or {}).get("date") or "")
        if d:
            return d
    return index_dates.get(race_id, "")


def load_backfill_artifacts() -> BackfillArtifacts:
    """
    学習済み LightGBM とキャリブレーション済み BettingEvaluator を読み込む。

    processor.pkl には Isotonic は含まれないため、
    必ず betting_evaluator.pkl（simulate 後）を使用する。
    """
    model_path = MODEL_DIR / "lgbm_model.pkl"
    evaluator_path = MODEL_DIR / "betting_evaluator.pkl"

    if not model_path.is_file():
        raise FileNotFoundError(
            f"{model_path} がありません。先に `python main.py train` を実行してください。"
        )
    if not evaluator_path.is_file():
        raise FileNotFoundError(
            f"{evaluator_path} がありません。"
            " キャリブレーション学習のため `python main.py simulate` を実行してから再試行してください。"
        )

    model = Model.load(str(model_path))
    evaluator = BettingEvaluator.load(str(evaluator_path))
    method = getattr(evaluator, "_calibration_method", "unknown")
    print(f"Loaded calibrator: method={method} ({evaluator_path.name})")
    return BackfillArtifacts(model=model, evaluator=evaluator, calibration_method=method)


def compute_race_entry_predictions(
    df,
    model: Model,
    evaluator: BettingEvaluator,
) -> tuple[dict[int, float], dict[int, float]]:
    """
    特徴量 DataFrame からキャリブレーション済み勝率と EV を馬番キーで返す。

    raw_pred は JSON に書かず、calibrated → normalized のみを ai_predicted_win_rate に使う。
    """
    feature_cols = getattr(model, "feature_cols_", None)
    if not feature_cols:
        raise ValueError("model.feature_cols_ が未設定です。train を再実行してください。")

    X = df[feature_cols]
    raw_preds = np.asarray(model.predict_proba(X), dtype=float)
    ai_win_rates = evaluator.calibrated_normalized_probs(raw_preds)

    pred_by_horse: dict[int, float] = {}
    odds_by_horse: dict[int, float] = {}
    for i, row in df.reset_index(drop=True).iterrows():
        hn = int(row["horse_number"])
        prob = float(ai_win_rates[i])
        pred_by_horse[hn] = prob
        o = row.get("odds")
        odds_by_horse[hn] = (
            float(o) if o is not None and np.isfinite(o) and o > 0 else 0.0
        )

    return pred_by_horse, odds_by_horse


def effective_ev_from_prob(prob: float, odds: float, margin: float = EV_MARGIN) -> float:
    """実質 EV = P × O - margin（オッズ欠損時は -margin）。"""
    if odds <= 0 or not np.isfinite(odds):
        return -margin
    return prob * odds - margin


def backfill_one_race(
    race_id: str,
    artifacts: BackfillArtifacts,
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

    try:
        pred_by_horse, odds_by_horse = compute_race_entry_predictions(
            df,
            artifacts.model,
            artifacts.evaluator,
        )
    except RuntimeError as e:
        print(f"[error] {race_id}: {e}")
        return False

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
            effective_ev_from_prob(rate, odds, EV_MARGIN),
            4,
        )
        updated += 1

    if updated == 0:
        print(f"[skip] no entries matched: {race_id}")
        return False

    prob_sum = round(sum(pred_by_horse.values()), 4)
    if abs(prob_sum - 1.0) > 0.05:
        print(f"[warn] {race_id}: calibrated prob sum={prob_sum} (expected ~1.0)")

    if dry_run:
        print(f"[dry-run] {race_id}: {updated} entries, prob_sum={prob_sum}")
        return True

    temp_path = json_path.with_suffix(".tmp")
    with temp_path.open("w", encoding="utf-8") as f:
        json.dump(race_json, f, ensure_ascii=False, indent=2)
        f.write("\n")
    temp_path.replace(json_path)
    print(f"[ok] {race_id}: {updated} entries (calibrated, sum={prob_sum})")
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
    parser.add_argument("--start-date", type=str, default=None, help="raceInfo.date >= YYYY-MM-DD")
    parser.add_argument("--end-date", type=str, default=None, help="raceInfo.date <= YYYY-MM-DD")
    args = parser.parse_args()

    try:
        artifacts = load_backfill_artifacts()
    except (FileNotFoundError, RuntimeError, TypeError) as e:
        print(f"Error: {e}")
        return 1

    snapshot = load_entity_stats_snapshot()

    if args.race_id:
        race_ids = sorted(set(args.race_id))
    else:
        race_ids = sorted(
            p.stem for p in TS_RACES_DIR.glob("*.json") if p.stem.isdigit() and len(p.stem) == 12
        )

    if args.start_date or args.end_date:
        index_dates = _load_index_dates()
        filtered: list[str] = []
        for race_id in race_ids:
            json_path = TS_RACES_DIR / f"{race_id}.json"
            data = None
            if json_path.is_file():
                data = json.loads(json_path.read_text(encoding="utf-8"))
            d = _race_date_for_filter(race_id, data, index_dates)
            if not d:
                continue
            if args.start_date and d < args.start_date:
                continue
            if args.end_date and d > args.end_date:
                continue
            filtered.append(race_id)
        race_ids = filtered

    print(
        f"Backfill targets: {len(race_ids)} races "
        f"(calibration={artifacts.calibration_method}, prefer_db={not args.ts_only})"
    )

    ok = 0
    for race_id in race_ids:
        try:
            if backfill_one_race(
                race_id,
                artifacts,
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
