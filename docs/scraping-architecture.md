# スクレイピング・アーキテクチャ詳細

このドキュメントは、本リポジトリが netkeiba（および任意の JRA 系 API）からデータを取得する仕組みを、**HTTP の経路・パース対象 DOM・出力先・既知の制約**ごとにまとめたものです。

---

## 1. 全体像

| 区分 | 主スクリプト | 保存先（代表） |
|------|----------------|----------------|
| 出馬表（シャッフル） | `scripts/fetch-races-from-netkeiba.mjs` | `src/data/races/{raceId}.json`、`src/data/index.json` |
| 過去走・馬プロフィール | `scripts/fetch-past-runs.mjs`（本体は `lib/parseNetkeibaPastRuns.mjs`） | 各レース JSON の `entries[].pastRuns` 等 |
| レース結果（着順） | `scripts/fetch-race-results.mjs` | `src/data/results/{raceId}.json` |
| オッズ・市場単勝・人気 | `scripts/generate-latest-odds-csv.mjs`、`scripts/refresh-latest-odds.mjs`、`scripts/fetch-live-odds.mjs`、`scripts/apply-external-odds.mjs` | 各レース JSON の `entries[].market_win_odds` 等 |
| 馬場傾向マスタ（任意） | `enrich-investment-signals.mjs --bias-update` → `lib/biasMaster.mjs` | `src/data/bias_master.json` |

**共通実装:** ブラウザ常駐ではなく、主に **`curl` で HTML を取得 → `cheerio` でパース**します。  
取得処理の共通ラッパーは **`scripts/lib/netkeibaFetch.mjs`** です。

---

## 2. HTTP 取得レイヤ（`netkeibaFetch.mjs`）

### 2.1 `fetchUtf8(url)`

- **`curl -sL`** でバイナリ取得（最大バッファ約 8MB）。
- User-Agent: `Mozilla/5.0 (compatible; keiba-yosou/1.0)`。
- netkeiba の日本語ページは **EUC-JP** のことが多いため、`iconv-lite` で **UTF-8 と EUC-JP の両方にデコード**し、簡易スコア（HTML らしさ・長さ・`netkeiba` 文字列）で **より妥当な方を採用**。

### 2.2 `fetchSpUtf8(url)`

- **スマホ UA**（iPhone Safari 相当）で取得。
- `race.sp.netkeiba.com` / `db.sp.netkeiba.com` 向け。PC 版が短いレスポンスやブロック気味のときのフォールバックに使われる。

### 2.3 `sleep(ms)`

- 各種ループで **リクエスト間隔**を空けるためのユーティリティ。

---

## 3. 出馬表（シャッフル）取得

### 3.1 エントリポイント

- **`scripts/fetch-races-from-netkeiba.mjs`**
- コメントに記載のとおり、対象日・開催は **`makeJobs` / `makeDayJobs` でハードコードされた日程・場コード × 12R** から `race_id`（12桁）を組み立てる運用がベース（`--date=YYYY-MM-DD` でその日だけに絞れる）。

### 3.2 URL とフォールバック

1. **PC 出馬表**  
   `https://race.netkeiba.com/race/shutuba.html?race_id={raceId}`  
   `fetchUtf8`。本文が十分長ければこれを採用。
2. **SP 出馬表**  
   `https://race.sp.netkeiba.com/race/shutuba.html?race_id={raceId}`  
   PC が短い／失敗時に `fetchSpUtf8`。

### 3.3 パースの要点（`parseShutuba`）

- **エラー判定:** `title` に「エラー」、`お探しのページ」など → 取得失敗として例外。
- **レース名:** `h1.RaceName`、なければ `title` の「〜出馬表」から抽出。
- **距離・馬場:** `.RaceData01` / `body` テキストから **芝・ダ・距離（m）**、障害は距離から読み、評価では芝ダの都合上 **ダート寄せ**などルールあり。
- **競馬場:** DOM の `.RaceData02` や `title`、`race_id` の桁規則（`venueFromNetkeibaRaceId`）で **安定した場名**に寄せる。
- **グレード:** `h1.RaceName` 内の `Icon_GradeType{n}` を数値化し、G1/G2/G3/L/S 等へマップ。
- **各馬行:** `tr.HorseList`（PC/SP で列数・構造が異なる）。馬番は **td テキスト**または **`span[id^="uno-1_"]` / `odds-1_` / `ninki-1_`** の ID 末尾から復元。
- **オッズ・人気:** `span[id="odds-1_XX"]`、`span[id="ninki-1_XX"]` が **数値**なら `actual_odds` / 人気として採用。**`---.-`** や **`*`（未確定表示）** は数値として取り込めない。

### 3.4 過去走の同時取得

- 既定では **各馬の直近戦績も netkeiba db から取得**し `pastRuns` に格納（`--skip-past-runs` で省略可能）。
- 実装は **`fetchPastRunsForHorse`**（後述）。

### 3.5 後処理

- **`enrichInvestmentSignalsInRaceData`**（期待値・投資シグナル）
- **`attachRaceAnalysisOrLeave`**（レース分析スナップショット）
- **`buildDailyBaselineMaster`** / **`saveDailyBaseline`**（日次ベースライン）

---

## 4. 過去走・馬プロフィール取得

### 4.1 エントリポイント

- **`scripts/fetch-past-runs.mjs`** … 既存の `src/data/races/*.json` を列挙し、各 `entries[]` の馬ごとに過去走を埋める。
- **`scripts/fetch-races-from-netkeiba.mjs`** からも **`fetchPastRunsForHorse`** を呼ぶ。

### 4.2 本体（`scripts/lib/parseNetkeibaPastRuns.mjs`）

#### 馬の戦績一覧

優先 URL（順に試行）:

1. `https://db.netkeiba.com/horse/result/{horseId}/`
2. `https://db.sp.netkeiba.com/horse/result/{horseId}/`

取得できた HTML を **`table.db_h_race_results`**（または類似ヘッダのテーブル）としてパース。**thead の列ラベル**から「日付・開催・レース名・着順・距離・着差・通過・上り」等の **列インデックスを動的に解決**（レイアウト変更への耐性）。

- **直近 N 走:** 既定では **最大 5 走**（`slice(0, 5)`）。
- **着差:** `parseChakusaToSeconds` で馬身・秒などを **勝ち馬からの秒近似**に変換。
- **馬プロフィール:** 性齢・厩舎・血統（父・母父）・馬体重などをページから抽出し、エントリにマージ可能。

#### レースごとの 200m ラップ（共通ペース）

- URL（順に試行）:  
  `https://db.netkeiba.com/race/{raceId}/` → `https://db.sp.netkeiba.com/race/{raceId}/`
- **コメント:** `db.netkeiba.com` が **400** を返す環境があるため **SP にフォールバック**。
- `.race_lap_cell` から **200m 区間の秒列**を抽出（4 本以上で利用）。

---

## 5. レース結果（着順）取得

### 5.1 エントリポイント

- **`scripts/fetch-race-results.mjs`**
- **`--date=YYYY-MM-DD`** … `src/data/index.json` から該当日の `raceId` を列挙。
- **`--raceId=...`** … 単発。
- **`--venue=...`** … 日付＋競馬場でフィルタ。

### 5.2 URL

- `https://race.netkeiba.com/race/result.html?race_id={raceId}`

### 5.3 パース（`parseResultPage`）

- `#All_Result_Table tbody tr` または `.RaceTable01 tbody tr`。
- 列の意味はコメント固定（着順・枠・馬番・馬名・…・タイム・着差）。馬 ID は **馬名リンク `href` の `/horse/{id}`** から抽出。
- エラー時は「ページエラー」「テーブルなし」「行が 0」などで例外。

### 5.4 出力

- **`src/data/results/{raceId}.json`** … `places: [{ place, horseId, horseName, time, margin }]`  
  印の的中率集計（`scripts/aggregate-mark-hit-rates.ts`）などで使用。

---

## 6. オッズ取得・マージ

オッズは **ソースが複数**あり、最終的に **レース JSON の各エントリ**（`market_win_odds`、`market_popularity` 等）へ書き込む。

**標準運用の入口は `scripts/refresh-latest-odds.mjs`（デフォルト `--source=jra`）**。  
手順・AI 再計算は **[現状実装まとめ-2026-05.md](./現状実装まとめ-2026-05.md) §3** を参照。

### 6.1 `refresh-latest-odds.mjs`（推奨・一括）

| 順序 | 処理 | 条件 |
|------|------|------|
| 1 | `generate-latest-odds-csv.mjs` | 常に実行（`--skip-generate` で省略可） |
| 2 | `fetch-live-odds.mjs` | `--live-fallback` 指定時 |
| 3 | `apply-external-odds.mjs` | CSV あり・`--skip-external` で省略可 |

完了時に `attempt=1 summary: ...` を出力。所要時間は **おおよそ 30〜60 分/日**（36R・live-fallback あり）。

**推奨コマンド例:**

```bash
node scripts/refresh-latest-odds.mjs --date=2026-05-23 --live-fallback --retries=3 --retry-wait=30000
```

`--source=netkeiba` **のみ**の運用は非推奨（未発売時 `rows=0` になりやすい）。

### 6.2 CSV 生成（`generate-latest-odds-csv.mjs`）

**`--source=jra`（既定）** のとき:

1. **`JRA_ODDS_API_BASE_URL`** が設定されていれば外部 API
2. なければ **`scripts/lib/jraDriver.mjs`** … Playwright で **sp.jra.jp** から単勝・人気取得（`raceIdResolver` で場・R・日付を解決）
3. `--source=auto` のときのみ、JRA 失敗レースで netkeiba フォールバック
4. `--source=netkeiba` のときは netkeiba のみ（下記 5〜8）

**`--source=netkeiba` / `auto` フォールバック時の netkeiba 経路:**

1. netkeiba SP JRA オッズ API（JSONP + 圧縮）
2. 単勝オッズ HTML（`type=b1`）… **`tr` 列前提**（0 行になりやすい）
3. SP 単勝ビュー・SP 出馬表（`tr.HorseList`, `span[id^="odds-1_"]`）

出力 CSV 列:  
`raceId,horseNumber,actualOdds,marketWinOdds,marketPopularity,observedAt,source`

**`scripts/apply-external-odds.mjs`**  
CSV を各 `src/data/races/{raceId}.json` にマージし、**`enrichInvestmentSignalsInRaceData`**（`final_expected_value` 等）を実行。

**注意:** UI の **`ai_predicted_win_rate` / `ai_effective_ev`** は **`scripts/backfill-ai-predictions.py`** で別途更新する（enrich では上書きしない）。

### 6.3 ライブ更新（レース JSON 直書き）

**`scripts/fetch-live-odds.mjs`**

1. **`--source=browser` / `auto`**  
   Playwright（Chromium）で SP ページを開き、`tr[id^="ninki-data-"]` や `tr.HorseList span[id^="odds-1_"]` が現れるまで待機して DOM から抽出。取得できない場合は HTTP にフォールバック。
2. **`--source=http` / `auto`（ブラウザ無し or 取得 0 件時）**  
   次を **馬番キーの Map にマージ**（`mergeOddsMaps`: primary が fallback を上書きする形式）。
   - SP API（`parseSpApiJraOddsRows` と同等ロジック）
   - **単勝ページ** `parseTanshoOddsAndPopularity`
   - **PC 出馬表** `parseShutubaOddsAndPopularity`
   - **SP 出馬表** `parseSpShutubaOddsAndPopularity`
   - **SP odds_view** `parseSpOddsView`

その後 **`applyOddsToRaceData`** で `entries[]` の **`horseId` / `horseNumber`** に一致する行へ `market_win_odds`・人気を設定し、**天候・馬場ラベル**が取れれば `meta` に反映、最後に **`enrichInvestmentSignalsInRaceData`**。

### 6.4 オッズが取れない典型例

- 出馬表・オッズ欄が **`---.-`**（未確定）→ 正規表現で **数値として採用しない**。
- 人気が **`*` や `**`** → 数値化できず **`estimated`** のまま**。
- PC の **`td` 列数前提パース**が HTML 変更で空振り → **CSV 0 行**や **fetch 件数 0**。

---

## 7. 補助: 馬場傾向マスタ（`biasMaster.mjs`）

- **`node scripts/enrich-investment-signals.mjs --bias-update`** から **`updateBiasMasterFromNetwork`** が呼ばれる。
- netkeiba の **結果ページ等をネットワーク取得し**（`parseRaceResultNetkeiba`）、コーナー通過・Top3 枠などから **内有利・外差し有利**の集計を `bias_master.json` にマージする設計（詳細は `biasMaster.mjs` および `parseRaceResultNetkeiba.mjs`）。

---

## 8. 環境変数・設定ファイル（オッズ/API）

| 変数 | 用途 |
|------|------|
| `JRA_ODDS_API_BASE_URL` | 外部 JRA 系オッズ API のベース URL（設定時、`generate-latest-odds-csv` の `--source=jra/auto` が意味を持つ） |
| `JRA_ODDS_API_ENDPOINT_TEMPLATE` | `{raceId}` を含むパステンプレート |
| `JRA_ODDS_API_TOKEN` / `JRA_ODDS_API_KEY` | 認証ヘッダ |
| `JRA_ODDS_API_ROWS_PATH` | JSON 内の配列パス（ドット記法） |
| `ODDS_BROWSER_CHANNEL` | Playwright の Chromium チャンネル（例: システム Chrome） |

`.env` は **`scripts/lib/loadEnvFiles.mjs`** 経由で読み込むスクリプトがある。

---

## 9. 運用上の注意

1. **スクレイピングは netkeiba の HTML/CSS 変更に弱い。** テーブル列・`span` の id 規則が変わるとパースが空になる。
2. **レート制限・ブロック**を避けるため、各スクリプトで **数百 ms の sleep** を挟んでいる。全レース一括は時間がかかる。
3. **オッズは「発売後〜確定前」の表示が `---` のことがある。** その時間帯は **`actual` が付かず**投資シグナルは推定寄りになりやすい。
4. **確実なオッズ連携**は、自前の **JRA オッズ API** または **公式・独自 CSV を `apply-external-odds` で流し込む**運用が安定しやすい。

---

## 10. コマンド早見表

| 目的 | 例 |
|------|-----|
| 出馬表＋（既定では）過去走まで取得 | `node scripts/fetch-races-from-netkeiba.mjs --date=2026-05-10` |
| 過去走のみ再取得 | `node scripts/fetch-past-runs.mjs --all` |
| 結果のみ取得 | `node scripts/fetch-race-results.mjs --date=2026-05-10` |
| オッズ一括リフレッシュ（**推奨**） | `node scripts/refresh-latest-odds.mjs --date=YYYY-MM-DD --live-fallback --retries=3 --retry-wait=30000` |
| オッズ CSV 生成のみ（JRA） | `node scripts/generate-latest-odds-csv.mjs --date=YYYY-MM-DD --source=jra --out=data/latest-odds.csv` |
| CSV → JSON 反映 | `node scripts/apply-external-odds.mjs --csv=data/latest-odds.csv` |
| AI 再計算（オッズ後） | `python3 scripts/backfill-ai-predictions.py --start-date YYYY-MM-DD --end-date YYYY-MM-DD --ts-only` |
| ライブオッズ（HTTP） | `node scripts/fetch-live-odds.mjs --date=2026-05-10 --source=http` |
| 期待値フィールド再計算 | `node scripts/enrich-investment-signals.mjs --all` |

---

## 11. 関連ファイル一覧（参照用）

- `scripts/lib/netkeibaFetch.mjs` … HTTP 取得
- `scripts/fetch-races-from-netkeiba.mjs` … 出馬表メイン
- `scripts/lib/parseNetkeibaPastRuns.mjs` … 過去走・ラップ・着差
- `scripts/fetch-past-runs.mjs` … 過去走バッチ
- `scripts/fetch-race-results.mjs` … 着順結果
- `scripts/generate-latest-odds-csv.mjs` … オッズ CSV 生成
- `scripts/refresh-latest-odds.mjs` … CSV パイプライン統合
- `scripts/apply-external-odds.mjs` … CSV マージ
- `scripts/fetch-live-odds.mjs` … オッズ DOM/API マージ・Playwright
- `scripts/lib/investmentSignals.mjs` … 期待値・投資シグナル計算
- `scripts/lib/biasMaster.mjs` … 馬場傾向マスタ更新

---

*この文書はリポジトリの実装に基づく。netkeiba の利用は各サイトの利用規約・robots の範囲で行うこと。*
