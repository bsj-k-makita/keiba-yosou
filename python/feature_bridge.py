"""
Phase 1: TS レース JSON → LightGBM 推論用特徴量行へのブリッジ。

ゴールデンレース不変性テスト:
  - 正解: keiba.db 経由（学習パイプラインと同一）
  - 検証: 本モジュール（TS JSON + entity_stats_snapshot.pkl）

DB がある場合は build_features_from_db を優先し、
DB なし環境では build_features_from_ts_json で best-effort 推論する。
"""

from __future__ import annotations

import json
import logging
import pickle
from pathlib import Path
from typing import Any

import numpy as np
import pandas as pd

from config import DB_PATH, MODEL_DIR
from model import FEATURE_COLS
from race_class import infer_race_class

logger = logging.getLogger(__name__)

REPO_ROOT = Path(__file__).resolve().parent.parent
TS_RACES_DIR = REPO_ROOT / "src" / "data" / "races"
GOLDEN_RACES_PATH = Path(__file__).resolve().parent / "golden_races.json"

_EPS = 1e-9
_UNKNOWN = "不明"

_GROUND_MAP = {
    "good": "良",
    "yielding": "稍重",
    "soft": "重",
    "heavy": "不良",
    "不良": "不良",
    "良": "良",
    "稍重": "稍重",
    "重": "重",
}

_RUNNING_STYLE_MAP = {
    "逃げ": "逃げ",
    "先行": "先行",
    "差し": "差し",
    "追込": "追込",
    "マクリ": "マクリ",
}


def load_golden_race_ids() -> list[str]:
    data = json.loads(GOLDEN_RACES_PATH.read_text(encoding="utf-8"))
    return [r["race_id"] for r in data["races"]]


def load_ts_race_json(race_id: str) -> dict[str, Any] | None:
    path = TS_RACES_DIR / f"{race_id}.json"
    if not path.is_file():
        return None
    return json.loads(path.read_text(encoding="utf-8"))


def load_manifest() -> dict[str, Any]:
    path = MODEL_DIR / "feature_manifest.json"
    if not path.is_file():
        return {"feature_cols": list(FEATURE_COLS), "categorical_unknown_token": _UNKNOWN}
    return json.loads(path.read_text(encoding="utf-8"))


def load_processor():
    path = MODEL_DIR / "processor.pkl"
    if not path.is_file():
        raise FileNotFoundError(f"processor.pkl not found: {path}")
    with path.open("rb") as f:
        return pickle.load(f)


def load_entity_stats_snapshot() -> dict[str, Any]:
    path = MODEL_DIR / "entity_stats_snapshot.pkl"
    if not path.is_file():
        return {"jockeys": {}, "trainers": {}, "pedigree": {}, "global_defaults": {}}
    with path.open("rb") as f:
        return pickle.load(f)


def _month_to_season(month: int) -> str:
    if month in (3, 4, 5):
        return "春"
    if month in (6, 7, 8):
        return "夏"
    if month in (9, 10, 11):
        return "秋"
    return "冬"


def _normalize_surface(surface: str) -> str:
    s = str(surface or "")
    if "ダ" in s or "ダート" in s:
        return "ダート"
    if "芝" in s:
        return "芝"
    return _UNKNOWN


def _entry_odds(entry: dict[str, Any]) -> float | None:
    inv = entry.get("investment") or {}
    signals = entry.get("signals") or entry.get("evaluationSignals") or {}
    for key in ("actualOdds", "winOdds", "odds"):
        val = inv.get(key) if key in inv else signals.get(key)
        if val is not None:
            try:
                o = float(val)
                if o > 0 and np.isfinite(o):
                    return o
            except (TypeError, ValueError):
                pass
    return None


def _horse_final3f_from_db(horse_id: str, before_date: pd.Timestamp | None) -> dict[str, float] | None:
    """
    keiba.db の horse_results から直近の上がり3F関連特徴量を取得する。
    学習パイプラインと乖離しないよう、DB がある場合は TS 定数より優先する。
    """
    if not horse_id or not DB_PATH.is_file():
        return None

    import sqlite3

    # horse_results.race_date は netkeiba 由来で "2026/04/11" 形式が多い。
    # "YYYY-MM-DD" との文字列比較では 5/3 以前の行がすべて除外されるため正規化する。
    date_norm = "replace(replace(race_date, '/', '-'), '.', '-')"
    query = f"""
        SELECT final_3f, race_date, surface, ground_state, distance
        FROM horse_results
        WHERE horse_id = ? AND final_3f IS NOT NULL AND final_3f > 0
    """
    params: list[Any] = [horse_id]
    if before_date is not None and pd.notna(before_date):
        query += f" AND {date_norm} < ?"
        params.append(before_date.strftime("%Y-%m-%d"))

    query += f" ORDER BY {date_norm} DESC LIMIT 12"

    try:
        with sqlite3.connect(DB_PATH) as conn:
            rows = conn.execute(query, params).fetchall()
    except sqlite3.Error as e:
        logger.debug("horse_final3f DB lookup failed horse_id=%s: %s", horse_id, e)
        return None

    if not rows:
        return None

    final3fs = [float(r[0]) for r in rows]
    last_row = rows[0]
    last_f3f = float(last_row[0])

    surface = str(last_row[2] or _UNKNOWN)
    ground = str(last_row[3] or _UNKNOWN)

    with sqlite3.connect(DB_PATH) as conn:
        stat_rows = conn.execute(
            """
            SELECT final_3f FROM horse_results
            WHERE final_3f IS NOT NULL AND final_3f > 0
              AND surface = ? AND ground_state = ? AND distance BETWEEN ? AND ?
            """,
            (
                surface,
                ground,
                max(0, int(last_row[4] or 1600) - 200),
                int(last_row[4] or 1600) + 200,
            ),
        ).fetchall()

    z_vals = [float(r[0]) for r in stat_rows] if stat_rows else final3fs
    mean_f = float(np.mean(z_vals))
    std_f = float(np.std(z_vals))
    if std_f < _EPS:
        std_f = mean_f * 0.05 + _EPS
    last_z = (last_f3f - mean_f) / std_f

    return {
        "last_final3f": last_f3f,
        "avg_final3f": float(np.mean(final3fs)),
        "final3f_rank": float(len(final3fs)),
        "last_final3f_z": float(last_z),
    }


def _horse_stats_from_past_runs(
    past_runs: list[dict[str, Any]],
    *,
    horse_id: str = "",
    race_date: pd.Timestamp | None = None,
    db_final3f: dict[str, float] | None = None,
) -> dict[str, float]:
    """TS JSON pastRuns から馬統計の近似値を算出。DB 由来の上がり3Fがあれば優先。"""
    defaults = {
        "horse_race_count": 0.0,
        "horse_win_rate": 0.1,
        "horse_top2_rate": 0.2,
        "horse_top3_rate": 0.3,
        "horse_avg_finish": 8.0,
        "horse_last_finish": 8.0,
        "horse_recent3_avg": 8.0,
        "horse_days_since_last": 90.0,
        "last_final3f": 35.0,
        "avg_final3f": 35.0,
        "final3f_rank": 8.0,
        "last_final3f_z": 0.0,
    }
    if not past_runs:
        return defaults

    places = []
    final3fs = []
    for run in past_runs:
        p = run.get("place")
        if p is not None:
            try:
                places.append(int(p))
            except (TypeError, ValueError):
                pass
        f3 = run.get("final3fSec")
        if f3 is not None:
            try:
                final3fs.append(float(f3))
            except (TypeError, ValueError):
                pass

    n = len(places)
    if n == 0:
        return defaults

    arr = np.array(places, dtype=float)
    recent = arr[:3] if len(arr) >= 3 else arr
    out = {
        "horse_race_count": float(n),
        "horse_win_rate": float((arr == 1).mean()),
        "horse_top2_rate": float((arr <= 2).mean()),
        "horse_top3_rate": float((arr <= 3).mean()),
        "horse_avg_finish": float(arr.mean()),
        "horse_last_finish": float(arr[0]),
        "horse_recent3_avg": float(recent.mean()),
        "horse_days_since_last": 60.0,
    }
    if final3fs:
        farr = np.array(final3fs[:3], dtype=float)
        out["last_final3f"] = float(farr[0])
        out["avg_final3f"] = float(farr.mean())
    else:
        out["last_final3f"] = defaults["last_final3f"]
        out["avg_final3f"] = defaults["avg_final3f"]

    if db_final3f:
        for key in ("last_final3f", "avg_final3f", "final3f_rank", "last_final3f_z"):
            if key in db_final3f and np.isfinite(db_final3f[key]):
                out[key] = float(db_final3f[key])
    elif horse_id:
        db_vals = _horse_final3f_from_db(horse_id, race_date)
        if db_vals:
            for key, val in db_vals.items():
                if np.isfinite(val):
                    out[key] = float(val)

    return out


def _snapshot_default(snapshot: dict[str, Any], col: str, fallback: float) -> float:
    val = snapshot.get("global_defaults", {}).get(col)
    if val is not None and np.isfinite(val):
        return float(val)
    return fallback


def _rows_from_ts_race(
    race_data: dict[str, Any],
    snapshot: dict[str, Any],
) -> list[dict[str, Any]]:
    race_info = race_data.get("raceInfo") or {}
    condition = race_data.get("condition") or {}
    race_id = str(race_data.get("raceId") or race_info.get("raceId") or "")
    race_date = pd.to_datetime(race_info.get("date"), errors="coerce")
    entries = race_data.get("entries") or []
    horse_count = max(len(entries), 1)

    venue = str(race_info.get("venue") or condition.get("venue") or _UNKNOWN)
    surface = _normalize_surface(race_info.get("surface") or condition.get("surface") or "")
    distance = int(race_info.get("distance") or condition.get("distance") or 1600)
    weather = str(race_info.get("weather") or _UNKNOWN)
    ground_raw = condition.get("ground") or race_info.get("groundLabel") or "good"
    ground_state = _GROUND_MAP.get(str(ground_raw), str(ground_raw) if ground_raw else _UNKNOWN)
    race_class = infer_race_class(
        str(race_info.get("raceName") or ""),
        str(race_info.get("info2") or race_info.get("raceInfoText") or ""),
    )

    month = int(race_date.month) if pd.notna(race_date) else 1
    day_of_week = int(race_date.dayofweek) if pd.notna(race_date) else 0
    season = _month_to_season(month)

    rows: list[dict[str, Any]] = []
    weight_carrieds: list[float] = []

    for entry in entries:
        horse_number = int(entry.get("horseNumber") or entry.get("gate") or 0)
        if horse_number <= 0:
            continue
        frame_number = int(
            entry.get("frameNumber")
            or max(1, (horse_number + 1) // 2)
        )
        age = int(entry.get("age") or 4)
        sex = str(entry.get("sex") or _UNKNOWN)
        body_weight = entry.get("bodyWeightKg")
        body_weight = int(body_weight) if body_weight is not None else np.nan
        odds = _entry_odds(entry)
        popularity = entry.get("investment", {}).get("expectedPopularity")
        try:
            popularity = int(popularity) if popularity is not None else 0
        except (TypeError, ValueError):
            popularity = 0

        running_style = _RUNNING_STYLE_MAP.get(
            str(entry.get("runningStyle") or ""), _UNKNOWN
        )
        pedigree = entry.get("pedigree") or {}
        sire = str(pedigree.get("sire") or entry.get("sire") or _UNKNOWN)
        dam_sire = str(pedigree.get("damSire") or entry.get("dam_sire") or _UNKNOWN)

        wc = 57.0
        weight_carrieds.append(wc)

        horse_id = str(entry.get("horseId") or entry.get("horse_id") or "")
        db_f3f = _horse_final3f_from_db(horse_id, race_date) if horse_id else None
        past_stats = _horse_stats_from_past_runs(
            entry.get("pastRuns") or [],
            horse_id=horse_id,
            race_date=race_date,
            db_final3f=db_f3f,
        )

        row: dict[str, Any] = {
            "race_id": race_id,
            "race_date": race_date,
            "horse_number": horse_number,
            "frame_number": frame_number,
            "age": age,
            "sex": sex,
            "weight_carried": wc,
            "body_weight": body_weight,
            "body_weight_diff": 0,
            "distance": distance,
            "horse_count": horse_count,
            "odds": odds,
            "popularity": popularity if popularity > 0 else np.nan,
            "venue": venue,
            "surface": surface,
            "ground_state": ground_state,
            "weather": weather,
            "race_class": race_class,
            "around": _UNKNOWN,
            "sire": sire,
            "dam_sire": dam_sire,
            "running_style": running_style,
            "horse_age_group": "4-5歳" if age <= 5 else "6歳以上",
            "month": month,
            "day_of_week": day_of_week,
            "season": season,
            "jockey_win_rate": _snapshot_default(snapshot, "jockey_win_rate", 0.1),
            "jockey_top3_rate": _snapshot_default(snapshot, "jockey_top3_rate", 0.3),
            "jockey_venue_win_rate": _snapshot_default(snapshot, "jockey_win_rate", 0.1),
            "trainer_win_rate": _snapshot_default(snapshot, "trainer_win_rate", 0.1),
            "trainer_top3_rate": _snapshot_default(snapshot, "trainer_top3_rate", 0.3),
            "horse_same_distance_win_rate": past_stats["horse_win_rate"],
            "horse_same_surface_win_rate": past_stats["horse_win_rate"],
            "horse_same_ground_win_rate": past_stats["horse_win_rate"],
            "horse_same_venue_win_rate": past_stats["horse_win_rate"],
            "horse_month_win_rate": past_stats["horse_win_rate"],
            "horse_season_win_rate": past_stats["horse_win_rate"],
            "avg_first_corner": 5.0,
            **past_stats,
        }
        rows.append(row)

    if not rows:
        return []

    avg_wc = float(np.mean(weight_carrieds)) if weight_carrieds else 57.0
    for row in rows:
        row["weight_carried_diff_from_avg"] = row["weight_carried"] - avg_wc
        fn = row["frame_number"]
        row["is_outer_frame"] = int(fn >= 7)
        row["is_inner_frame"] = int(fn <= 2)
        o = row.get("odds")
        row["log_odds"] = float(np.log1p(o)) if o is not None and pd.notna(o) and o > 0 else np.nan
        pop = row.get("popularity")
        row["popularity_ratio"] = (
            float(pop) / horse_count if pop is not None and pd.notna(pop) and pop > 0 else np.nan
        )

    return rows


def _finalize_feature_df(
    df: pd.DataFrame,
    feature_cols: list[str],
    processor,
) -> pd.DataFrame:
    """manifest 列順に揃え、LabelEncoder と category 型を適用。"""
    if df.empty:
        return df

    out = df.copy()
    for col in feature_cols:
        if col not in out.columns:
            if col in ("venue", "surface", "ground_state", "weather", "race_class", "around",
                       "sex", "sire", "dam_sire", "running_style", "horse_age_group", "season"):
                out[col] = _UNKNOWN
            else:
                out[col] = 0.0

    out = out[feature_cols]
    out = processor.apply_label_encoders(out)
    out = processor.encode_categoricals_as_category(out)
    return out


def build_features_from_db(race_id: str) -> pd.DataFrame | None:
    """
    keiba.db から学習パイプラインと同じ手順で特徴量行を構築（正解ラベル）。
    DB 未構築時は None。
    """
    from config import DB_PATH

    if not DB_PATH.is_file():
        return None

    from data_processor import DataProcessor
    from feature_engineer import FeatureEngineer

    processor_path = MODEL_DIR / "processor.pkl"
    fe_path = MODEL_DIR / "feature_engineer.pkl"
    if not processor_path.is_file() or not fe_path.is_file():
        logger.warning("processor.pkl / feature_engineer.pkl がありません。先に train を実行してください。")
        return None

    with processor_path.open("rb") as f:
        processor = pickle.load(f)
    with fe_path.open("rb") as f:
        fe = pickle.load(f)

    master_df = processor.build_master_df()
    feature_df = fe.transform(master_df)
    feature_df = processor.apply_label_encoders(feature_df)
    feature_df = processor.encode_categoricals_as_category(feature_df)

    rows = feature_df[feature_df["race_id"] == race_id]
    if rows.empty:
        return None
    return rows.copy()


def build_features_from_ts_json(
    race_id: str,
    entity_stats_snapshot: dict[str, Any] | None = None,
    *,
    processor=None,
    manifest: dict[str, Any] | None = None,
) -> pd.DataFrame | None:
    """
    TS 出走表 JSON から LightGBM 推論用特徴量 DataFrame を構築する。

    DB なしの best-effort 実装。完全 parity は build_features_from_db を参照。
  speed_index はリークのため含めない。
    """
    raw = load_ts_race_json(race_id)
    if raw is None:
        logger.warning("TS race JSON not found: %s", race_id)
        return None

    snapshot = entity_stats_snapshot or load_entity_stats_snapshot()
    manifest = manifest or load_manifest()
    feature_cols = list(manifest.get("feature_cols", FEATURE_COLS))

    if processor is None:
        processor = load_processor()

    rows = _rows_from_ts_race(raw, snapshot)
    if not rows:
        return None

    df = pd.DataFrame(rows)
    df = df.sort_values("horse_number").reset_index(drop=True)
    return _finalize_feature_df(df, feature_cols, processor)


def build_features_for_race(
    race_id: str,
    *,
    entity_stats_snapshot: dict[str, Any] | None = None,
    processor=None,
    prefer_db: bool = True,
) -> pd.DataFrame | None:
    """
    推論用特徴量を構築。DB 行があれば DB パス（parity 優先）、なければ TS JSON。
    """
    if prefer_db:
        db_df = build_features_from_db(race_id)
        if db_df is not None and len(db_df) > 0:
            logger.debug("build_features_for_race: DB path race_id=%s", race_id)
            return db_df
    return build_features_from_ts_json(
        race_id,
        entity_stats_snapshot=entity_stats_snapshot,
        processor=processor,
    )


def compare_feature_frames(
    db_df: pd.DataFrame,
    bridge_df: pd.DataFrame,
    feature_cols: list[str],
    *,
    rtol: float = 1e-5,
    atol: float = 1e-6,
) -> dict[str, Any]:
    """2 DataFrame の特徴量列を馬番キーで突合。"""
    if "horse_number" not in db_df.columns:
        return {"ok": False, "error": "db_df missing horse_number"}

    db = db_df.set_index("horse_number")
    br = bridge_df.set_index("horse_number")
    common_horses = sorted(set(db.index) & set(br.index))
    if not common_horses:
        return {"ok": False, "error": "no common horse_number"}

    report: dict[str, Any] = {
        "ok": True,
        "n_horses": len(common_horses),
        "columns_compared": [],
        "mismatches": [],
    }

    for col in feature_cols:
        if col not in db.columns or col not in br.columns:
            report["mismatches"].append({"col": col, "reason": "missing_column"})
            report["ok"] = False
            continue
        a = pd.to_numeric(db.loc[common_horses, col], errors="coerce")
        b = pd.to_numeric(br.loc[common_horses, col], errors="coerce")
        corr = a.corr(b) if a.std() > 0 and b.std() > 0 else float("nan")
        try:
            close = bool(np.allclose(a.values, b.values, rtol=rtol, atol=atol, equal_nan=True))
        except Exception:
            close = False
        report["columns_compared"].append({"col": col, "corr": corr, "allclose": close})
        if not close:
            report["mismatches"].append({
                "col": col,
                "corr": corr,
                "max_abs_diff": float((a - b).abs().max()),
            })
            report["ok"] = False

    return report
