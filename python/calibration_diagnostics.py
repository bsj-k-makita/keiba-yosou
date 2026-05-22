#!/usr/bin/env python3
"""
AIバックフィル済みレースのキャリブレーション健全性を監査する。

主目的:
  - レース単位で ai_predicted_win_rate の分散を確認し、過収縮（横並び）を検知
  - ai_effective_ev のばらつきと合わせて、"高オッズ寄与だけでEVが散る" ケースを可視化

使い方:
  python calibration_diagnostics.py
  python calibration_diagnostics.py --race-id 202605021011
  python calibration_diagnostics.py --start-date 2026-05-01 --end-date 2026-05-31
"""

from __future__ import annotations

import argparse
import json
import math
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Any


REPO_ROOT = Path(__file__).resolve().parent.parent
RACES_DIR = REPO_ROOT / "src" / "data" / "races"
OUT_PATH = REPO_ROOT / "python" / "models" / "calibration_diagnostics.json"

TOP_N = 7
WIN_RATE_STDEV_THRESHOLD = 0.005


def _n(v: Any) -> float | None:
    try:
        x = float(v)
        return x if math.isfinite(x) else None
    except (TypeError, ValueError):
        return None


def _entry_ai_p(entry: dict[str, Any]) -> float | None:
    return _n(entry.get("ai_predicted_win_rate"))


def _entry_ai_ev(entry: dict[str, Any]) -> float | None:
    return _n(entry.get("ai_effective_ev"))


def _mean(xs: list[float]) -> float:
    if not xs:
        return 0.0
    return sum(xs) / len(xs)


def _stdev_population(xs: list[float]) -> float:
    if len(xs) <= 1:
        return 0.0
    m = _mean(xs)
    return math.sqrt(sum((x - m) ** 2 for x in xs) / len(xs))


@dataclass
class RaceDiag:
    race_id: str
    date: str
    venue: str
    race_number: int
    race_name: str
    race_grade: str | None
    entries: int
    ai_ready_entries: int
    ai_full_ready: bool
    stdev_prob_all: float
    stdev_prob_topn_by_ev: float
    stdev_ev_topn: float
    max_ev_topn: float
    min_ev_topn: float
    flagged_winrate_flat: bool


def _race_diag(path: Path) -> RaceDiag | None:
    raw = json.loads(path.read_text(encoding="utf-8"))
    entries = raw.get("entries") or []
    if not isinstance(entries, list) or len(entries) == 0:
        return None

    ai_rows: list[dict[str, float]] = []
    for e in entries:
        p = _entry_ai_p(e)
        ev = _entry_ai_ev(e)
        if p is None or ev is None:
            continue
        ai_rows.append({"p": p, "ev": ev})

    ai_ready_entries = len(ai_rows)
    ai_full_ready = ai_ready_entries == len(entries)
    if ai_ready_entries == 0:
        return None

    all_ps = [r["p"] for r in ai_rows]
    top = sorted(ai_rows, key=lambda r: r["ev"], reverse=True)[: min(TOP_N, len(ai_rows))]
    top_ps = [r["p"] for r in top]
    top_evs = [r["ev"] for r in top]

    meta = raw.get("meta") or raw.get("raceInfo") or {}
    race_id = str(raw.get("raceId") or path.stem)
    date = str(meta.get("date") or "")
    venue = str(meta.get("venue") or "")
    race_number = int(meta.get("raceNumber") or 0)
    race_name = str(meta.get("raceName") or "")
    race_grade = meta.get("raceGrade")
    race_grade = str(race_grade) if race_grade is not None else None

    stdev_prob_topn = _stdev_population(top_ps)
    return RaceDiag(
        race_id=race_id,
        date=date,
        venue=venue,
        race_number=race_number,
        race_name=race_name,
        race_grade=race_grade,
        entries=len(entries),
        ai_ready_entries=ai_ready_entries,
        ai_full_ready=ai_full_ready,
        stdev_prob_all=round(_stdev_population(all_ps), 6),
        stdev_prob_topn_by_ev=round(stdev_prob_topn, 6),
        stdev_ev_topn=round(_stdev_population(top_evs), 6),
        max_ev_topn=round(max(top_evs), 6),
        min_ev_topn=round(min(top_evs), 6),
        flagged_winrate_flat=stdev_prob_topn < WIN_RATE_STDEV_THRESHOLD,
    )


def _in_date_range(date_str: str, start_date: str | None, end_date: str | None) -> bool:
    if not date_str:
        return False
    if start_date and date_str < start_date:
        return False
    if end_date and date_str > end_date:
        return False
    return True


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description="Audit AI calibration shrinkage by race")
    p.add_argument("--race-id", action="append", help="対象 race_id（複数指定可）")
    p.add_argument("--start-date", type=str, default=None, help="YYYY-MM-DD")
    p.add_argument("--end-date", type=str, default=None, help="YYYY-MM-DD")
    p.add_argument("--head", type=int, default=20, help="表示件数（stdev昇順）")
    return p.parse_args()


def main() -> int:
    args = parse_args()

    if args.race_id:
        ids = set(str(x) for x in args.race_id)
        files = [RACES_DIR / f"{rid}.json" for rid in sorted(ids)]
    else:
        files = sorted(RACES_DIR.glob("*.json"))

    rows: list[RaceDiag] = []
    for fp in files:
        if not fp.is_file():
            continue
        d = _race_diag(fp)
        if d is None:
            continue
        if args.start_date or args.end_date:
            if not _in_date_range(d.date, args.start_date, args.end_date):
                continue
        rows.append(d)

    if not rows:
        print("No diagnosable races found.")
        return 1

    flagged = [r for r in rows if r.flagged_winrate_flat]
    sorted_by_stdev = sorted(rows, key=lambda r: r.stdev_prob_topn_by_ev)
    head_n = max(1, int(args.head))

    payload = {
        "thresholds": {
            "top_n": TOP_N,
            "win_rate_stdev_threshold": WIN_RATE_STDEV_THRESHOLD,
        },
        "summary": {
            "races": len(rows),
            "flagged_winrate_flat": len(flagged),
            "flagged_ratio": round(len(flagged) / len(rows), 4),
        },
        "lowest_stdev_races": [asdict(r) for r in sorted_by_stdev[:head_n]],
        "highest_stdev_races": [asdict(r) for r in sorted(rows, key=lambda r: r.stdev_prob_topn_by_ev, reverse=True)[:head_n]],
        "all_races": [asdict(r) for r in sorted(rows, key=lambda r: (r.date, r.venue, r.race_number, r.race_id))],
    }
    OUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    OUT_PATH.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    print(
        "calibration_diagnostics:"
        f" races={len(rows)}"
        f" flagged_winrate_flat={len(flagged)}"
        f" ratio={len(flagged)/len(rows):.2%}"
    )
    print(f"written: {OUT_PATH}")
    print("\nlowest stdev races:")
    for r in sorted_by_stdev[:head_n]:
        print(
            f"  {r.race_id} {r.date} {r.venue}{r.race_number}R"
            f" stdev_p_top{TOP_N}={r.stdev_prob_topn_by_ev:.6f}"
            f" stdev_ev_top{TOP_N}={r.stdev_ev_topn:.6f}"
            f" max_ev={r.max_ev_topn:.4f}"
            f" grade={r.race_grade or '-'}"
        )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

