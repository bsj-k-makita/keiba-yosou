"""EV シグモイド重み・2パス学習ヘルパーの単体テスト。"""

import numpy as np
import pandas as pd

from model import (
    EV_WEIGHT_CENTER,
    EV_WEIGHT_TAU,
    calculate_ev_weight,
    compute_train_sample_weights,
)


def test_calculate_ev_weight_range():
    ev = np.array([0.5, 0.9, 1.2, 2.0])
    w = calculate_ev_weight(ev, center=0.9, tau=0.02)
    assert w.min() >= 1.0 - 1e-9
    assert w.max() <= 2.0 + 1e-9
    assert w[0] < w[-1]


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


def test_g1_g2_adaptive_weight_boosts_same_ev_case():
    df = pd.DataFrame(
        {
            "race_id": ["R1", "R1", "R2", "R2"],
            "odds": [5.0, 5.0, 5.0, 5.0],
            "race_class": ["G1", "G1", "1勝クラス", "1勝クラス"],
        }
    )
    oof = np.array([0.16, 0.14, 0.16, 0.14])
    weights = compute_train_sample_weights(df, oof)
    assert abs(weights[0] + weights[1] - 1.0) < 1e-6
    assert abs(weights[2] + weights[3] - 1.0) < 1e-6
    # G1/G2は center/tau を緩めるため、同EV帯でも差がつきやすくなる
    assert abs(weights[0] - weights[1]) > abs(weights[2] - weights[3])


def test_g3_proxy_boost_when_no_g1_g2_rows():
    df = pd.DataFrame(
        {
            "race_id": ["R1", "R1", "R2", "R2"],
            "odds": [5.0, 5.0, 5.0, 5.0],
            "race_class": ["G3", "G3", "1勝クラス", "1勝クラス"],
            "graded_race_tier": [6.0, 6.0, 1.0, 1.0],
        }
    )
    oof = np.array([0.16, 0.14, 0.16, 0.14])
    weights = compute_train_sample_weights(df, oof)
    assert abs(weights[0] - weights[1]) > abs(weights[2] - weights[3])
