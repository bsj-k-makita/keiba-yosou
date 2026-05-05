# 競馬AI分析サイト 実装仕様（現状）

このドキュメントは、現時点のコード実装に基づく「動いている仕様」を整理したものです。  
対象は `Vite + React` フロントエンド、`Vercel` デプロイ設定、`netkeiba` 連携スクリプトと結果APIを含みます。

## 1. 技術スタックと実行構成

- フロントエンド: React 18 / TypeScript / Vite
- ルーティング: `react-router-dom`（`BrowserRouter`）
- デプロイ: Vercel（SPA rewrite + Serverless Function）
- データ保存: 静的JSON（`src/data/index.json` + `src/data/races/*.json` + `src/data/results/*.json`）
- サーバー機能: `api/race-result.js`（Vercel Serverless）

### npm scripts

- `npm run dev`: ローカル開発
- `npm run build`: 型チェック + 本番ビルド
- `npm run preview`: ビルド結果確認
- `npm run fetch-races:netkeiba-2026-04-25-26`: 出馬表取得 + JSON生成
- `npm run fetch-past-runs`: 過去走付与
- `npm run fetch-results`: レース結果JSON生成

## 2. デプロイ/ルーティング仕様

`vercel.json` で以下の rewrite を設定:

- `/api/(.*)` -> `/api/$1`（APIはServerlessへ）
- `/(.*)` -> `/index.html`（SPA直リンク対応）

このため、`/race/:raceId` などを直接開いてもフロントのルータで表示可能です。

## 3. 画面構成

## 3.1 ルート

- `/` -> `/races` へリダイレクト
- `/races` -> レース一覧
- `/race/:raceId` -> レース詳細

共通レイアウトとして、上部ナビ（ロゴ/LIVE表示）とフッターを全画面に適用しています。

## 3.2 レース一覧ページ (`/races`)

実装: `src/app/races/page.tsx`

- データソース: `getRaceIndex()`（`src/data/index.json`）
- `date` で日付タブを生成（降順）
- 選択日を `venue` ごとにグループ化し、競馬場タブを生成
- レース行表示項目:
  - R番号
  - レース名
  - 馬場（芝/ダ）
  - 距離
- 行クリックで `/race/:raceId` へ遷移

## 3.3 レース詳細ページ (`/race/:raceId`)

実装: `src/app/race/[raceId]/page.tsx` + `src/components/race/RaceDetailView.tsx`

- `raceId` を元に `getRaceEvaluationById()` でJSONを読み込み
- 同日に同会場レースが複数ある場合、`RaceNavBar` で前後Rへ遷移可能
- 条件設定（会場/馬場/バイアス/展開/補正強度）を変更すると即時再計算
- 表示タブ:
  - 一覧
  - 詳細カード
  - 結果確認

### 一覧タブ

- `HorseListTable` で全馬の比較表を表示
- 印、馬番、短評、補正後スコア、能力グレード、買いラベル、役割（頭/軸）、ラップ適合を表示

### 詳細カードタブ

- `HorseEvaluationCard` を馬ごとに表示
- 主な表示:
  - 補正後評価、基礎能力、条件適性差
  - 買い判定（本命候補/対抗/単穴/相手/消し）
  - 短評（結論/展開/過去走）
  - レーダーチャート
  - 能力バー
  - 最終評価内訳（相対/展開/ラップ）
  - 詳細理由テキスト

### 結果確認タブ

- `RaceResultPanel` で確定着順の自動取得・手動入力を提供
- 自動取得:
  - `GET /api/race-result?raceId=...`
  - 404時は「未取得」扱い
- 手動入力:
  - 1〜4着を選択して保存
  - `localStorage` に `race-result:{raceId}` で保持
- 結果分析:
  - ◎/○/▲ の的中判定
  - 上位脚質から「前有利/差し有利」などの条件ヒント生成
  - ワンクリックで `bias` を再設定して再計算

## 4. データモデル

主要型: `src/lib/race-data/raceEvaluationTypes.ts`

- `RaceIndexItem`: 一覧表示用（`index.json`）
- `RaceEvaluationData`: 詳細画面用の1レース完全データ
  - `raceInfo`
  - `condition`（初期条件）
  - `entries[]`（各馬能力・評価・過去走）
- `RaceResultData`: 着順データ（`results/*.json`）

## 5. データ読み込み/変換フロー

実装: `src/lib/race-data/raceDataRepository.ts` / `convertToRaceEvaluationData.ts`

1. `index.json` から一覧を読み込み（日時降順）
2. `races/{raceId}.json` を動的import
3. `convertToRaceEvaluationData()` で正規化
   - `analysisJson` 形式 / `RaceEvaluationData` 形式の両対応
   - 旧データは再計算して不足フィールドを補完
4. `raceDataToHorses()` で評価計算入力へ変換

## 6. 評価ロジック（`evaluateRace`）

中核実装: `src/domain/race-evaluation/scoreCalculator.ts`

## 6.1 重み決定

1. 会場別ベース重み（`courseWeights.ts`）
2. 馬場/バイアス/展開の補正値を加算（`adjustments.ts`）
3. 補正強度（弱/中/強）を適用
4. 最小/最大値でクランプ
5. 合計1に正規化

## 6.2 馬ごとのスコア算出

- `baseScore`: ベース重みによる加重点
- `adjustedScore`: 補正後重みによる加重点
- `baseAbilityCore`: 5軸平均75% + 上位2軸平均25%
- `intrinsicAbilityScore`: `baseAbilityCore + 再現性 - リスク`
- `raceAdjustedInput`: 相対評価前の合成入力（基礎/条件/MAX性能を合成）
- `raceRelativeScore`: レース内相対化（z-score基準、低分散時はmin-max）
- `paceFitBonus`: 脚質と展開一致度から加減点
- `lapShapeFitBonus`: ラップ形状一致による加減点
- `variancePenalty`: 過去走分散に基づく減点
- `finalEvaluationScore`: 上記の最終統合値

## 6.3 順位/印/買い判定

- `baseRank` / `adjustedRank` / `finalRank` を別々に付与
- 印:
  - 1位◎、2位○、3位▲、4-5位△
  - 条件で大きく浮上した馬に☆（6位以下対象）
- 消し判定:
  - 低適性、展開不利、下位順位、負の差分などを複合判定
- 買いラベル:
  - 本命候補 / 対抗 / 単穴 / 穴候補 / 相手 / 消し

## 7. 結果取得API（Vercel Serverless）

実装: `api/race-result.js`

- エンドポイント: `GET /api/race-result?raceId=12桁`
- 取得元: `https://race.netkeiba.com/race/result.html?race_id=...`
- 文字コード: EUC-JP -> UTF-8へ変換
- 返却: `RaceResultData`
- CORS: `*`
- キャッシュ: `s-maxage=1800, stale-while-revalidate=3600`
- エラー:
  - 400: raceId不正
  - 404: 未掲載/解析不可
  - 502: 取得失敗

## 8. データ更新バッチ

## 8.1 出馬表取得

`scripts/fetch-races-from-netkeiba.mjs`

- 対象日の全レースを取得して `src/data/races/*.json` に保存
- `src/data/index.json` を日付単位で差し替え更新
- 各馬の `pastRuns` 取得も同時実行

## 8.2 過去走追記

`scripts/fetch-past-runs.mjs`

- 既存レースJSONの `entries[].pastRuns` を更新
- `--all` / `--force` 対応

## 8.3 結果取得

`scripts/fetch-race-results.mjs`

- 日付 or raceId 指定で結果を取得
- `src/data/results/{raceId}.json` に保存

## 9. 既知の実装特性・制約

- データ永続は静的JSON中心（DB未導入）
- 一部能力値はスクレイピング時の仮生成ロジックを使用
- 過去走/結果HTMLの構造変更に影響を受ける可能性あり
- `BrowserRouter` 前提のため、SPA rewrite設定が必須
- Git連携は必須ではなく、単体フォルダ運用でもデプロイ可能

## 10. 現状の運用最短手順

1. データ更新（必要時）
2. `npm run build`
3. `npx vercel --prod`
4. 公開URLで確認

