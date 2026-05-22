"""
TS 側 race JSON の pastRuns.final3fSec を使って
SQLite (horse_results.final_3f) をフォールバック補完する。

使い方:
  python backfill_final3f_from_ts.py
  python backfill_final3f_from_ts.py --dry-run
"""

from __future__ import annotations

import argparse
import json
import logging
import sqlite3
from dataclasses import dataclass
from pathlib import Path

from tqdm import tqdm

from config import DB_PATH

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class PastRunRecord:
    horse_id: str
    race_date: str  # YYYY-MM-DD
    race_number: int
    race_name: str
    race_id: str
    venue: str
    surface: str
    final_3f: float
    finish_pos: int | None
    race_class: str


def _normalize_date(s: str) -> str | None:
    if not s:
        return None
    x = str(s).strip().replace("/", "-").replace(".", "-")
    parts = x.split("-")
    if len(parts) != 3:
        return None
    y, m, d = parts
    if not (y.isdigit() and m.isdigit() and d.isdigit()):
        return None
    return f"{int(y):04d}-{int(m):02d}-{int(d):02d}"


def _race_number_from_race_id(race_id: str) -> int | None:
    rid = str(race_id or "").strip()
    if len(rid) >= 2 and rid[-2:].isdigit():
        return int(rid[-2:])
    return None


def _valid_final3f(v: object) -> float | None:
    try:
        x = float(v)
    except (TypeError, ValueError):
        return None
    if 20.0 <= x <= 60.0:
        return x
    return None


def collect_records_from_ts(races_dir: Path) -> tuple[list[PastRunRecord], dict[str, int]]:
    records: dict[tuple[str, str, int, str], PastRunRecord] = {}
    stats = {
        "json_files": 0,
        "entries": 0,
        "past_runs_seen": 0,
        "past_runs_valid_final3f": 0,
    }

    paths = sorted(races_dir.glob("*.json"))
    for p in tqdm(paths, desc="scan ts races", unit="file"):
        stats["json_files"] += 1
        try:
            payload = json.loads(p.read_text(encoding="utf-8"))
        except Exception:
            continue
        entries = payload.get("entries") or []
        stats["entries"] += len(entries)

        for e in entries:
            horse_id = str(e.get("horseId") or e.get("horse_id") or "").strip()
            if not horse_id:
                continue
            for run in (e.get("pastRuns") or []):
                stats["past_runs_seen"] += 1
                f3 = _valid_final3f(run.get("final3fSec"))
                if f3 is None:
                    continue
                race_date = _normalize_date(str(run.get("date") or ""))
                race_id = str(run.get("raceId") or "").strip()
                race_number = _race_number_from_race_id(race_id)
                race_name = str(run.get("raceName") or "").strip()
                if race_date is None or race_number is None:
                    continue
                finish_pos = None
                try:
                    place = run.get("place")
                    if place is not None:
                        finish_pos = int(place)
                except (TypeError, ValueError):
                    finish_pos = None

                key = (horse_id, race_date, race_number, race_name)
                records[key] = PastRunRecord(
                    horse_id=horse_id,
                    race_date=race_date,
                    race_number=race_number,
                    race_name=race_name,
                    race_id=race_id,
                    venue=str(run.get("venue") or ""),
                    surface=str(run.get("surface") or ""),
                    final_3f=f3,
                    finish_pos=finish_pos,
                    race_class=str(run.get("raceClass") or ""),
                )
                stats["past_runs_valid_final3f"] += 1

    return list(records.values()), stats


def apply_backfill(conn: sqlite3.Connection, records: list[PastRunRecord], dry_run: bool) -> dict[str, int]:
    date_norm = "replace(replace(race_date, '/', '-'), '.', '-')"

    updated = 0
    inserted = 0
    no_change = 0

    for rec in tqdm(records, desc="upsert final_3f", unit="run"):
        # 1) 既存行を更新（horse_id + date + race_number を主キー相当で照合）
        cur = conn.execute(
            f"""
            UPDATE horse_results
            SET final_3f = ?
            WHERE horse_id = ?
              AND {date_norm} = ?
              AND race_number = ?
            """,
            (rec.final_3f, rec.horse_id, rec.race_date, rec.race_number),
        )
        if cur.rowcount and cur.rowcount > 0:
            updated += int(cur.rowcount)
            continue

        # 2) race_number が欠ける古い行向けフォールバック（race_name も利用）
        cur2 = conn.execute(
            f"""
            UPDATE horse_results
            SET final_3f = ?
            WHERE horse_id = ?
              AND {date_norm} = ?
              AND race_name = ?
            """,
            (rec.final_3f, rec.horse_id, rec.race_date, rec.race_name),
        )
        if cur2.rowcount and cur2.rowcount > 0:
            updated += int(cur2.rowcount)
            continue

        # 3) 行が無ければ最小限で INSERT
        if dry_run:
            inserted += 1
            continue

        ins_cur = conn.execute(
            """
            INSERT OR IGNORE INTO horse_results (
                horse_id, race_date, venue, weather, race_number, race_name,
                surface, distance, around, ground_state, horse_count,
                frame_number, horse_number, odds, popularity, finish_pos,
                jockey_name, weight_carried, finish_time, margin, pace,
                final_3f, body_weight, body_weight_diff, passage_rank,
                prize, race_class
            ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
            """,
            (
                rec.horse_id,
                rec.race_date,
                rec.venue or "",
                "",
                rec.race_number,
                rec.race_name,
                rec.surface or "",
                None,
                "",
                "",
                None,
                None,
                None,
                None,
                None,
                rec.finish_pos,
                "",
                None,
                "",
                "",
                "",
                rec.final_3f,
                None,
                0,
                "",
                None,
                rec.race_class,
            ),
        )
        if ins_cur.rowcount and ins_cur.rowcount > 0:
            inserted += 1
        else:
            no_change += 1

    return {
        "updated_rows": updated,
        "inserted_rows": inserted,
        "no_change_rows": no_change,
        "records": len(records),
    }


def main() -> int:
    parser = argparse.ArgumentParser(description="TS pastRuns から horse_results.final_3f を補完")
    parser.add_argument("--db-path", default=str(DB_PATH), help="SQLite DB path")
    parser.add_argument(
        "--races-dir",
        default=str((Path(__file__).resolve().parent.parent / "src" / "data" / "races")),
        help="TS races JSON directory",
    )
    parser.add_argument("--dry-run", action="store_true", help="DB更新せず件数のみ")
    args = parser.parse_args()

    logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(name)s: %(message)s")

    db_path = Path(args.db_path)
    races_dir = Path(args.races_dir)
    if not db_path.is_file():
        logger.error("DB not found: %s", db_path)
        return 1
    if not races_dir.is_dir():
        logger.error("races dir not found: %s", races_dir)
        return 1

    records, stats = collect_records_from_ts(races_dir)
    logger.info("collected records=%d stats=%s", len(records), stats)

    with sqlite3.connect(str(db_path)) as conn:
        result = apply_backfill(conn, records, dry_run=bool(args.dry_run))
        if not args.dry_run:
            conn.commit()
    logger.info("backfill result=%s dry_run=%s", result, bool(args.dry_run))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
