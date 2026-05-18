"""
Phase 0-2 検収用メトリクス（AUC / LogLoss / EVスイープ / シャープレシオ）
"""

from __future__ import annotations

import json
import logging
from pathlib import Path
from typing import Any

import numpy as np
import pandas as pd
from sklearn.metrics import log_loss, roc_auc_score

from config import MODEL_DIR, TEST_YEARS

logger = logging.getLogger(__name__)

# bettingRules と揃える（TS側 VALID_PROB_THRESHOLD）
PROB_FLOOR = 0.01


def classification_metrics(
    y_true: np.ndarray,
    y_prob: np.ndarray,
    prob_floor: float = PROB_FLOOR,
) -> dict[str, Any]:
    """テストセット全体の分類指標。"""
    y_true = np.asarray(y_true, dtype=float)
    y_prob = np.asarray(y_prob, dtype=float)
    mask = np.isfinite(y_prob) & (y_prob >= prob_floor)
    if mask.sum() < 10:
        return {"auc": None, "logloss": None, "n_samples": int(mask.sum()), "prob_floor": prob_floor}

    yt = y_true[mask]
    yp = np.clip(y_prob[mask], 1e-6, 1 - 1e-6)
    out: dict[str, Any] = {
        "n_samples": int(len(yt)),
        "positive_rate": float(yt.mean()),
        "prob_floor": prob_floor,
        "mean_pred_prob": float(yp.mean()),
        "std_pred_prob": float(yp.std()),
    }
    try:
        if len(np.unique(yt)) > 1:
            out["auc"] = float(roc_auc_score(yt, yp))
        else:
            out["auc"] = None
        out["logloss"] = float(log_loss(yt, yp))
    except ValueError as e:
        logger.warning("classification_metrics failed: %s", e)
        out["auc"] = None
        out["logloss"] = None
    return out


def bet_return_series(report_results: list[Any]) -> np.ndarray:
    """各ベットのリターン率 (payout - stake) / stake。"""
    if not report_results:
        return np.array([])
    out = []
    for r in report_results:
        stake = max(r.bet_amount, 1)
        out.append((r.payout - stake) / stake)
    return np.array(out, dtype=float)


def sharp_ratio(returns: np.ndarray) -> float:
    """ベット単位の平均/標準偏差（√N は掛けない簡易版）。"""
    if len(returns) < 2:
        return 0.0
    std = float(np.std(returns, ddof=1))
    if std < 1e-9:
        return 0.0
    return float(np.mean(returns) / std)


def summarize_grid_row(
    ev_threshold: float,
    report: Any,
) -> dict[str, Any]:
    rets = bet_return_series(report.results)
    return {
        "ev_threshold": float(ev_threshold),
        "n_bets": int(report.n_bets),
        "n_hits": int(report.n_hits),
        "hit_rate": float(report.hit_rate),
        "roi": float(report.roi),
        "profit": int(report.profit),
        "std_return": float(rets.std(ddof=1)) if len(rets) > 1 else 0.0,
        "sharp_ratio": sharp_ratio(rets),
    }


def pick_best_row(
    grid_df: pd.DataFrame,
    metric: str,
    min_bets: int = 10,
) -> dict[str, Any]:
    valid = grid_df[grid_df["n_bets"] >= min_bets]
    if valid.empty:
        valid = grid_df
    if valid.empty:
        return {}
    idx = valid[metric].idxmax()
    row = valid.loc[idx]
    return row.to_dict()


def build_baseline_report(
    *,
    target_mode: str,
    y_true: np.ndarray,
    y_prob: np.ndarray,
    ev_grid_win: pd.DataFrame,
    bundle_path: Path | None = None,
    test_years: list | str | None = None,
) -> dict[str, Any]:
    cls = classification_metrics(y_true, y_prob)
    cls_no_floor = classification_metrics(y_true, y_prob, prob_floor=0.0)

    report: dict[str, Any] = {
        "target_mode": target_mode,
        "test_years": test_years if test_years is not None else list(TEST_YEARS),
        "classification": cls,
        "classification_all_probs": cls_no_floor,
        "prob_floor_note": f"本番EVは prob>={PROB_FLOOR} を推奨（TS bettingRules と同期）",
        "ev_sweep": {
            "ticket_type": "win",
            "ev_range_note": "馬連(REN)は Python Simulator 未対応。TS側バックテストで別途検証。",
            "grid": ev_grid_win.to_dict(orient="records"),
            "best_by_roi": pick_best_row(ev_grid_win, "roi"),
            "best_by_sharp_ratio": pick_best_row(ev_grid_win, "sharp_ratio"),
        },
        "review_checklist": {
            "1_sharpe_vs_roi": "best_by_sharp_ratio を Phase3 EV閾値の第一候補とする",
            "2_logloss": "win_mod の方が logloss が低下するか target_mode 比較で確認",
            "3_ticket_asymmetry": "単勝1.4-1.8 / 馬連2.6-3.0 は TS optimize または今後 REN 追加後に記録",
        },
    }
    if bundle_path and bundle_path.is_file():
        try:
            bundle = json.loads(bundle_path.read_text(encoding="utf-8"))
            report["model_bundle"] = {
                "created_at": bundle.get("created_at"),
                "train_rows": bundle.get("train_rows"),
                "target_mode": bundle.get("extra_meta", {}).get("target_mode")
                or bundle.get("target_mode"),
            }
        except Exception:
            pass
    return report


def write_baseline_report(report: dict[str, Any], path: Path | None = None) -> Path:
    out = path or (MODEL_DIR / "baseline_report.json")
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    logger.info("baseline_report written: %s", out)
    return out


def print_baseline_summary(report: dict[str, Any]) -> None:
    cls = report.get("classification", {})
    ev = report.get("ev_sweep", {})
    best_roi = ev.get("best_by_roi", {})
    best_sharp = ev.get("best_by_sharp_ratio", {})

    print("\n" + "=" * 60)
    print(f"Phase 0-2 Baseline Summary (target_mode={report.get('target_mode')})")
    print("=" * 60)
    print(f"TEST_YEARS: {report.get('test_years')}")
    print(f"AUC:      {cls.get('auc')}")
    print(f"LogLoss:  {cls.get('logloss')}  (lower is better)")
    print(f"pred std: {cls.get('std_pred_prob')}")
    print("-" * 60)
    print("EV sweep (win) — best by ROI:")
    if best_roi:
        print(
            f"  threshold={best_roi.get('ev_threshold'):.3f} "
            f"ROI={best_roi.get('roi'):.1f}% bets={best_roi.get('n_bets')} "
            f"sharp={best_roi.get('sharp_ratio'):.3f}"
        )
    print("EV sweep (win) — best by Sharpe:")
    if best_sharp:
        print(
            f"  threshold={best_sharp.get('ev_threshold'):.3f} "
            f"ROI={best_sharp.get('roi'):.1f}% bets={best_sharp.get('n_bets')} "
            f"sharp={best_sharp.get('sharp_ratio'):.3f} "
            f"std_return={best_sharp.get('std_return'):.4f}"
        )
    print("=" * 60 + "\n")
