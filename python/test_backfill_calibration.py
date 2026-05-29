"""バックフィル用キャリブレーション API の単体テスト。"""

import numpy as np
import pytest
from sklearn.isotonic import IsotonicRegression

from betting_evaluator import BettingEvaluator


def test_calibrated_normalized_probs_sums_to_one():
    ev = BettingEvaluator(margin=0.15)
    ev.fit_calibration(
        np.linspace(0.01, 0.9, 50),
        (np.linspace(0.01, 0.9, 50) > 0.5).astype(float),
    )
    raw = np.array([0.05, 0.15, 0.4, 0.1])
    normed = ev.calibrated_normalized_probs(raw)
    assert abs(normed.sum() - 1.0) < 1e-6


def test_calibrated_normalized_probs_respects_min_floor():
    from config import CALIBRATION_MIN_PROB

    ev = BettingEvaluator(margin=0.15)
    ev.fit_calibration(
        np.linspace(0.01, 0.9, 50),
        (np.linspace(0.01, 0.9, 50) > 0.5).astype(float),
    )
    raw = np.array([0.0, 0.0, 1.0, 0.0])
    normed = ev.calibrated_normalized_probs(raw)
    assert normed.min() > 0.001
    assert normed.min() > 0.0
    assert abs(normed.sum() - 1.0) < 1e-6


def test_require_calibrator_raises_without_fit():
    ev = BettingEvaluator()
    with pytest.raises(RuntimeError, match="キャリブレーション"):
        ev.calibrated_normalized_probs(np.array([0.1, 0.2]))
