# keiba-yosou（競馬AI分析）

netkeiba 由来のレース JSON を元に、馬ごとの能力・過去走・コース条件をスコア化し、レース画面で評価と買い目の参考情報を表示する **Vite + React + TypeScript** のフロントエンドアプリ。オッズ・期待値系の補足は Node スクリプトで JSON を更新するパイプラインと一体で動きます。

## 技術スタック

| 領域 | 使用技術 |
|------|-----------|
| UI | React 18、React Router、CSS（`src/index.css`） |
| ビルド | Vite 5、TypeScript 5.6 |
| テスト | Vitest |
| データ取得（スクリプト） | Cheerio、Playwright（ライブオッズ取得のフォールバック）、`fetch` / 独自 `netkeibaFetch` |

## ディレクトリ概要

```
src/
  app/                    # ページ（レース一覧・レース詳細）
  components/race/        # 評価カード、一覧表、買い目パネル（実質期待値・資金割合の目安表示含む）
  domain/race-evaluation/ # スコア計算・ペース適性・ラップ適性などドメインロジック
  lib/race-data/          # JSON → RaceEvaluationData 変換、型、リポジトリ
  data/
    index.json            # レース索引（日付・競馬場・raceId）
    races/*.json          # レース別の出走・オッズ・期待値短評フィールド
scripts/                  # netkeiba 取得・オッズ更新・期待値再計算（.mjs）
docs/                     # 設計メモ・実装方針（詳細はこちらを参照）
python/                   # 別系統の検証・シミュレーション用スクリプト（Web アプリ本体とは独立）
```

## 現状の実装の要点

### レース評価

- 出走馬ごとに **ベース／調整スコア、クラス・血統・ラップ形状・枠×脚質** などを `evaluateRace`（`src/domain/race-evaluation/scoreCalculator.ts`）で集計。
- 一覧では **危険な人気馬／穴候補** タグ、ラップ適性アイコン、陣営バッジなどを表示（`src/components/race/evaluationTags.ts` ほか）。
- データは `src/data/races/{raceId}.json` を `convertToRaceEvaluationData` などで畳み込み、UI が読む `RaceEvaluationData` 形に揃える。

### オッズ・実質期待値（AIオッズ評価）

- **実質期待値**の式（データ生成側）: `(予測確率 × 使用オッズ) − マージン(0.15)`。予測確率は出走間の能力 softmax 由来（`scripts/lib/investmentSignals.mjs`）。
- **value_rank（S〜D）** は実質 EV そのもので帯分け（S: 10 以上、A: 8〜10 未満、B: 3〜8 未満、C: 1〜3 未満、D: 1 未満。`scripts/lib/investmentSignals.mjs` の `toValueRank` を参照）。
- 買い目パネルでは **「期待値判断」** 列に、【期待値高】など EV 帯に対応した表記を表示（買い目の軸／相手の機械選定とは別ロジック）。

### 買い目提案

- `buildBetPlan`（`src/components/race/betBuilder.ts`）が本命・相手を **`HorseScoreResult` とペース適性** から選び、馬連・3連複の流し案と予算配分を組み立てる（オッズ期待値の「見送り」判定とは独立）。

### データ更新パイプライン（代表）

| 作業 | コマンド例 |
|------|------------|
| **オッズ更新（推奨・JRA 公式）** | `node scripts/refresh-latest-odds.mjs --date=YYYY-MM-DD --live-fallback --retries=3 --retry-wait=30000` |
| **AI 勝率・EV 再計算（オッズ後）** | `python3 scripts/backfill-ai-predictions.py --start-date YYYY-MM-DD --end-date YYYY-MM-DD --ts-only` |
| 出馬表取得 | `node scripts/fetch-races-from-netkeiba.mjs --date=YYYY-MM-DD` |
| enrich（`final_expected_value` のみ） | `npm run enrich-investment-signals` |
| 過去走の追記 | `npm run fetch-past-runs` |

**現状の全体像・二系統（enrich / Python AI）・既知の制約**は **[docs/現状実装まとめ-2026-05.md](docs/現状実装まとめ-2026-05.md)** を参照。JRA API 環境変数は `docs/jra-odds-setup.md`。

## 開発

```bash
npm install
npm run dev      # 開発サーバー
npm run build    # 本番ビルド
npm test         # Vitest
```

ブラウザでは `/races` が一覧、`/race/:raceId` が詳細です。

## ドキュメント（詳細）

- **現状まとめ（2026-05）**: [docs/現状実装まとめ-2026-05.md](docs/現状実装まとめ-2026-05.md) … オッズ・AI バックフィル・印・運用コマンド
- スクレイピング詳細: [docs/scraping-architecture.md](docs/scraping-architecture.md)
- 評価・点数・enrich: [docs/実装内容まとめ.md](docs/実装内容まとめ.md)
- ロジック網羅: [docs/実装ロジック詳細一覧.md](docs/実装ロジック詳細一覧.md)
- レースデータ方針: [docs/レースデータ実装方針.md](docs/レースデータ実装方針.md)

## ライセンス・権利

リポジトリは private 想定。netkeiba 等のスクレイピング利用は各サイトの利用規約に従ってください。
