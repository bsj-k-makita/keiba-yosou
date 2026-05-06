# 競馬予想AI 改善バックログ

> 実装完了した項目は ✅、未着手は ⬜、実装中は 🔄 で管理する。

---

## カテゴリ 1: 評価ロジックの高度化（Logic Layer）

### ✅ A. 動的EVマージン（Dynamic EV Margin）
**実装ファイル**: `scripts/lib/investmentSignals.mjs`
**実装日**: 2026-05-06

一律 0.15 だった `EV_MARGIN` を `calcDynamicEvMargin(raceInfo, fieldSize)` で動的化。

| 条件 | マージン |
|------|---------|
| 新馬・未勝利戦（raceName に「新馬」「未勝利」含む） | 0.20 |
| 重賞（raceGrade = G1/G2/G3） | 0.10 |
| 一般戦（デフォルト） | 0.15 |
| 多頭数（16頭以上）に +0.05 加算 | 上記 + 0.05 |

`calcEffectiveEv(prob, odds, margin)` を margin 引数対応に変更し、動的マージンを適用。

---

### ✅ B. 当日トラックバイアス補正
**実装ファイル**: `scripts/lib/investmentSignals.mjs`
**実装日**: 2026-05-06

`enrichInvestmentSignalsInRaceData` で JSON の `condition.userTrackBias` / `condition.bias` を読み取り、確率に補正係数を乗算して再正規化。

- `calcGateBiasMultiplier(gateNumber, fieldSize, userTrackBias)`: 枠番ベースのバイアス（内有利/外有利）
- `calcRunningStyleBiasMultiplier(runningStyle, biasSetting)`: 展開ベースのバイアス（前残り/差し決着）

補正範囲:
- 枠バイアス: ×0.75〜×1.30（強度 1.0 時の内外最大差 ±15%）
- 展開バイアス: ×0.90〜×1.10（front_favor/closer_favor それぞれ 10% の差）

---

### ✅ C. 人気バイアス（オッズの歪み）補正
**実装ファイル**: `scripts/lib/investmentSignals.mjs`
**実装日**: 2026-05-06

`calcPopularityBiasDecay(prob, odds)` を新設。

- AI予測確率 > 市場内包確率（1/odds）が 5% 超: 最大 10% 減衰
- 1倍台（odds < 2.0）かつ prob > 0.45: さらに 5% 減衰（最大 15% 減衰まで）
- デバッグ用フィールド `ev_margin_applied`, `popularity_decay_applied` をエントリに追記

---

## カテゴリ 2: 意思決定を支えるUI/UX強化（Presentation Layer）

### ✅ A. 期待値ヒートマップと視覚的強調
**実装ファイル**: `src/components/race/RaceBetPanel.tsx`
**実装日**: 2026-05-06

EVテーブルの行背景色をEV値に応じてグラデーション化。

| EV範囲 | 表示 |
|--------|------|
| EV < 1.0 | 背景なし（透明） |
| 1.0 ≤ EV < 1.2 | 薄緑（`rgba(39,174,96,0.07)`）+ 左ボーダー薄緑 |
| EV ≥ 1.2 | 緑（`rgba(39,174,96,0.15)`）+ 左ボーダー緑 |

`EvSpecialBadge` コンポーネントで自動バッジ付与:
- Sランク: **★お宝馬** バッジ（赤・点滅アニメーション）
- Aランク: **期待値高** バッジ（オレンジ）

馬場バイアス補正が有効な場合、EV列に `↑補` サフィックスを表示。

---

### ⬜ B. 能力スコアのレーダーチャート化（馬カード統合）
**対象ファイル**: `src/components/race/HorseEvaluationCard.tsx`

> 既存の `RadarChart` コンポーネントはすでに `horse-card__radar-hero` として馬カードに統合済み。
> 今後の改善として、買い目タブ（`RaceBetPanel`）の EVテーブル行にもミニレーダーを表示したい場合はここを拡張する。

---

## カテゴリ 3: 新機能の実装（Feature Layer）

### ✅ A. ケリー基準予算配分シミュレーター（拡張）
**実装ファイル**: `src/components/race/RaceBetPanel.tsx`
**実装日**: 2026-05-06

既存のケリー比率表示に加え、**ケリー分率セレクター** を追加。

| 設定 | 分率 | 用途 |
|------|------|------|
| フルケリー | × 1.0 | 理論最大効率（上級者向け） |
| ハーフケリー | × 0.5 | バランス重視 |
| クォーターケリー（デフォルト） | × 0.25 | 長期安定運用推奨 |

選択した分率が「推奨額」列と「合計推奨投資」に即座に反映される。

---

### ✅ B. 当日馬場傾向クイック入力UI（RaceBetPanel 統合）
**実装ファイル**: `src/components/race/RaceBetPanel.tsx`, `src/components/race/RaceDetailView.tsx`
**実装日**: 2026-05-06

`TrackBiasQuickPanel` コンポーネントを買い目タブ内に設置。

**操作項目:**
1. 枠バイアス（5段階): 内有利(強) / 内有利 / フラット / 外有利 / 外有利(強)
2. 展開傾向（3段階）: 前残り / フラット / 差し決着

`onConditionChange` prop 経由で `RaceDetailView` の `condition` ステートを直接更新。
変更はAI予想・スコア計算・EV補正のすべてにリアルタイム反映。

`RaceDetailView.tsx` に `onConditionChange` を渡すよう修正済み。

---

## 未着手・将来の改善候補

### ⬜ 複数レース連続バイアス自動学習
当日の 1〜3R 結果から逃げ/差しの傾向を自動推定し `condition.bias` を提案する機能の精度向上。
（`inferBiasFromTop3HorseIds` の改善: 着差・上がりタイムも考慮）

### ⬜ EV計算のフロントエンド完全版（ランタイム再計算）
現在は build-time の `investment.valueScore` にランタイム補正を適用する方式。
将来的にフロントエンドで softmax→EV のフルパイプラインを実行できるようにすると、
スクリプト再実行なしに任意の条件変更が完全に反映される。

### ⬜ 資金管理ログ（セッションベース）
レースごとの推奨投資額・実際の投資額・払戻を記録するローカルストレージベースの管理機能。
ROI・的中率のセッション集計が可能になる。
