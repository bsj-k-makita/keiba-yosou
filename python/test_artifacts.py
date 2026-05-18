"""artifacts / target_mod のユニットテスト（DB 不要）"""

import pandas as pd

from artifacts import build_entity_stats_snapshot, lookup_entity_stat
from feature_engineer import FeatureEngineer


def test_make_target_mod_dead_heat():
    df = pd.DataFrame(
        {
            "race_id": ["r1", "r1", "r1"],
            "finish_pos": [1, 2, 3],
            "time_sec": [93.5, 93.5, 94.0],
        }
    )
    y = FeatureEngineer.make_target_mod(df)
    assert y.tolist() == [1, 1, 0]


def test_entity_stats_snapshot_last_row():
    df = pd.DataFrame(
        {
            "race_date": pd.to_datetime(["2024-01-01", "2024-06-01"]),
            "jockey_id": ["j1", "j1"],
            "jockey_win_rate": [0.1, 0.2],
            "jockey_top3_rate": [0.3, 0.4],
        }
    )
    snap = build_entity_stats_snapshot(df)
    assert snap["jockeys"]["j1"]["jockey_win_rate"] == 0.2
    assert lookup_entity_stat(snap, "jockeys", "j1", "jockey_win_rate") == 0.2
    assert lookup_entity_stat(snap, "jockeys", "unknown", "jockey_win_rate") is None or isinstance(
        lookup_entity_stat(snap, "jockeys", "unknown", "jockey_win_rate"),
        float,
    )
