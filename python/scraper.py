"""
競馬予想AIシステム - データ収集モジュール
netkeibaからレース結果・馬情報・血統情報をスクレイピングする

【確認済みURL構造】
- 日別レース一覧: https://db.netkeiba.com/race/list/YYYYMMDD/
- レース結果:     https://db.netkeiba.com/race/{race_id}/
- 馬過去成績:     https://db.netkeiba.com/horse/{horse_id}/   (AJAX動的)
- 血統:           https://db.netkeiba.com/horse/ped/{horse_id}/

【race_id形式】12桁: YYYY + VV(場コード) + KK(開催回) + NN(日目) + RR(レース番号)
  例: 202506010901 = 2025年 / 06=中山 / 01回 / 09日目 / 01レース
"""

import re
import time
import logging
import sqlite3
from datetime import date, timedelta
from datetime import datetime
from typing import Optional

import pandas as pd
from bs4 import BeautifulSoup
from selenium import webdriver
from selenium.webdriver.chrome.options import Options
from selenium.webdriver.common.by import By
from selenium.webdriver.support.ui import WebDriverWait
from selenium.webdriver.support import expected_conditions as EC
from tqdm import tqdm

import requests
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry

from config import (
    BASE_URL, RACE_URL, HORSE_URL, PED_URL,
    REQUEST_INTERVAL, REQUEST_TIMEOUT, MAX_RETRY,
    HEADLESS, TARGET_YEARS,
    DB_PATH, LOG_FILE, LOG_LEVEL,
)

# ============================================================
# ロガー設定
# ============================================================
logging.basicConfig(
    level=getattr(logging, LOG_LEVEL),
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    handlers=[
        logging.FileHandler(LOG_FILE, encoding="utf-8"),
        logging.StreamHandler(),
    ],
)
logger = logging.getLogger(__name__)

# ============================================================
# 場コードマップ（JRA + 主要NAR地方競馬）
# ============================================================
VENUE_CODE_MAP = {
    # JRA 中央競馬
    "01": "札幌",  "02": "函館",  "03": "福島",  "04": "新潟",
    "05": "東京",  "06": "中山",  "07": "中京",  "08": "京都",
    "09": "阪神",  "10": "小倉",
    # NAR 地方競馬
    "30": "門別",  "31": "北見",  "32": "岩見沢", "33": "帯広",
    "34": "旭川",  "35": "盛岡",  "36": "水沢",   "37": "上山",
    "38": "三条",  "39": "足利",  "40": "宇都宮", "41": "高崎",
    "42": "浦和",  "43": "船橋",  "44": "大井",   "45": "川崎",
    "46": "金沢",  "47": "笠松",  "48": "名古屋", "50": "園田",
    "51": "姫路",  "52": "益田",  "53": "福山",   "54": "高知",
    "55": "佐賀",  "56": "荒尾",  "57": "中津",
}


# ============================================================
# Scraper クラス
# ============================================================
class Scraper:
    """
    netkeibaスクレイパー（制限なし全件収集）

    取得戦略:
    - race_id一覧: 日付ベースで全開催日を巡回 → JRA/NAR問わず全レース取得
    - レース結果:  Selenium（ページが動的レンダリングのため）
    - 馬過去成績:  Selenium（AJAXロードのため）
    - 血統:        requests + BeautifulSoup（静的ページ）
    - 全データはSQLiteに保存、取得済みはスキップ
    """

    # race_table_01 の列インデックス（実サイト確認済み）
    COL_FINISH_POS   = 0
    COL_FRAME_NUM    = 1
    COL_HORSE_NUM    = 2
    COL_HORSE_NAME   = 3
    COL_SEX_AGE      = 4
    COL_WEIGHT_CARR  = 5
    COL_JOCKEY       = 6
    COL_FINISH_TIME  = 7
    COL_MARGIN       = 8
    COL_ODDS         = 9   # 単勝オッズ
    COL_POPULARITY   = 10  # 人気
    COL_BODY_WEIGHT  = 11  # 馬体重 "480(+4)"
    COL_TRAINER      = 12
    COL_OWNER        = 13
    COL_PRIZE        = 14  # 賞金

    # db_h_race_results の列インデックス（実サイト確認済み）
    HR_DATE        = 0
    HR_VENUE       = 1
    HR_WEATHER     = 2
    HR_RACE_NUM    = 3
    HR_RACE_NAME   = 4
    HR_MOVIE       = 5   # 映像リンク（スキップ）
    HR_HORSE_COUNT = 6
    HR_FRAME_NUM   = 7
    HR_HORSE_NUM   = 8
    HR_ODDS        = 9
    HR_POPULARITY  = 10
    HR_FINISH_POS  = 11
    HR_JOCKEY      = 12
    HR_WEIGHT_CARR = 13
    HR_COURSE      = 14  # "芝1600右" 形式
    HR_GROUND      = 15
    HR_GROUND_IDX  = 16  # 馬場指数（スキップ可）
    HR_FINISH_TIME = 17
    HR_MARGIN      = 18
    HR_PACE        = 19  # ペース
    HR_FINAL_3F    = 20  # 上がり3ハロン
    HR_BODY_WEIGHT = 21
    HR_PASSAGE     = 22  # 通過順位（コーナー通過順）
    HR_PRIZE       = 23

    def __init__(self, db_path: str = str(DB_PATH)):
        self.db_path = db_path
        self.session = self._build_session()
        self._driver: Optional[webdriver.Chrome] = None
        self._init_db()

    # ----------------------------------------------------------
    # セッション・Driver初期化
    # ----------------------------------------------------------
    def _build_session(self) -> requests.Session:
        """リトライ付きrequestsセッションを作成する"""
        session = requests.Session()
        retry = Retry(
            total=MAX_RETRY,
            backoff_factor=1.5,
            status_forcelist=[429, 500, 502, 503, 504],
        )
        adapter = HTTPAdapter(max_retries=retry)
        session.mount("http://", adapter)
        session.mount("https://", adapter)
        session.headers.update({
            "User-Agent": (
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                "AppleWebKit/537.36 (KHTML, like Gecko) "
                "Chrome/124.0.0.0 Safari/537.36"
            ),
            "Accept-Language": "ja-JP,ja;q=0.9",
            "Accept-Encoding": "gzip, deflate, br",
        })
        return session

    def _get_driver(self) -> webdriver.Chrome:
        """Seleniumドライバをシングルトンで返す（初回のみ起動）"""
        if self._driver is None:
            options = Options()
            if HEADLESS:
                options.add_argument("--headless=new")
            options.add_argument("--no-sandbox")
            options.add_argument("--disable-dev-shm-usage")
            options.add_argument("--disable-gpu")
            options.add_argument("--window-size=1280,960")
            options.add_argument("--disable-blink-features=AutomationControlled")
            options.add_experimental_option("excludeSwitches", ["enable-automation"])
            options.add_argument(
                "user-agent=Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                "AppleWebKit/537.36 (KHTML, like Gecko) "
                "Chrome/124.0.0.0 Safari/537.36"
            )
            self._driver = webdriver.Chrome(options=options)
            self._driver.set_page_load_timeout(REQUEST_TIMEOUT)
            logger.info("Chrome WebDriver 起動")
        return self._driver

    def close(self) -> None:
        """Seleniumドライバを終了する"""
        if self._driver is not None:
            self._driver.quit()
            self._driver = None
            logger.info("Chrome WebDriver 終了")

    def __enter__(self) -> "Scraper":
        return self

    def __exit__(self, *args) -> None:
        self.close()

    # ----------------------------------------------------------
    # DB初期化
    # ----------------------------------------------------------
    def _init_db(self) -> None:
        """SQLiteテーブルを初期化する"""
        with sqlite3.connect(self.db_path) as conn:
            conn.executescript("""
                PRAGMA journal_mode=WAL;

                CREATE TABLE IF NOT EXISTS race_id_cache (
                    race_date   TEXT NOT NULL,
                    race_id     TEXT NOT NULL,
                    PRIMARY KEY (race_id)
                );

                CREATE TABLE IF NOT EXISTS scraped_dates (
                    race_date   TEXT PRIMARY KEY,
                    scraped_at  TEXT
                );

                CREATE TABLE IF NOT EXISTS race_info (
                    race_id      TEXT PRIMARY KEY,
                    race_date    TEXT,
                    venue        TEXT,
                    venue_code   TEXT,
                    race_number  INTEGER,
                    race_name    TEXT,
                    surface      TEXT,
                    distance     INTEGER,
                    around       TEXT,
                    weather      TEXT,
                    ground_state TEXT,
                    horse_count  INTEGER,
                    race_class   TEXT,
                    prize_total  TEXT,
                    scraped_at   TEXT
                );

                CREATE TABLE IF NOT EXISTS race_results (
                    id               INTEGER PRIMARY KEY AUTOINCREMENT,
                    race_id          TEXT NOT NULL,
                    finish_pos       INTEGER,
                    frame_number     INTEGER,
                    horse_number     INTEGER,
                    horse_id         TEXT,
                    horse_name       TEXT,
                    sex              TEXT,
                    age              INTEGER,
                    weight_carried   REAL,
                    jockey_id        TEXT,
                    jockey_name      TEXT,
                    finish_time      TEXT,
                    finish_time_sec  REAL,
                    margin           TEXT,
                    odds             REAL,
                    popularity       INTEGER,
                    body_weight      INTEGER,
                    body_weight_diff INTEGER,
                    trainer_id       TEXT,
                    trainer_name     TEXT,
                    prize            REAL,
                    UNIQUE(race_id, horse_number)
                );

                CREATE TABLE IF NOT EXISTS payouts (
                    id           INTEGER PRIMARY KEY AUTOINCREMENT,
                    race_id      TEXT NOT NULL,
                    ticket_type  TEXT,
                    combination  TEXT,
                    payout       INTEGER,
                    popularity   INTEGER
                );

                CREATE TABLE IF NOT EXISTS horse_results (
                    id               INTEGER PRIMARY KEY AUTOINCREMENT,
                    horse_id         TEXT NOT NULL,
                    race_date        TEXT,
                    venue            TEXT,
                    weather          TEXT,
                    race_number      INTEGER,
                    race_name        TEXT,
                    surface          TEXT,
                    distance         INTEGER,
                    around           TEXT,
                    ground_state     TEXT,
                    horse_count      INTEGER,
                    frame_number     INTEGER,
                    horse_number     INTEGER,
                    odds             REAL,
                    popularity       INTEGER,
                    finish_pos       INTEGER,
                    jockey_name      TEXT,
                    weight_carried   REAL,
                    finish_time      TEXT,
                    margin           TEXT,
                    pace             TEXT,
                    final_3f         REAL,
                    body_weight      INTEGER,
                    body_weight_diff INTEGER,
                    passage_rank     TEXT,
                    prize            REAL,
                    race_class       TEXT,
                    UNIQUE(horse_id, race_date, race_number)
                );

                CREATE TABLE IF NOT EXISTS pedigree (
                    horse_id      TEXT PRIMARY KEY,
                    sire          TEXT,
                    dam           TEXT,
                    dam_sire      TEXT,
                    sire_sire     TEXT,
                    sire_dam      TEXT,
                    dam_sire_sire TEXT,
                    dam_sire_dam  TEXT,
                    scraped_at    TEXT
                );
            """)
            conn.commit()
        logger.info("Database initialized: %s", self.db_path)

    # ----------------------------------------------------------
    # race_id 一覧取得（日付ベース・制限なし）
    # ----------------------------------------------------------
    def get_race_id_list(
        self,
        years: list[int] | None = None,
        start_date: str | None = None,
        end_date: str | None = None,
        jra_only: bool = False,
    ) -> list[str]:
        """
        日付を1日ずつ巡回して全race_idを取得する（制限なし）。

        URL: https://db.netkeiba.com/race/list/YYYYMMDD/

        Args:
            years:      対象年リスト（指定時は各年の1/1〜12/31を巡回）
            start_date: 開始日 "YYYY-MM-DD"（yearsと排他）
            end_date:   終了日 "YYYY-MM-DD"（yearsと排他）
            jra_only:   True の場合 venue_code 01-10 (JRA) のみ保持

        Returns:
            race_idのリスト（重複なし・日付昇順）
        """
        if years is None and start_date is None:
            years = TARGET_YEARS

        # 日付範囲を構築
        date_list: list[date] = []
        if years:
            for y in years:
                d = date(y, 1, 1)
                while d.year == y:
                    date_list.append(d)
                    d += timedelta(days=1)
        else:
            d = datetime.strptime(start_date, "%Y-%m-%d").date()
            end = datetime.strptime(end_date, "%Y-%m-%d").date()
            while d <= end:
                date_list.append(d)
                d += timedelta(days=1)

        race_ids: list[str] = []

        # 既取得の日付をスキップ
        with sqlite3.connect(self.db_path) as conn:
            done_dates = {
                row[0]
                for row in conn.execute("SELECT race_date FROM scraped_dates").fetchall()
            }
            cached_ids = [
                row[0]
                for row in conn.execute("SELECT race_id FROM race_id_cache").fetchall()
            ]
        race_ids.extend(cached_ids)

        pending_dates = [d for d in date_list if d.strftime("%Y-%m-%d") not in done_dates]
        logger.info(
            "日付スキャン: 全%d日 / 未取得%d日", len(date_list), len(pending_dates)
        )

        for d in tqdm(pending_dates, desc="日付スキャン", unit="日"):
            date_str = d.strftime("%Y%m%d")
            url = f"https://db.netkeiba.com/race/list/{date_str}/"
            new_ids = self._fetch_race_ids_for_date(url, date_str)
            if new_ids:
                race_ids.extend(new_ids)
                # キャッシュ保存
                with sqlite3.connect(self.db_path) as conn:
                    conn.executemany(
                        "INSERT OR IGNORE INTO race_id_cache(race_date, race_id) VALUES(?,?)",
                        [(d.strftime("%Y-%m-%d"), rid) for rid in new_ids],
                    )
                    conn.execute(
                        "INSERT OR REPLACE INTO scraped_dates(race_date, scraped_at) VALUES(?,?)",
                        (d.strftime("%Y-%m-%d"), datetime.now().isoformat()),
                    )
                    conn.commit()
            time.sleep(REQUEST_INTERVAL)

        # 重複除去・ソート
        race_ids = sorted(set(race_ids))

        # JRAのみフィルタ
        if jra_only:
            race_ids = [
                rid for rid in race_ids
                if rid[4:6] in {f"{i:02d}" for i in range(1, 11)}
            ]

        logger.info("取得race_id総数: %d件", len(race_ids))
        return race_ids

    def _fetch_race_ids_for_date(self, url: str, date_str: str) -> list[str]:
        """
        1日分のレース一覧ページから全race_idを抽出する。
        requests で取得し、JS不要な静的リンクを解析する。
        """
        try:
            resp = self.session.get(url, timeout=REQUEST_TIMEOUT)
            resp.encoding = "EUC-JP"
            soup = BeautifulSoup(resp.text, "html.parser")
        except Exception as e:
            logger.warning("日付ページ取得失敗 date=%s: %s", date_str, e)
            return []

        ids = []
        for a in soup.find_all("a", href=True):
            m = re.search(r"/race/(\d{12})/", a["href"])
            if m:
                ids.append(m.group(1))

        ids = list(dict.fromkeys(ids))  # 重複除去・順序保持
        if ids:
            logger.debug("  %s: %d件", date_str, len(ids))
        return ids

    # ----------------------------------------------------------
    # レース結果スクレイピング（Selenium）
    # ----------------------------------------------------------
    def scrape_race(self, race_id: str) -> bool:
        """
        1レースのデータをSeleniumで取得してDBに保存する。
        - レース結果テーブル（race_table_01）
        - レース情報（コース・天気・馬場状態）
        - 払い戻しテーブル（pay_table_01）

        Returns:
            True: 成功 / False: スキップ or 失敗
        """
        # 取得済みスキップ
        with sqlite3.connect(self.db_path) as conn:
            if conn.execute(
                "SELECT 1 FROM race_info WHERE race_id=?", (race_id,)
            ).fetchone():
                return True

        url = RACE_URL.format(race_id=race_id)
        driver = self._get_driver()

        try:
            driver.get(url)
            # レース結果テーブルが描画されるまで待機
            WebDriverWait(driver, 20).until(
                EC.presence_of_element_located(
                    (By.CSS_SELECTOR, "table.race_table_01, table.Tx_r")
                )
            )
            time.sleep(0.5)  # 追加描画の余裕
            soup = BeautifulSoup(driver.page_source, "html.parser")
        except Exception as e:
            logger.error("レースページ読込失敗 race_id=%s: %s", race_id, e)
            return False
        finally:
            time.sleep(REQUEST_INTERVAL)

        # 解析
        race_info = self._parse_race_info(soup, race_id)
        if race_info is None:
            return False

        results_df = self._parse_race_results(soup, race_id)
        payouts_df = self._parse_payouts(soup, race_id)

        # DB保存
        with sqlite3.connect(self.db_path) as conn:
            conn.execute(
                """INSERT OR REPLACE INTO race_info
                   (race_id, race_date, venue, venue_code, race_number, race_name,
                    surface, distance, around, weather, ground_state,
                    horse_count, race_class, prize_total, scraped_at)
                   VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
                (
                    race_info["race_id"],    race_info["race_date"],
                    race_info["venue"],      race_info["venue_code"],
                    race_info["race_number"],race_info["race_name"],
                    race_info["surface"],    race_info["distance"],
                    race_info["around"],     race_info["weather"],
                    race_info["ground_state"],race_info["horse_count"],
                    race_info["race_class"], race_info["prize_total"],
                    datetime.now().isoformat(),
                ),
            )
            if not results_df.empty:
                results_df.to_sql("race_results", conn, if_exists="append", index=False)
            if not payouts_df.empty:
                payouts_df.to_sql("payouts", conn, if_exists="append", index=False)
            conn.commit()

        return True

    def _parse_race_info(self, soup: BeautifulSoup, race_id: str) -> dict | None:
        """レースメタ情報を解析する"""
        try:
            # レース名（複数のセレクタに対応）
            for sel in [".RaceName", ".race_name", "h1.RaceName", "div.RaceMainColumn h1"]:
                tag = soup.select_one(sel)
                if tag:
                    race_name = tag.get_text(strip=True)
                    break
            else:
                # title から推定
                title_tag = soup.find("title")
                race_name = title_tag.get_text(strip=True) if title_tag else ""

            # 日付・場コード・レース番号を race_id から確定
            venue_code = race_id[4:6]
            venue = VENUE_CODE_MAP.get(venue_code, f"会場{venue_code}")
            race_number = int(race_id[10:12])

            raw_date = race_id[:8]
            try:
                race_date = datetime.strptime(raw_date, "%Y%m%d").strftime("%Y-%m-%d")
            except ValueError:
                race_date = raw_date

            # コース・天気・馬場状態（複数のセレクタ対応）
            surface, distance, around = "芝", 0, ""
            weather, ground_state = "", ""
            prize_total = ""

            info_text = ""
            for sel in [".RaceData01", ".data_intro", ".RaceInfo", ".race_data"]:
                tag = soup.select_one(sel)
                if tag:
                    info_text = tag.get_text(" ", strip=True)
                    break

            if info_text:
                # 芝/ダート + 距離
                m = re.search(r"(芝|ダ(?:ート)?)\s*(\d{3,4})\s*m", info_text)
                if m:
                    surface = "芝" if "芝" in m.group(1) else "ダート"
                    distance = int(m.group(2))
                # 右/左/直線
                if "右" in info_text:
                    around = "右"
                elif "左" in info_text:
                    around = "左"
                elif "直" in info_text:
                    around = "直線"
                # 天候
                m_w = re.search(r"天候\s*[:：]\s*([^\s/／]+)", info_text)
                if m_w:
                    weather = m_w.group(1).strip()
                # 馬場状態
                m_g = re.search(r"馬場\s*[:：]\s*([良稍重不]+)", info_text)
                if m_g:
                    ground_state = m_g.group(1).strip()

            # 距離が取れていない場合は page title から試みる
            if distance == 0:
                full_text = soup.get_text(" ")
                m2 = re.search(r"(芝|ダ(?:ート)?)\s*(\d{3,4})\s*m", full_text)
                if m2:
                    surface = "芝" if "芝" in m2.group(1) else "ダート"
                    distance = int(m2.group(2))

            # 出走頭数
            result_table = soup.select_one("table.race_table_01")
            horse_count = 0
            if result_table:
                horse_count = len(result_table.select("tr")) - 1

            # レースクラス
            race_class = self._infer_race_class(race_name, info_text)

            return {
                "race_id":     race_id,
                "race_date":   race_date,
                "venue":       venue,
                "venue_code":  venue_code,
                "race_number": race_number,
                "race_name":   race_name,
                "surface":     surface,
                "distance":    distance,
                "around":      around,
                "weather":     weather,
                "ground_state":ground_state,
                "horse_count": horse_count,
                "race_class":  race_class,
                "prize_total": prize_total,
            }
        except Exception as e:
            logger.error("race_info解析エラー race_id=%s: %s", race_id, e)
            return None

    def _infer_race_class(self, race_name: str, extra_text: str = "") -> str:
        """レース名・テキストからクラスを推定する"""
        text = race_name + " " + extra_text
        patterns = [
            (["GⅠ", "G1", "GI"],         "G1"),
            (["GⅡ", "G2", "GII"],         "G2"),
            (["GⅢ", "G3", "GIII"],        "G3"),
            (["Listed", "L "],             "L"),
            (["オープン", "オｰプン"],       "OP"),
            (["3勝クラス", "1600万"],       "3勝クラス"),
            (["2勝クラス", "1000万"],       "2勝クラス"),
            (["1勝クラス",  "500万"],       "1勝クラス"),
            (["新馬"],                      "新馬"),
            (["未勝利"],                    "未勝利"),
        ]
        for keywords, cls in patterns:
            if any(k in text for k in keywords):
                return cls
        return "不明"

    def _parse_race_results(self, soup: BeautifulSoup, race_id: str) -> pd.DataFrame:
        """
        race_table_01 を解析してDataFrameを返す。

        列構成（実サイト確認済み）:
          0:着順 1:枠番 2:馬番 3:馬名 4:性齢 5:斤量 6:騎手 7:タイム
          8:着差 9:単勝 10:人気 11:馬体重 12:調教師 13:馬主 14:賞金
        """
        table = soup.select_one("table.race_table_01")
        if table is None:
            logger.warning("race_table_01 not found: %s", race_id)
            return pd.DataFrame()

        rows = []
        for tr in table.select("tr")[1:]:
            tds = tr.select("td")
            if len(tds) < 10:
                continue
            try:
                # 着順（数字のみ受け付け。取消・除外等は除外）
                finish_text = tds[self.COL_FINISH_POS].get_text(strip=True)
                if not re.match(r"^\d{1,2}$", finish_text):
                    continue
                finish_pos = int(finish_text)

                # 馬ID（href="/horse/xxxxxxxx/"）
                horse_link = tr.select_one("a[href*='/horse/']")
                horse_id = ""
                if horse_link:
                    m = re.search(r"/horse/(\w+)/?", horse_link.get("href", ""))
                    horse_id = m.group(1) if m else ""

                # 騎手ID（href="/jockey/result/recent/xxxxx/" or "/jockey/xxxxx/"）
                jockey_link = tr.select_one("a[href*='/jockey/']")
                jockey_id = ""
                if jockey_link:
                    m = re.search(r"/jockey/(?:result/recent/)?(\w+)/?", jockey_link.get("href", ""))
                    jockey_id = m.group(1) if m else ""

                # 調教師ID（href="/trainer/xxxxx/"）
                trainer_link = tr.select_one("a[href*='/trainer/']")
                trainer_id = ""
                if trainer_link:
                    m = re.search(r"/trainer/(\w+)/?", trainer_link.get("href", ""))
                    trainer_id = m.group(1) if m else ""

                # 性齢（"牡3", "牝4", "セ5"）
                sex_age = tds[self.COL_SEX_AGE].get_text(strip=True)
                sex = re.match(r"[牡牝セ騸]", sex_age)
                sex = sex.group(0) if sex else ""
                age_m = re.search(r"\d+", sex_age)
                age = int(age_m.group(0)) if age_m else None

                # 馬体重 "480(+4)" or "480(-2)"
                weight_text = tds[self.COL_BODY_WEIGHT].get_text(strip=True) if len(tds) > self.COL_BODY_WEIGHT else ""
                body_weight, body_weight_diff = None, None
                mw = re.match(r"(\d+)\(([+-]?\d+)\)", weight_text)
                if mw:
                    body_weight = int(mw.group(1))
                    body_weight_diff = int(mw.group(2))

                # タイム → 秒
                finish_time_str = tds[self.COL_FINISH_TIME].get_text(strip=True)
                finish_time_sec = self._time_to_sec(finish_time_str)

                # 賞金
                prize_text = tds[self.COL_PRIZE].get_text(strip=True).replace(",", "") if len(tds) > self.COL_PRIZE else ""
                prize = self._to_float(prize_text)

                rows.append({
                    "race_id":         race_id,
                    "finish_pos":      finish_pos,
                    "frame_number":    self._to_int(tds[self.COL_FRAME_NUM].get_text(strip=True)),
                    "horse_number":    self._to_int(tds[self.COL_HORSE_NUM].get_text(strip=True)),
                    "horse_id":        horse_id,
                    "horse_name":      tds[self.COL_HORSE_NAME].get_text(strip=True),
                    "sex":             sex,
                    "age":             age,
                    "weight_carried":  self._to_float(tds[self.COL_WEIGHT_CARR].get_text(strip=True)),
                    "jockey_id":       jockey_id,
                    "jockey_name":     tds[self.COL_JOCKEY].get_text(strip=True),
                    "finish_time":     finish_time_str,
                    "finish_time_sec": finish_time_sec,
                    "margin":          tds[self.COL_MARGIN].get_text(strip=True),
                    "odds":            self._to_float(tds[self.COL_ODDS].get_text(strip=True)),
                    "popularity":      self._to_int(tds[self.COL_POPULARITY].get_text(strip=True)),
                    "body_weight":     body_weight,
                    "body_weight_diff":body_weight_diff,
                    "trainer_id":      trainer_id,
                    "trainer_name":    tds[self.COL_TRAINER].get_text(strip=True) if len(tds) > self.COL_TRAINER else "",
                    "prize":           prize,
                })
            except Exception as e:
                logger.debug("row parse error race_id=%s: %s", race_id, e)
                continue

        return pd.DataFrame(rows)

    def _parse_payouts(self, soup: BeautifulSoup, race_id: str) -> pd.DataFrame:
        """
        pay_table_01 から払い戻し情報を解析する。
        各行: [馬券種別 | 組み合わせ | 払戻金 | 人気]
        """
        rows = []
        for table in soup.select("table.pay_table_01"):
            for tr in table.select("tr"):
                tds = tr.select("td")
                if len(tds) < 3:
                    continue
                try:
                    ticket_type = tds[0].get_text(strip=True)
                    # 組み合わせは改行で複数ある場合がある
                    combos_raw = tds[1].get_text("\n", strip=True).split("\n")
                    combos = [c.strip() for c in combos_raw if c.strip()]
                    # 払戻金（カンマ区切りの数字）
                    pay_strs = re.findall(r"[\d,]+円", tds[2].get_text())
                    payouts_val = [int(p.replace(",", "").replace("円", "")) for p in pay_strs]
                    # 的中人気
                    pop_strs = re.findall(r"\d+", tds[3].get_text()) if len(tds) > 3 else []

                    for i, combo in enumerate(combos):
                        rows.append({
                            "race_id":    race_id,
                            "ticket_type":ticket_type,
                            "combination":combo,
                            "payout":     payouts_val[i] if i < len(payouts_val) else None,
                            "popularity": int(pop_strs[i]) if i < len(pop_strs) else None,
                        })
                except Exception as e:
                    logger.debug("payout parse error race_id=%s: %s", race_id, e)
                    continue

        return pd.DataFrame(rows)

    # ----------------------------------------------------------
    # 馬過去成績スクレイピング（Selenium + AJAX待機）
    # ----------------------------------------------------------
    def scrape_horse(self, horse_id: str, force: bool = False) -> bool:
        """
        馬の過去全成績をSeleniumで取得してDBに保存する。

        馬プロフィールページはAJAXロードのためSeleniumで描画完了を待つ。

        Args:
            horse_id: 10桁の馬ID
            force:    True の場合、取得済みでも再取得する（成績更新時に使用）
        """
        if not force:
            with sqlite3.connect(self.db_path) as conn:
                cnt = conn.execute(
                    "SELECT COUNT(*) FROM horse_results WHERE horse_id=?", (horse_id,)
                ).fetchone()[0]
                if cnt > 0:
                    return True

        url = HORSE_URL.format(horse_id=horse_id)
        driver = self._get_driver()

        try:
            driver.get(url)
            # AJAX完了 = db_h_race_results テーブルの出現を待つ
            WebDriverWait(driver, 25).until(
                EC.presence_of_element_located(
                    (By.CSS_SELECTOR, "table.db_h_race_results")
                )
            )
            time.sleep(0.5)
            soup = BeautifulSoup(driver.page_source, "html.parser")
        except Exception as e:
            logger.error("馬ページ読込失敗 horse_id=%s: %s", horse_id, e)
            return False
        finally:
            time.sleep(REQUEST_INTERVAL)

        table = soup.select_one("table.db_h_race_results")
        if table is None:
            logger.warning("db_h_race_results not found: horse_id=%s", horse_id)
            return False

        rows = []
        # th ヘッダー行以外の全 tr を処理（クラス名に依存しない）
        for tr in table.select("tbody tr, tr:not(:first-child)"):
            tds = tr.select("td")
            if len(tds) < 15:
                continue
            try:
                # 日付
                race_date_raw = tds[self.HR_DATE].get_text(strip=True)
                # コース文字列 "芝1600右" を分解
                course_text = tds[self.HR_COURSE].get_text(strip=True) if len(tds) > self.HR_COURSE else ""
                surface, distance, around = self._parse_course(course_text)

                # 馬体重
                bw_text = tds[self.HR_BODY_WEIGHT].get_text(strip=True) if len(tds) > self.HR_BODY_WEIGHT else ""
                body_weight, body_weight_diff = None, None
                mw = re.match(r"(\d+)\(([+-]?\d+)\)", bw_text)
                if mw:
                    body_weight = int(mw.group(1))
                    body_weight_diff = int(mw.group(2))

                # 上がり3F
                final_3f = self._to_float(
                    tds[self.HR_FINAL_3F].get_text(strip=True)
                ) if len(tds) > self.HR_FINAL_3F else None

                # 通過順位（コーナー通過順）
                passage = tds[self.HR_PASSAGE].get_text(strip=True) if len(tds) > self.HR_PASSAGE else ""

                # 着順（数字以外は除外）
                pos_text = tds[self.HR_FINISH_POS].get_text(strip=True)
                if not re.match(r"^\d{1,2}$", pos_text):
                    continue
                finish_pos = int(pos_text)

                # レースクラス（レース名から推定）
                rname = tds[self.HR_RACE_NAME].get_text(strip=True) if len(tds) > self.HR_RACE_NAME else ""
                race_class = self._infer_race_class(rname)

                rows.append({
                    "horse_id":        horse_id,
                    "race_date":       race_date_raw,
                    "venue":           tds[self.HR_VENUE].get_text(strip=True) if len(tds) > self.HR_VENUE else "",
                    "weather":         tds[self.HR_WEATHER].get_text(strip=True) if len(tds) > self.HR_WEATHER else "",
                    "race_number":     self._to_int(tds[self.HR_RACE_NUM].get_text(strip=True)) if len(tds) > self.HR_RACE_NUM else None,
                    "race_name":       rname,
                    "surface":         surface,
                    "distance":        distance,
                    "around":          around,
                    "ground_state":    tds[self.HR_GROUND].get_text(strip=True) if len(tds) > self.HR_GROUND else "",
                    "horse_count":     self._to_int(tds[self.HR_HORSE_COUNT].get_text(strip=True)) if len(tds) > self.HR_HORSE_COUNT else None,
                    "frame_number":    self._to_int(tds[self.HR_FRAME_NUM].get_text(strip=True)) if len(tds) > self.HR_FRAME_NUM else None,
                    "horse_number":    self._to_int(tds[self.HR_HORSE_NUM].get_text(strip=True)) if len(tds) > self.HR_HORSE_NUM else None,
                    "odds":            self._to_float(tds[self.HR_ODDS].get_text(strip=True)) if len(tds) > self.HR_ODDS else None,
                    "popularity":      self._to_int(tds[self.HR_POPULARITY].get_text(strip=True)) if len(tds) > self.HR_POPULARITY else None,
                    "finish_pos":      finish_pos,
                    "jockey_name":     tds[self.HR_JOCKEY].get_text(strip=True) if len(tds) > self.HR_JOCKEY else "",
                    "weight_carried":  self._to_float(tds[self.HR_WEIGHT_CARR].get_text(strip=True)) if len(tds) > self.HR_WEIGHT_CARR else None,
                    "finish_time":     tds[self.HR_FINISH_TIME].get_text(strip=True) if len(tds) > self.HR_FINISH_TIME else "",
                    "margin":          tds[self.HR_MARGIN].get_text(strip=True) if len(tds) > self.HR_MARGIN else "",
                    "pace":            tds[self.HR_PACE].get_text(strip=True) if len(tds) > self.HR_PACE else "",
                    "final_3f":        final_3f,
                    "body_weight":     body_weight,
                    "body_weight_diff":body_weight_diff,
                    "passage_rank":    passage,
                    "prize":           self._to_float(
                        tds[self.HR_PRIZE].get_text(strip=True).replace(",", "")
                    ) if len(tds) > self.HR_PRIZE else None,
                    "race_class":      race_class,
                })
            except Exception as e:
                logger.debug("horse row parse error horse_id=%s: %s", horse_id, e)
                continue

        if rows:
            df = pd.DataFrame(rows)
            with sqlite3.connect(self.db_path) as conn:
                if force:
                    conn.execute(
                        "DELETE FROM horse_results WHERE horse_id=?", (horse_id,)
                    )
                df.to_sql("horse_results", conn, if_exists="append", index=False)
                conn.commit()
            logger.debug("horse_results saved: horse_id=%s (%d rows)", horse_id, len(rows))

        return True

    # ----------------------------------------------------------
    # 血統スクレイピング（静的ページ）
    # ----------------------------------------------------------
    def scrape_pedigree(self, horse_id: str) -> bool:
        """
        馬の血統データ（父・母・母父など5代血統表）を取得してDBに保存する。
        血統ページは静的HTMLのため requests で取得。
        """
        with sqlite3.connect(self.db_path) as conn:
            if conn.execute(
                "SELECT 1 FROM pedigree WHERE horse_id=?", (horse_id,)
            ).fetchone():
                return True

        url = PED_URL.format(horse_id=horse_id)
        try:
            resp = self.session.get(url, timeout=REQUEST_TIMEOUT)
            resp.encoding = "EUC-JP"
            soup = BeautifulSoup(resp.text, "html.parser")
            time.sleep(REQUEST_INTERVAL)
        except Exception as e:
            logger.error("血統取得失敗 horse_id=%s: %s", horse_id, e)
            return False

        # 5代血統表（table.blood_table）
        # セル配置（左→右読み）:
        #   0:父, 1:父父, 2:父父父, 3:父父母 ... 31:母, 32:母父, ...
        ped_table = soup.select_one("table.blood_table")
        if ped_table is None:
            logger.warning("blood_table not found: horse_id=%s", horse_id)
            return False

        cells = [td.get_text(strip=True) for td in ped_table.select("td")]

        # 4代血統表のセル対応（netkeibaの実配置に準拠）
        # 父[0], 父父[1], 母[16], 母父[17]
        def get_cell(idx: int) -> str:
            return cells[idx] if idx < len(cells) else ""

        sire         = get_cell(0)
        sire_sire    = get_cell(1)
        sire_dam     = get_cell(8)
        dam          = get_cell(16)
        dam_sire     = get_cell(17)
        dam_sire_sire = get_cell(18)
        dam_sire_dam  = get_cell(22)

        with sqlite3.connect(self.db_path) as conn:
            conn.execute(
                """INSERT OR REPLACE INTO pedigree
                   (horse_id, sire, dam, dam_sire, sire_sire, sire_dam,
                    dam_sire_sire, dam_sire_dam, scraped_at)
                   VALUES (?,?,?,?,?,?,?,?,?)""",
                (
                    horse_id, sire, dam, dam_sire, sire_sire, sire_dam,
                    dam_sire_sire, dam_sire_dam, datetime.now().isoformat(),
                ),
            )
            conn.commit()

        return True

    # ----------------------------------------------------------
    # 一括収集メソッド（制限なし）
    # ----------------------------------------------------------
    def collect_all(
        self,
        years: list[int] | None = None,
        start_date: str | None = None,
        end_date: str | None = None,
        jra_only: bool = False,
        skip_horse: bool = False,
        skip_pedigree: bool = False,
    ) -> None:
        """
        全データを一括収集する（制限なし）。

        フロー:
        1. 日付ベースで全race_idを取得
        2. 各レースの結果・払い戻しを保存
        3. DBから全馬IDを取得
        4. 各馬の過去成績を保存
        5. 各馬の血統を保存

        Args:
            years:       対象年リスト（Noneで TARGET_YEARS を使用）
            start_date:  開始日 "YYYY-MM-DD"
            end_date:    終了日 "YYYY-MM-DD"
            jra_only:    JRAレースのみ（地方競馬除外）
            skip_horse:  馬過去成績収集をスキップ
            skip_pedigree: 血統収集をスキップ
        """
        logger.info("=== データ収集開始（制限なし） ===")

        try:
            # 1. race_id 全件取得
            race_ids = self.get_race_id_list(
                years=years,
                start_date=start_date,
                end_date=end_date,
                jra_only=jra_only,
            )
            logger.info("対象race_id: %d件", len(race_ids))

            # 2. レース結果収集
            logger.info("【Step 2】レース結果収集...")
            success = 0
            for race_id in tqdm(race_ids, desc="Race results", unit="レース"):
                if self.scrape_race(race_id):
                    success += 1
            logger.info("レース結果収集完了: %d/%d件", success, len(race_ids))

            # 3. 馬ID一覧をDBから取得（全件）
            with sqlite3.connect(self.db_path) as conn:
                horse_ids = [
                    row[0]
                    for row in conn.execute(
                        "SELECT DISTINCT horse_id FROM race_results "
                        "WHERE horse_id IS NOT NULL AND horse_id != ''"
                    ).fetchall()
                ]
            logger.info("馬ID総数: %d頭", len(horse_ids))

            if not skip_horse:
                # 4. 馬過去成績収集
                logger.info("【Step 3】馬過去成績収集...")
                for horse_id in tqdm(horse_ids, desc="Horse results", unit="頭"):
                    self.scrape_horse(horse_id)
                logger.info("馬過去成績収集完了")

            if not skip_pedigree:
                # 5. 血統収集
                logger.info("【Step 4】血統収集...")
                for horse_id in tqdm(horse_ids, desc="Pedigree", unit="頭"):
                    self.scrape_pedigree(horse_id)
                logger.info("血統収集完了")

        finally:
            self.close()

        logger.info("=== データ収集完了 ===")

    # ----------------------------------------------------------
    # ユーティリティ
    # ----------------------------------------------------------
    @staticmethod
    def _parse_course(text: str) -> tuple[str, int, str]:
        """
        "芝1600右" / "ダ1400" / "芝2400(外)" を分解する。
        Returns: (surface, distance, around)
        """
        surface = "芝"
        if re.search(r"ダ(?:ート)?", text):
            surface = "ダート"
        m = re.search(r"(\d{3,4})", text)
        distance = int(m.group(1)) if m else 0
        around = ""
        if "右" in text:
            around = "右"
        elif "左" in text:
            around = "左"
        elif "直" in text:
            around = "直線"
        return surface, distance, around

    @staticmethod
    def _time_to_sec(time_str: str) -> Optional[float]:
        """'1:33.5' → 93.5"""
        if not time_str:
            return None
        m = re.match(r"(\d+):(\d+\.\d+)", time_str.strip())
        if m:
            return int(m.group(1)) * 60 + float(m.group(2))
        try:
            return float(time_str)
        except ValueError:
            return None

    @staticmethod
    def _to_int(text: str, default: int | None = None) -> int | None:
        if not text:
            return default
        try:
            return int(re.sub(r"[^\d]", "", text) or "x")
        except ValueError:
            return default

    @staticmethod
    def _to_float(text: str, default: float | None = None) -> float | None:
        if not text:
            return default
        try:
            cleaned = re.sub(r"[^\d.]", "", text)
            return float(cleaned) if cleaned else default
        except ValueError:
            return default
