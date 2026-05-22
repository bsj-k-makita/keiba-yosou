"""
過去成績の再取得リトライバッチ。

対象:
- race_results に出走している horse_id のうち、
  1) horse_results に1行もない
  2) horse_results はあるが final_3f の有効値（20.0〜60.0）が1件もない

使い方:
  python retry_failed_horses.py
  python retry_failed_horses.py --max-horses 200 --retries 2 --sleep-sec 0.3
  python retry_failed_horses.py --dry-run
"""

from __future__ import annotations

import argparse
import json
import logging
import sqlite3
import time
from pathlib import Path

from tqdm import tqdm

from config import DB_PATH
from scraper import Scraper

logger = logging.getLogger(__name__)


def collect_retry_targets(
    db_path: str | Path,
    *,
    mode: str = "all",
) -> list[str]:
    with sqlite3.connect(str(db_path)) as conn:
        race_horses = [
            str(r[0])
            for r in conn.execute(
                """
                SELECT DISTINCT horse_id
                FROM race_results
                WHERE horse_id IS NOT NULL AND horse_id != ''
                ORDER BY horse_id
                """
            ).fetchall()
        ]

        hr_count = {
            str(hid): int(cnt)
            for hid, cnt in conn.execute(
                """
                SELECT horse_id, COUNT(*) AS cnt
                FROM horse_results
                WHERE horse_id IS NOT NULL AND horse_id != ''
                GROUP BY horse_id
                """
            ).fetchall()
        }
        valid_f3f_count = {
            str(hid): int(cnt)
            for hid, cnt in conn.execute(
                """
                SELECT horse_id, COUNT(*) AS cnt
                FROM horse_results
                WHERE horse_id IS NOT NULL
                  AND final_3f IS NOT NULL
                  AND final_3f BETWEEN 20.0 AND 60.0
                GROUP BY horse_id
                """
            ).fetchall()
        }

    no_rows = [hid for hid in race_horses if hr_count.get(hid, 0) == 0]
    no_valid = [
        hid for hid in race_horses if hr_count.get(hid, 0) > 0 and valid_f3f_count.get(hid, 0) == 0
    ]
    if mode == "no_rows":
        targets = no_rows
    elif mode == "no_valid":
        targets = no_valid
    else:
        # まず既存行あり（更新で改善しやすい）を優先
        targets = no_valid + no_rows
    return targets


def load_resume_targets(path: str | Path) -> list[str]:
    p = Path(path)
    if not p.is_file():
        raise FileNotFoundError(f"resume file not found: {p}")
    if p.suffix.lower() == ".json":
        payload = json.loads(p.read_text(encoding="utf-8"))
        if isinstance(payload, dict) and "horse_ids" in payload:
            ids = payload["horse_ids"]
        elif isinstance(payload, list):
            ids = payload
        else:
            ids = []
    else:
        ids = [line.strip() for line in p.read_text(encoding="utf-8").splitlines() if line.strip()]
    return [str(x).strip() for x in ids if str(x).strip()]


def save_failed_targets(path: str | Path, horse_ids: list[str], meta: dict | None = None) -> None:
    p = Path(path)
    p.parent.mkdir(parents=True, exist_ok=True)
    payload = {
        "horse_ids": sorted(set(str(h).strip() for h in horse_ids if str(h).strip())),
        "count": len(set(horse_ids)),
        "meta": meta or {},
    }
    p.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")


def run_retry_batch(
    db_path: str | Path,
    *,
    mode: str = "all",
    resume: str | Path | None = None,
    failed_out: str | Path = "python/failed_horses.json",
    max_horses: int | None = None,
    retries: int = 3,
    sleep_sec: float = 0.5,
    backoff_factor: float = 2.0,
    max_backoff_sec: float = 16.0,
    driver_refresh_fail_streak: int = 5,
    dry_run: bool = False,
) -> dict[str, int]:
    if resume:
        targets = load_resume_targets(resume)
        logger.info("resume mode: loaded %d horses from %s", len(targets), resume)
    else:
        targets = collect_retry_targets(db_path, mode=mode)
    if max_horses is not None and max_horses > 0:
        targets = targets[:max_horses]

    logger.info("retry targets: %d horses", len(targets))
    if dry_run:
        return {
            "target_horses": len(targets),
            "attempted": 0,
            "success": 0,
            "failed": 0,
            "skipped": len(targets),
        }

    success = 0
    failed = 0
    attempted = 0
    consecutive_failures = 0
    failed_horse_ids: list[str] = []

    with Scraper(db_path=str(db_path)) as scraper:
        for horse_id in tqdm(targets, desc="retry horse_results", unit="頭"):
            attempted += 1
            ok = False
            last_err: str | None = None
            attempt_used = 0
            for attempt in range(1, retries + 2):
                attempt_used = attempt
                # 同一セッション過負荷回避: 各試行前に基本ウェイト
                time.sleep(sleep_sec)
                try:
                    ok = bool(scraper.scrape_horse(horse_id, force=True))
                    if ok:
                        break
                    last_err = "scrape_horse returned False"
                except Exception as e:
                    last_err = str(e)
                    logger.warning(
                        "scrape_horse error horse_id=%s attempt=%d/%d: %s",
                        horse_id,
                        attempt,
                        retries + 1,
                        e,
                    )

                # 失敗時は指数バックオフ
                if attempt < retries + 1:
                    backoff = min(max_backoff_sec, sleep_sec * (backoff_factor ** (attempt - 1)))
                    logger.info(
                        "backoff horse_id=%s attempt=%d wait=%.1fs",
                        horse_id,
                        attempt,
                        backoff,
                    )
                    time.sleep(backoff)

            if ok:
                success += 1
                consecutive_failures = 0
            else:
                failed += 1
                consecutive_failures += 1
                failed_horse_ids.append(horse_id)
                if last_err:
                    logger.info(
                        "failed horse_id=%s attempts=%d reason=%s",
                        horse_id,
                        attempt_used,
                        last_err,
                    )
                else:
                    logger.info("failed horse_id=%s", horse_id)

                # 連続失敗時にWebDriverセッションを再起動
                if consecutive_failures >= max(1, int(driver_refresh_fail_streak)):
                    logger.warning(
                        "consecutive failures reached %d, refreshing webdriver session",
                        consecutive_failures,
                    )
                    scraper.close()
                    consecutive_failures = 0

            if attempted % 50 == 0:
                logger.info(
                    "progress attempted=%d/%d success=%d failed=%d",
                    attempted,
                    len(targets),
                    success,
                    failed,
                )

    save_failed_targets(
        failed_out,
        failed_horse_ids,
        meta={
            "target_horses": len(targets),
            "attempted": attempted,
            "success": success,
            "failed": failed,
            "mode": mode,
            "resume": str(resume) if resume else None,
        },
    )
    logger.info("failed horse ids saved: %s (%d)", failed_out, len(failed_horse_ids))

    return {
        "mode": mode,
        "target_horses": len(targets),
        "attempted": attempted,
        "success": success,
        "failed": failed,
        "skipped": 0,
        "failed_out_count": len(failed_horse_ids),
    }


def main() -> int:
    parser = argparse.ArgumentParser(description="horse_results 再取得リトライ")
    parser.add_argument("--db-path", default=str(DB_PATH), help="SQLite DB パス")
    parser.add_argument("--max-horses", type=int, default=0, help="処理上限頭数（0で全件）")
    parser.add_argument("--retries", type=int, default=3, help="失敗時の追加リトライ回数")
    parser.add_argument("--sleep-sec", type=float, default=0.5, help="1試行ごとの基本待機秒")
    parser.add_argument("--backoff-factor", type=float, default=2.0, help="指数バックオフ係数")
    parser.add_argument("--max-backoff-sec", type=float, default=16.0, help="バックオフ上限秒")
    parser.add_argument(
        "--driver-refresh-fail-streak",
        type=int,
        default=5,
        help="連続失敗回数でWebDriverを再起動",
    )
    parser.add_argument("--resume", type=str, default="", help="失敗IDファイル(json/txt)から再開")
    parser.add_argument(
        "--failed-out",
        type=str,
        default="python/failed_horses.json",
        help="最終失敗horse_id出力先(json)",
    )
    parser.add_argument(
        "--mode",
        choices=["all", "no_rows", "no_valid"],
        default="all",
        help="対象抽出モード",
    )
    parser.add_argument("--dry-run", action="store_true", help="対象抽出のみ")
    args = parser.parse_args()

    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    )

    db_path = Path(args.db_path)
    if not db_path.is_file():
        logger.error("DB not found: %s", db_path)
        return 1

    result = run_retry_batch(
        db_path=db_path,
        mode=args.mode,
        resume=(args.resume or None),
        failed_out=args.failed_out,
        max_horses=(args.max_horses if args.max_horses > 0 else None),
        retries=max(0, int(args.retries)),
        sleep_sec=max(0.0, float(args.sleep_sec)),
        backoff_factor=max(1.0, float(args.backoff_factor)),
        max_backoff_sec=max(0.0, float(args.max_backoff_sec)),
        driver_refresh_fail_streak=max(1, int(args.driver_refresh_fail_streak)),
        dry_run=bool(args.dry_run),
    )
    logger.info("retry batch result: %s", result)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
