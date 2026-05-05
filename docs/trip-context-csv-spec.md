# trip context CSV 仕様

`tripTrouble01` と `tripBenefit01` を `pastRuns` に投入するための CSV 仕様です。

## ファイル形式
- 文字コード: UTF-8
- 区切り: カンマ区切り（CSV）
- ヘッダ必須

## ヘッダ
- 必須:
  - `raceId`
  - `horseId`
  - `tripTrouble01`
  - `tripBenefit01`
- 任意:
  - `runDate` (`YYYY-MM-DD`)
  - `note`

## 値の意味
- `tripTrouble01`: 0〜1
  - 大きいほど不利が大きい（例: 大外ぶん回し、前が壁）
- `tripBenefit01`: 0〜1
  - 大きいほど恩恵が大きい（例: インベタ馬場で最短距離）

## 行の適用ルール
- `raceId` + `horseId` で対象馬を特定
- `runDate` 指定あり:
  - `pastRuns[].date == runDate` の走に反映
- `runDate` 指定なし:
  - `pastRuns[0]`（直近走）に反映

## 実行コマンド
- ドライラン:
  - `node scripts/apply-trip-context.mjs --csv=docs/trip-context-template.csv --dry-run`
- 実反映:
  - `node scripts/apply-trip-context.mjs --csv=<your-file>.csv`

