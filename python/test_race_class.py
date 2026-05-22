"""race_class モジュールの単体テスト。"""

import unittest

from race_class import infer_race_class, normalize_grade_token


class TestInferRaceClass(unittest.TestCase):
    def test_g1_roman_variants(self) -> None:
        self.assertEqual(infer_race_class("天皇賞（G1）"), "G1")
        self.assertEqual(infer_race_class("ジャパンカップ GⅠ"), "G1")
        self.assertEqual(infer_race_class("有馬記念", "GIIではなくG1"), "G1")

    def test_g2_g3(self) -> None:
        self.assertEqual(infer_race_class("阪神大賞典 GⅡ"), "G2")
        self.assertEqual(infer_race_class("京王杯 G3"), "G3")
        self.assertEqual(infer_race_class("NHKマイルC", "ＧⅢ"), "G3")

    def test_listed_not_open(self) -> None:
        self.assertEqual(infer_race_class("京王杯スプリングC（L）"), "L")
        self.assertEqual(infer_race_class("オーシャンステークス", "リステッド競走"), "L")
        self.assertEqual(infer_race_class("Listed Stakes"), "L")

    def test_open_without_listed(self) -> None:
        self.assertEqual(infer_race_class("目黒記念", "4歳以上オープン"), "OP")
        self.assertEqual(infer_race_class("オープン特別"), "OP")

    def test_win_classes(self) -> None:
        self.assertEqual(infer_race_class("3歳1勝クラス"), "1勝クラス")
        self.assertEqual(infer_race_class("2勝クラス"), "2勝クラス")
        self.assertEqual(infer_race_class("1600万下"), "3勝クラス")

    def test_tokubetsu_remap_to_win_class(self) -> None:
        self.assertEqual(
            infer_race_class("中山金杯", "4歳以上2勝クラス特別"),
            "2勝クラス",
        )
        self.assertEqual(
            infer_race_class("迎春ステークス", "3歳以上1勝クラス"),
            "1勝クラス",
        )

    def test_shinba_maiden(self) -> None:
        self.assertEqual(infer_race_class("新馬戦"), "新馬")
        self.assertEqual(infer_race_class("未勝利"), "未勝利")

    def test_listed_before_open_in_name(self) -> None:
        self.assertEqual(infer_race_class("オープン(L)"), "L")

    def test_normalize_grade_token(self) -> None:
        self.assertEqual(normalize_grade_token("G1"), "G1")
        self.assertEqual(normalize_grade_token("ＧⅡ"), "G2")
        self.assertEqual(normalize_grade_token("Jpn3"), "G3")
        self.assertEqual(normalize_grade_token("Listed"), "L")
        self.assertEqual(normalize_grade_token("OP"), "OP")
        self.assertIsNone(normalize_grade_token("S"))


if __name__ == "__main__":
    unittest.main()
