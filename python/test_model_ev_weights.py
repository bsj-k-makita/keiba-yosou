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
