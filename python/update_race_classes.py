"""
DB 内 race_class を最新ロジックで一括更新するバッチ。

使い方:
    python update_race_classes.py
    python update_race_classes.py --dry-run
    python update_race_classes.py --db-path /path/to/keiba.db
"""

from __future__ import annotations

import argparse
import logging
import sqlite3
from pathlib import Path
from typing import Any

from config import DB_PATH
from race_class import infer_race_class

logger = logging.getLogger(__name__)


def _table_columns(conn: sqlite3.Connection, table: str) -> set[str]:
    rows = conn.execute(f"PRAGMA table_info({table})").fetchall()
    return {str(r[1]) for r in rows}


def _pick_first(candidates: list[str], available: set[str]) -> str | None:
    for c in candidates:
        if c in available:
            return c
    return None


def _update_race_like_table(
    conn: sqlite3.Connection,
    table: str,
    *,
    dry_run: bool,
) -> int:
    cols = _table_columns(conn, table)
    if not cols or "race_class" not in cols:
        return 0

    pk_col = _pick_first(["race_id", "id"], cols)
    title_col = _pick_first(["race_name", "title", "name"], cols)
    info2_col = _pick_first(["info2", "race_info_text", "conditions", "condition_text"], cols)
    if pk_col is None or title_col is None:
        return 0

    select_cols = [pk_col, title_col]
    if info2_col is not None:
        select_cols.append(info2_col)
    rows = conn.execute(
        f"SELECT {', '.join(select_cols)} FROM {table}"
    ).fetchall()

    updates: list[tuple[str, Any]] = []
    for row in rows:
        row_id = row[0]
        title = str(row[1] or "")
        info2 = str(row[2] or "") if info2_col is not None and len(row) >= 3 else ""
        updates.append((infer_race_class(title, info2), row_id))

    if dry_run:
        logger.info("%s dry-run rows=%d", table, len(updates))
        return len(updates)

    conn.executemany(
        f"UPDATE {table} SET race_class = ? WHERE {pk_col} = ?",
        updates,
    )
    logger.info("%s updated rows=%d", table, len(updates))
    return len(updates)


def reclassify_database(
    db_path: str | Path = DB_PATH,
    *,
    dry_run: bool = False,
) -> dict[str, Any]:
    """
    race_class を DB 全体で一括再分類する。

    Returns:
        {"updated_rows": int, "tables": {table: rows}, "dry_run": bool}
    """
    db_path = Path(db_path)
    if not db_path.is_file():
        raise FileNotFoundError(f"DBが見つかりません: {db_path}")

    total = 0
    per_table: dict[str, int] = {}
    with sqlite3.connect(db_path) as conn:
        table_rows = conn.execute(
            "SELECT name FROM sqlite_master WHERE type='table'"
        ).fetchall()
        table_names = {str(r[0]) for r in table_rows}

        # 既存スキーマ差異に対応（race_info/races/horse_results）
        for table in ("race_info", "races", "horse_results"):
            if table in table_names:
                n = _update_race_like_table(conn, table, dry_run=bool(dry_run))
                per_table[table] = n
                total += n

        if not dry_run:
            conn.commit()

    logger.info("done: updated_rows=%d dry_run=%s", total, bool(dry_run))
    return {"updated_rows": total, "tables": per_table, "dry_run": bool(dry_run)}


def main() -> int:
    parser = argparse.ArgumentParser(description="race_class をDBで一括更新")
    parser.add_argument("--db-path", default=str(DB_PATH), help="対象SQLite DBパス")
    parser.add_argument("--dry-run", action="store_true", help="更新せず件数のみ表示")
    args = parser.parse_args()

    logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
    try:
        reclassify_database(args.db_path, dry_run=bool(args.dry_run))
    except FileNotFoundError as e:
        logger.error("%s", e)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
