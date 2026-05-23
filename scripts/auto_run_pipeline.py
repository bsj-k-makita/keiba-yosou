#!/usr/bin/env python3
"""
印の安定のため、オッズ自動取得は既定で無効。
必要なときだけ手動で refresh / backfill を実行してください。

使い方:
  cd 競馬最強予想ファイルの改善版

  # 手動（推奨）— オッズ更新が必要なときだけ
  node scripts/refresh-latest-odds.mjs --date=YYYY-MM-DD --live-fallback --retries=3 --retry-wait=30000
  python3 scripts/backfill-ai-predictions.py --start-date YYYY-MM-DD --end-date YYYY-MM-DD --ts-only

  # 1回だけオッズ取得→AI再計算（明示的に --fetch-odds）
  python3 scripts/auto_run_pipeline.py --once --fetch-odds

  # 週末スケジュール実行（オッズ自動取得を有効にする場合のみ --fetch-odds）
  pip install schedule   # 初回のみ
  python3 scripts/auto_run_pipeline.py --fetch-odds --interval-minutes 30
"""

from __future__ import annotations

import argparse
import logging
import subprocess
import sys
import time as time_mod
from datetime import datetime, time
from pathlib import Path

try:
    import schedule
except ImportError:
    schedule = None  # type: ignore[assignment,misc]

REPO_ROOT = Path(__file__).resolve().parent.parent

# 実行回数（ターミナル表示用）
_pipeline_run_count = 0


def today_iso() -> str:
    """当日（ローカルタイムゾーン）を YYYY-MM-DD で返す。"""
    return datetime.now().strftime("%Y-%m-%d")


def parse_hhmm(value: str) -> time:
    parts = value.strip().split(":")
    if len(parts) != 2:
        raise argparse.ArgumentTypeError(f"時刻は HH:MM 形式で指定してください: {value}")
    hour, minute = int(parts[0]), int(parts[1])
    if not (0 <= hour <= 23 and 0 <= minute <= 59):
        raise argparse.ArgumentTypeError(f"不正な時刻: {value}")
    return time(hour, minute)


def is_weekend(dt: datetime | None = None) -> bool:
    """土曜(5)・日曜(6)か。"""
    dt = dt or datetime.now()
    return dt.weekday() in (5, 6)


def is_within_window(
    window_start: time,
    window_end: time,
    dt: datetime | None = None,
) -> bool:
    """指定の時刻帯内か（開始・終了を含む）。"""
    dt = dt or datetime.now()
    now_t = dt.time()
    return window_start <= now_t <= window_end


def should_run_scheduled(
    window_start: time,
    window_end: time,
    weekends_only: bool,
    dt: datetime | None = None,
) -> bool:
    dt = dt or datetime.now()
    if weekends_only and not is_weekend(dt):
        return False
    return is_within_window(window_start, window_end, dt)


def log_next_run() -> None:
    if schedule is None:
        return
    nxt = schedule.next_run()
    if nxt is None:
        logging.info("次回実行予定: （未スケジュール）")
        return
    logging.info("次回実行予定: %s", nxt.strftime("%Y-%m-%d %H:%M:%S"))


def run_subprocess_step(cmd: list[str], step_label: str) -> bool:
    """subprocess でコマンドを実行。成功なら True。"""
    logging.info("[%s] 実行: %s", step_label, " ".join(cmd))
    try:
        result = subprocess.run(
            cmd,
            cwd=str(REPO_ROOT),
            check=False,
        )
    except OSError as e:
        logging.error("[%s] 起動失敗: %s", step_label, e)
        return False

    if result.returncode != 0:
        logging.error("[%s] 終了コード %d", step_label, result.returncode)
        return False

    logging.info("[%s] 完了", step_label)
    return True


def run_refresh_odds(date: str, retries: int, retry_wait_ms: int) -> bool:
    """コマンド1: 直前オッズ取得（refresh-latest-odds）。"""
    cmd = [
        "node",
        "scripts/refresh-latest-odds.mjs",
        "--live-fallback",
        f"--retries={retries}",
        f"--retry-wait={retry_wait_ms}",
        f"--date={date}",
    ]
    return run_subprocess_step(cmd, "オッズ取得")


def run_snapshot_ai_marks(date: str) -> bool:
    """印スナップショット（発走30分前を過ぎたレースはスキップ）。"""
    cmd = ["npx", "tsx", "scripts/snapshot-ai-marks.ts", f"--date={date}"]
    return run_subprocess_step(cmd, "印スナップショット")


def run_backfill_ai(date: str, ts_only: bool) -> bool:
    """AI 予測バックフィル。"""
    cmd = [
        sys.executable,
        "scripts/backfill-ai-predictions.py",
        f"--start-date={date}",
        f"--end-date={date}",
    ]
    if ts_only:
        cmd.append("--ts-only")
    return run_subprocess_step(cmd, "AIバックフィル")


def run_pipeline(
    *,
    fetch_odds: bool,
    snapshot_marks: bool,
    retries: int = 3,
    retry_wait_ms: int = 30000,
    ts_only: bool = True,
) -> bool:
    """
    既定: 何もしない（印のコロコロ変動を防ぐ）。
    --fetch-odds: オッズ取得 → AI バックフィル → （任意）印スナップショット
  """
    global _pipeline_run_count
    _pipeline_run_count += 1
    date = today_iso()

    logging.info("=" * 60)
    logging.info(
        "パイプライン実行 #%d 開始（対象日: %s / fetch_odds=%s snapshot=%s）",
        _pipeline_run_count,
        date,
        fetch_odds,
        snapshot_marks,
    )
    logging.info("=" * 60)

    if not fetch_odds and not snapshot_marks:
        logging.info(
            "自動実行はスキップしました（オッズ自動取得は既定で無効）。"
            "必要なら手動で refresh / backfill を実行してください。"
        )
        log_next_run()
        return True

    if fetch_odds:
        try:
            odds_ok = run_refresh_odds(date, retries, retry_wait_ms)
        except Exception:
            logging.exception("オッズ取得で予期しないエラー — 今回はスキップします")
            log_next_run()
            return False

        if not odds_ok:
            logging.warning(
                "オッズ取得に失敗したため、今回の AI バックフィルはスキップします。"
            )
            log_next_run()
            return False

        try:
            ai_ok = run_backfill_ai(date, ts_only)
        except Exception:
            logging.exception("AI バックフィルで予期しないエラー")
            log_next_run()
            return False

        if not ai_ok:
            logging.warning("AI バックフィルは失敗または更新 0 件でした")
            log_next_run()
            return ai_ok

    if snapshot_marks:
        try:
            snapshot_ok = run_snapshot_ai_marks(date)
        except Exception:
            logging.exception("印スナップショットで予期しないエラー（続行）")
            snapshot_ok = False
        if not snapshot_ok:
            logging.warning(
                "印スナップショットは一部スキップまたは失敗（発走30分前超過レースは更新しません）"
            )

    logging.info("パイプライン実行 #%d 完了", _pipeline_run_count)
    log_next_run()
    return True


def _make_scheduled_job(
    window_start: time,
    window_end: time,
    weekends_only: bool,
    fetch_odds: bool,
    snapshot_marks: bool,
    retries: int,
    retry_wait_ms: int,
    ts_only: bool,
):
    def job() -> None:
        if not should_run_scheduled(window_start, window_end, weekends_only):
            logging.debug(
                "実行条件外のためスキップ（土日=%s, 時刻=%s, 帯=%s〜%s）",
                is_weekend(),
                datetime.now().strftime("%H:%M"),
                window_start.strftime("%H:%M"),
                window_end.strftime("%H:%M"),
            )
            log_next_run()
            return
        run_pipeline(
            fetch_odds=fetch_odds,
            snapshot_marks=snapshot_marks,
            retries=retries,
            retry_wait_ms=retry_wait_ms,
            ts_only=ts_only,
        )

    return job


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="オッズ取得→AIバックフィル（既定: 自動オッズ取得オフ）",
    )
    parser.add_argument(
        "--fetch-odds",
        action=argparse.BooleanOptionalAction,
        default=False,
        help="オッズ自動取得＋AIバックフィルを実行（既定: 無効）",
    )
    parser.add_argument(
        "--snapshot-marks",
        action="store_true",
        help="印スナップショットのみ実行（--fetch-odds なしでも可）",
    )
    parser.add_argument(
        "--interval-minutes",
        type=int,
        default=15,
        help="実行間隔（分）。既定 15",
    )
    parser.add_argument(
        "--window-start",
        type=parse_hhmm,
        default=parse_hhmm("09:00"),
        help="実行開始時刻 HH:MM（既定 09:00）",
    )
    parser.add_argument(
        "--window-end",
        type=parse_hhmm,
        default=parse_hhmm("16:30"),
        help="実行終了時刻 HH:MM（既定 16:30）",
    )
    parser.add_argument(
        "--weekends-only",
        action=argparse.BooleanOptionalAction,
        default=True,
        help="土日のみ実行（既定: 有効）",
    )
    parser.add_argument(
        "--retries",
        type=int,
        default=3,
        help="オッズ取得リトライ回数（refresh-latest-odds へ渡す）",
    )
    parser.add_argument(
        "--retry-wait",
        type=int,
        default=30000,
        help="オッズ取得リトライ待機 ms",
    )
    parser.add_argument(
        "--no-ts-only",
        action="store_true",
        help="backfill から --ts-only を外す（DB 優先）",
    )
    parser.add_argument(
        "--once",
        action="store_true",
        help="スケジュールせず 1 回だけ実行して終了",
    )
    parser.add_argument(
        "--run-immediately",
        action="store_true",
        help="スケジュール開始時、条件を満たせば即 1 回実行",
    )
    parser.add_argument(
        "-v",
        "--verbose",
        action="store_true",
        help="DEBUG ログを有効化",
    )
    return parser.parse_args()


def main() -> int:
    args = parse_args()

    logging.basicConfig(
        level=logging.DEBUG if args.verbose else logging.INFO,
        format="%(asctime)s [%(levelname)s] %(message)s",
        datefmt="%Y-%m-%d %H:%M:%S",
    )

    ts_only = not args.no_ts_only
    window_start: time = args.window_start
    window_end: time = args.window_end
    fetch_odds: bool = args.fetch_odds
    snapshot_marks: bool = args.snapshot_marks

    if args.once:
        logging.info("単発実行モード（--once）")
        ok = run_pipeline(
            fetch_odds=fetch_odds,
            snapshot_marks=snapshot_marks,
            retries=args.retries,
            retry_wait_ms=args.retry_wait,
            ts_only=ts_only,
        )
        return 0 if ok else 1

    if not fetch_odds and not snapshot_marks:
        logging.info("自動オッズ取得は無効です（既定）。印の安定のためスケジューラは起動しません。")
        logging.info("手動更新例:")
        logging.info(
            "  node scripts/refresh-latest-odds.mjs --date=YYYY-MM-DD --live-fallback"
        )
        logging.info(
            "  python3 scripts/backfill-ai-predictions.py --start-date YYYY-MM-DD --end-date YYYY-MM-DD --ts-only"
        )
        logging.info("自動取得を有効にする場合: python3 scripts/auto_run_pipeline.py --fetch-odds")
        return 0

    if schedule is None:
        print(
            "Error: schedule パッケージが必要です。\n"
            "  pip install schedule\n"
            "または: pip install -r python/requirements.txt",
            file=sys.stderr,
        )
        return 1

    interval = max(1, args.interval_minutes)
    job = _make_scheduled_job(
        window_start,
        window_end,
        args.weekends_only,
        fetch_odds,
        snapshot_marks,
        args.retries,
        args.retry_wait,
        ts_only,
    )
    schedule.every(interval).minutes.do(job)

    logging.info("自動パイプラインを開始しました")
    logging.info("リポジトリ: %s", REPO_ROOT)
    logging.info(
        "スケジュール: %d分間隔 / 実行帯 %s〜%s / 土日のみ=%s / fetch_odds=%s / snapshot=%s",
        interval,
        window_start.strftime("%H:%M"),
        window_end.strftime("%H:%M"),
        args.weekends_only,
        fetch_odds,
        snapshot_marks,
    )
    log_next_run()

    if args.run_immediately and should_run_scheduled(
        window_start, window_end, args.weekends_only
    ):
        logging.info("起動時即時実行（--run-immediately）")
        job()

    try:
        while True:
            schedule.run_pending()
            time_mod.sleep(1)
    except KeyboardInterrupt:
        logging.info("停止シグナル受信 — パイプラインを終了します（累計実行 %d 回）", _pipeline_run_count)
        return 0


if __name__ == "__main__":
    raise SystemExit(main())
