<!-- ユーザー提示の実装プロンプト原文を保存した設計資料。数値・定数は src/domain/race-evaluation が正。 -->

# 実装プロンプト：競馬予想サイト 能力評価・補正ロジック定義

設計・受け入れ条件・ UI 要件の全体像はチャットで提示された長文プロンプトに準拠する。
本リポジトリでの実装の要点は以下。

## 原則

- **能力値は変更しない**。変えるのは「今回求められる能力の重み」だけ。
- **標準評価**（コース標準重み）と **補正後評価**（馬場・バイアス・展開後の重み）を必ず分離する。
- 順位や印が変わるときは **説明可能な理由文** を出す。

## データ配置（実装済み）

| ファイル | 内容 |
|---------|------|
| `abilityTypes.ts` | `AbilityKey`, `WeightSet`, `HorseAbility`, `RaceCondition`, `HorseScoreResult` 等 |
| `courseWeights.ts` | `BASE_COURSE_WEIGHTS` |
| `adjustments.ts` | `GROUND_ADJUSTMENTS`, `BIAS_ADJUSTMENTS`, `PACE_ADJUSTMENTS`, `ADJUSTMENT_STRENGTH` |
| `weightResolver.ts` | 重み合成・クランプ・正規化・スコア計算 |
| `scoreCalculator.ts` | `evaluateRace` |
| `reasonGenerator.ts` | `generateScoreReason` |
| `markAssigner.ts` | 印 |
| `typeMatcher.ts` | 同タイプ・展開グループ |
| `raceTargeting.ts` | 狙い度（将来・定義のみ） |

## UI

- `RaceAdjustmentPanel.tsx` — かんたん補正 / 詳細補正（折りたたみ）
- `HorseEvaluationCard.tsx` — 印・スコア・差分・強み・理由
- `RaceEvaluationSummary.tsx` — 展開グループ・同型相手・狙い度プレースホルダー

## 受け入れ条件（要約）

標準と補正後が別算出されること、ユーザー操作で再計算されること、差分・理由が出ること、能力値が書き換わらないこと、重みが正規化されクランプされること。

詳細な文言・ボタン一覧は当初プロンプトを参照。
