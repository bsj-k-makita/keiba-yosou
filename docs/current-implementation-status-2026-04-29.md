# 現状実装サマリー（2026-04-29）

## 目的
- 既存評価ロジックに対し、`枠×脚質`・`ラップの質`・`血統の起伏適性`・`ステップレース連動`を追加し、UIで判断理由を可視化する。

## 実装済み（ロジック）

### 1) 枠順 × 脚質クロス評価
- 追加: `gateStyleSynergyBonus`
- 実装箇所:
  - `src/domain/race-evaluation/contextualBonuses.ts`
  - `src/domain/race-evaluation/scoreCalculator.ts`
  - `src/domain/race-evaluation/abilityTypes.ts`
- 内容:
  - `逃げ/先行`は外枠で減点、内枠で加点
  - `差し/追込`は外目の進路確保を一定加点
  - コーナー数（`turnCount`）で影響を増幅

### 2) ラップ評価の拡張（形状一致 + 持続力 + 上がり質）
- 追加:
  - `lapSustainBonus`（消耗戦での減速耐性）
  - `lapQualityBonus`（上がり時計 + 上がり順位）
  - `lapProfile`（`瞬発戦型` / `消耗戦型` / `一貫型`）
- 実装箇所:
  - `src/domain/race-evaluation/lapShapeFit.ts`
  - `src/domain/race-evaluation/scoreCalculator.ts`
  - `src/domain/race-evaluation/abilityTypes.ts`
- 内容:
  - 従来の`lapShapeFitBonus`に加えて、持続力・上がり質を別指標で加算
  - 最終評価ではラップ3要素を合算して反映

### 3) 血統のコース形態（起伏）適性
- 追加:
  - `flatTrackFit01`
  - `uphillTrackFit01`
  - `downhillToFlatFit01`
- 実装箇所:
  - `src/domain/race-evaluation/abilityTypes.ts`
  - `src/domain/race-evaluation/contextualBonuses.ts`
  - `src/lib/race-data/analysisJsonTypes.ts`
  - `src/lib/race-data/convertToRaceEvaluationData.ts`
  - `src/lib/race-data/raceEvaluationTypes.ts`
- 内容:
  - コース形態を`flat`/`uphill`/`downhill_to_flat`で評価
  - 競馬場キーからの推定（例: 京都は下り→平坦、阪神/中山は急坂寄り）
  - 系統名ヒューリスティック（プリンスリーギフト、グレイソヴリン、ブランドフォード）を補助加点

### 4) 特定ステップ × 内容（黄金パターン）
- 追加: `stepPatternBonus`
- 実装箇所:
  - `src/domain/race-evaluation/classLevelScore.ts`
  - `src/domain/race-evaluation/scoreCalculator.ts`
  - `src/domain/race-evaluation/abilityTypes.ts`
- 内容:
  - 例として天皇賞（春）向けに、`阪神大賞典`/`日経賞` + 着順/上がり順位を加点
  - 既存の`classLevelBonus`とは分離して保持

## 実装済み（UI/見せ方）

### 1) 「危険な人気馬」「大穴候補」ラベル
- 実装箇所:
  - `src/components/race/evaluationTags.ts`
  - `src/components/race/HorseEvaluationCard.tsx`
  - `src/components/race/HorseListTable.tsx`
  - `src/index.css`
- 判定材料:
  - `signals.winOdds`と`finalRank`の乖離
  - ラップ優位/文脈優位が大きい人気薄を穴候補に表示

### 2) ラップ適性のアイコン表示
- 実装箇所:
  - `src/components/race/evaluationTags.ts`
  - `src/components/race/HorseEvaluationCard.tsx`
  - `src/components/race/HorseListTable.tsx`
- 表示:
  - `⚡ 瞬発戦型`
  - `🔥 消耗戦型`
  - `🔁 一貫型`

### 3) 陣営の特注バッジ
- 実装箇所:
  - `src/components/race/evaluationTags.ts`
  - `src/components/race/HorseEvaluationCard.tsx`
  - `src/components/race/HorseListTable.tsx`
- 表示例:
  - `🎯騎手コース勝率XX%`
  - `🎯厩舎コース勝率XX%`
  - `🔥長距離の鬼`

## ラップ「判定不能」周りの現状
- 一覧の`ラップ一致度`は、以下の3段階表示に変更済み。
  - フル判定可能: 通常表示
  - フル判定不可だが部分評価あり: `（部分）`付き表示
  - 部分評価も無い: `判定不能`
- 実装箇所:
  - `src/components/race/HorseListTable.tsx`

## 型・データ連携の更新
- 更新済み:
  - `src/domain/race-evaluation/abilityTypes.ts`
  - `src/lib/race-data/raceEvaluationTypes.ts`
  - `src/lib/race-data/buildEvaluationData.ts`
  - `src/lib/race-data/convertToRaceEvaluationData.ts`
  - `src/lib/race-data/analysisJsonTypes.ts`
- 追加項目が「計算 → 保存 → 再読込 → UI表示」まで一貫して通る状態にしてある。

## 検証状況
- `npm run build` 実行済み（成功）
- 型エラー/ビルドエラーなし

