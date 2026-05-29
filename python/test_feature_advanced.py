"""交差特徴量・Pass2 高度重みの単体テスト。"""

import numpy as np
import pandas as pd

from feature_engineer import FeatureEngineer


def test_add_interactions_columns():
    fe = FeatureEngineer(
        pd.DataFrame(
            columns=["horse_id", "race_date", "finish_pos", "margin", "horse_count"]
        )
    )
    df = pd.DataFrame(
        {
            "class_tier": [6.0, 1.0],
            "graded_race_tier": [6.0, 1.0],
            "horse_last_margin": ["0.5", None],
            "horse_top3_rate": [0.4, 0.1],
        }
    )
    out = fe.add_interactions(df)
    assert "inter_class_margin" in out.columns
    assert "inter_graded_top3" in out.columns
    assert abs(out.loc[0, "inter_graded_top3"] - 2.4) < 1e-9


def test_calculate_advanced_weights_graded_winner_buff():
    df = pd.DataFrame(
        {
            "margin_sec": [0.0, 0.15],
            "graded_race_tier": [8.0, 8.0],
            "class_tier": [8.0, 8.0],
            "odds": [5.0, 5.0],
        }
    )
    base = np.ones(2)
    out = FeatureEngineer.calculate_advanced_weights(df, base)
    assert out[0] == 1.5
    assert out[1] == 1.3


def test_calculate_advanced_weights_flock_debuff():
    df = pd.DataFrame(
        {
            "margin_sec": [0.0],
            "graded_race_tier": [1.0],
            "class_tier": [1.0],
            "odds": [60.0],
            "pace_is_slow": [1],
        }
    )
    base = np.ones(1)
    out = FeatureEngineer.calculate_advanced_weights(df, base)
    assert out[0] == 0.6


def test_compute_margin_sec_series_winner_zero():
    df = pd.DataFrame(
        {
            "race_id": ["R1", "R1"],
            "finish_pos": [1, 2],
            "finish_time_sec": [120.0, 120.5],
        }
    )
    margin = FeatureEngineer.compute_margin_sec_series(df)
    assert margin.iloc[0] == 0.0
    assert abs(margin.iloc[1] - 0.5) < 1e-6
