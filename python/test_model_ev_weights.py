"""EV シグモイド重み・2パス学習ヘルパーの単体テスト。"""

import numpy as np
import pandas as pd

from config import EV_WEIGHT_GRADED_MIN_TIER
from model import (
    EV_WEIGHT_CENTER,
    EV_WEIGHT_CENTER_GRADED,
    EV_WEIGHT_TAU,
    EV_WEIGHT_TAU_GRADED,
    calculate_dynamic_ev_weight,
    calculate_ev_weight,
    compute_train_sample_weights,
    smooth_normalize_probabilities,
)
from config import CALIBRATION_MIN_PROB


def test_calculate_ev_weight_range():
    ev = np.array([0.5, 0.95, 1.2, 2.0])
    w = calculate_ev_weight(ev, center=EV_WEIGHT_CENTER, tau=EV_WEIGHT_TAU)
    assert w.min() >= 1.0 - 1e-9
    assert w.max() <= 2.0 + 1e-9
    assert w[0] < w[-1]


def test_calculate_dynamic_ev_weight_graded_is_stricter_above_center():
    """EV>1.0 付近（妙味あり帯）では重賞パラメータの方が raw_weight が低い。"""
    ev = 1.1
    w_default = calculate_dynamic_ev_weight(ev, class_tier=1.0)
    w_graded = calculate_dynamic_ev_weight(ev, class_tier=EV_WEIGHT_GRADED_MIN_TIER)
    assert w_graded < w_default


def test_new_default_is_milder_than_legacy_steep_sigmoid():
    """旧 center=0.9, tau=0.02 より境界 EV=0.9 付近の急峻な 2.0 張り付きを緩和。"""
    ev = 0.9
    w_legacy = float(calculate_ev_weight(np.array([ev]), center=0.9, tau=0.02)[0])
    w_new = calculate_dynamic_ev_weight(ev, class_tier=1.0)
    assert w_new < w_legacy


def test_calculate_dynamic_ev_weight_invalid_ev_returns_unit():
    assert calculate_dynamic_ev_weight(float("nan"), 8.0) == 1.0
    assert calculate_dynamic_ev_weight(0.0, 8.0) == 1.0


def test_compute_train_sample_weights_race_normalized():
    df = pd.DataFrame(
        {
            "race_id": ["R1", "R1", "R1", "R2", "R2"],
            "odds": [3.0, 8.0, 15.0, 2.0, 20.0],
        }
    )
    oof = np.array([0.4, 0.3, 0.1, 0.5, 0.2])
    weights = compute_train_sample_weights(
        df, oof, center=EV_WEIGHT_CENTER, tau=EV_WEIGHT_TAU
    )
    assert len(weights) == 5
    for rid in df["race_id"].unique():
        mask = df["race_id"] == rid
        assert abs(weights[mask].sum() - 1.0) < 1e-6


def test_invalid_odds_gets_unit_raw_weight():
    df = pd.DataFrame({"race_id": ["R1", "R1"], "odds": [np.nan, 0.0]})
    oof = np.array([0.5, 0.5])
    weights = compute_train_sample_weights(df, oof)
    assert abs(weights.sum() - 1.0) < 1e-6


def test_borderline_ev_suppressed_vs_legacy_in_graded():
    """オークス境界帯 EV≈0.9: 旧急峻シグモイド(≈2.0)から大幅に抑制される。"""
    ev = 0.9
    w_legacy = float(calculate_ev_weight(np.array([ev]), center=0.9, tau=0.02)[0])
    w_default = calculate_dynamic_ev_weight(ev, class_tier=1.0)
    w_graded = calculate_dynamic_ev_weight(ev, class_tier=8.0)
    assert w_graded < w_default < w_legacy


def test_g3_tier_uses_graded_center():
    ev = 1.1
    w_g3 = calculate_dynamic_ev_weight(ev, class_tier=6.0)
    w_open = calculate_dynamic_ev_weight(ev, class_tier=1.0)
    assert w_g3 < w_open


def test_smooth_normalize_probabilities_floor():
    raw = np.array([0.0, 0.0, 1.0, 0.0])
    normed = smooth_normalize_probabilities(raw, min_prob=CALIBRATION_MIN_PROB)
    assert normed.min() > 0.001
    assert abs(normed.sum() - 1.0) < 1e-6


def test_vectorized_graded_matches_scalar_helper():
    ev = 1.1
    scalar = calculate_dynamic_ev_weight(ev, class_tier=8.0)
    vector = float(
        calculate_ev_weight(
            np.array([ev]),
            center=EV_WEIGHT_CENTER_GRADED,
            tau=EV_WEIGHT_TAU_GRADED,
        )[0]
    )
    assert abs(scalar - vector) < 1e-9
