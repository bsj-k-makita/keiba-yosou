"""
レースクラス分類（単一ソース）。

title（レース名）と info2（レース情報テキスト）から、学習・スクレイプ・Feature Bridge で
共通の race_class ラベルを返す。
"""

from __future__ import annotations

import re
import unicodedata
from typing import Final

# 学習パイプライン・DB で使用するラベル
RACE_CLASS_UNKNOWN: Final[str] = "不明"

# NFKC 後は GⅡ→GII となるため、長い表記（GIII→GII→GI）を先に判定する
_GRADE_G3: Final[tuple[re.Pattern[str], ...]] = (
    re.compile(r"G\s*III", re.I),
    re.compile(r"Ｇ\s*III", re.I),
    re.compile(r"G\s*3(?!\d)", re.I),
    re.compile(r"Jpn\s*III", re.I),
    re.compile(r"全障[ＧG]\s*III", re.I),
)

_GRADE_G2: Final[tuple[re.Pattern[str], ...]] = (
    re.compile(r"G\s*II(?!I)", re.I),
    re.compile(r"Ｇ\s*II(?!I)", re.I),
    re.compile(r"G\s*2(?!\d)", re.I),
    re.compile(r"Jpn\s*II(?!I)", re.I),
)

_GRADE_G1: Final[tuple[re.Pattern[str], ...]] = (
    re.compile(r"G\s*I(?!I)", re.I),
    re.compile(r"Ｇ\s*I(?!I)", re.I),
    re.compile(r"G\s*1(?!\d)", re.I),
    re.compile(r"Jpn\s*I(?!I)", re.I),
    re.compile(r"全障[ＧG]\s*I(?!I)", re.I),
)

# リステッド: (L) 表記・全角括弧・英語表記（オープンより先に判定）
_LISTED_PATTERNS: Final[tuple[re.Pattern[str], ...]] = (
    re.compile(re.escape("(L)"), re.I),
    re.compile(re.escape("（L）"), re.I),
    re.compile(r"（\s*L\s*）"),
    re.compile(r"\(\s*L\s*\)", re.I),
    re.compile(r"リステッド", re.I),
    re.compile(r"Listed", re.I),
    re.compile(r"(?:賞|ステークス|S)L(?:戦|$)", re.I),
)

_OP_PATTERNS: Final[tuple[re.Pattern[str], ...]] = (
    re.compile(r"オープン"),
    re.compile(r"オｰプン"),
    re.compile(r"\bOP\b", re.I),
    re.compile(r"ＯＰ"),
)

_WIN_CLASS_RULES: Final[tuple[tuple[re.Pattern[str], str], ...]] = (
    (re.compile(r"3勝クラス|３勝クラス|1600万下|1600万"), "3勝クラス"),
    (re.compile(r"2勝クラス|２勝クラス|1000万下|1000万"), "2勝クラス"),
    (re.compile(r"1勝クラス|１勝クラス|500万下|500万"), "1勝クラス"),
)

_SHINBA: Final[re.Pattern[str]] = re.compile(r"新馬")
_MAIDEN: Final[re.Pattern[str]] = re.compile(r"未勝利|未出走")
_TOKUBETSU: Final[re.Pattern[str]] = re.compile(r"特別")


def _normalize_text(*parts: str) -> str:
    """NFKC 正規化し、検索用に空白を除去した連結テキストを返す。"""
    raw = " ".join(p for p in parts if p)
    text = unicodedata.normalize("NFKC", raw)
    return text.replace(" ", "").replace("\u3000", "")


def _matches_any(text: str, patterns: tuple[re.Pattern[str], ...]) -> bool:
    return any(p.search(text) for p in patterns)


def _grade_from_text(text: str) -> str | None:
    """
    G1〜G3 を抽出。複数ヒット時は **右端** の表記を採用（info2 の「GIIではなくG1」等）。
    判定順は G3→G2→G1 のパターン長優先ではなく、出現位置で決める。
    """
    hits: list[tuple[int, str]] = []
    for label, patterns in (
        ("G3", _GRADE_G3),
        ("G2", _GRADE_G2),
        ("G1", _GRADE_G1),
    ):
        for pattern in patterns:
            m = pattern.search(text)
            if m:
                hits.append((m.start(), label))
                break
    if not hits:
        return None
    return max(hits, key=lambda x: x[0])[1]


def _win_class_from_text(text: str) -> str | None:
    for pattern, label in _WIN_CLASS_RULES:
        if pattern.search(text):
            return label
    return None


def normalize_grade_token(grade: str | None) -> str | None:
    """
    外部ソースの raceGrade / grade 表記を race_class ラベルへ正規化する。
    例: G1, GI, ＧⅠ, jpn1, JpnII, listed, L
    """
    if grade is None:
        return None
    g = _normalize_text(str(grade)).upper()
    if not g:
        return None
    g = g.replace("JPN", "G")

    if g in {"G1", "GI"}:
        return "G1"
    if g in {"G2", "GII"}:
        return "G2"
    if g in {"G3", "GIII"}:
        return "G3"
    if g in {"L", "LISTED"}:
        return "L"
    if g in {"OPEN", "OP"}:
        return "OP"
    return None


def infer_race_class(title: str = "", info2: str = "") -> str:
    """
    レース名 (title) とレース情報 (info2) から race_class を推定する。

    優先順位: G1→G3 → リステッド(L) → 勝利クラス明示 → 新馬/未勝利 → オープン
    → 特別（勝利クラス再マップ）→ 不明

    Args:
        title: レース名（netkeiba race_name 等）
        info2: レース条件テキスト（RaceData01 / data_intro 等の結合文）

    Returns:
        G1, G2, G3, L, OP, 3勝クラス, 2勝クラス, 1勝クラス, 新馬, 未勝利, 不明
    """
    compact = _normalize_text(title, info2)
    if not compact:
        return RACE_CLASS_UNKNOWN

    grade = _grade_from_text(_normalize_text(title))
    if grade is None and info2:
        grade = _grade_from_text(compact)
    if grade is not None:
        return grade

    if _matches_any(compact, _LISTED_PATTERNS):
        return "L"

    win_cls = _win_class_from_text(compact)
    if win_cls is not None:
        return win_cls

    if _SHINBA.search(compact):
        return "新馬"
    if _MAIDEN.search(compact):
        return "未勝利"

    if _matches_any(compact, _OP_PATTERNS):
        return "OP"

    # 「特別」単独で OP にせず、info2 / レース名内の勝利クラス表記を再探索
    if _TOKUBETSU.search(compact):
        # info2 側に条件クラスが載ることが多い（例: 3歳以上2勝クラス）
        info_compact = _normalize_text("", info2)
        win_from_info = _win_class_from_text(info_compact) if info_compact else None
        if win_from_info is not None:
            return win_from_info
        win_from_title = _win_class_from_text(_normalize_text(title))
        if win_from_title is not None:
            return win_from_title
        # グレード競走の特別（賞名のみ）→ オープン特別として OP
        return "OP"

    return RACE_CLASS_UNKNOWN
