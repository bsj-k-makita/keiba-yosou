# 競馬予想AI機能拡張計画書：重賞・OP攻略および馬券回収率バックテストの実装

設計図・実装トラッキング用。詳細はリポジトリ内の以下モジュールを参照。

| 領域 | パス |
|------|------|
| 重賞トリガー乗算 | `src/domain/race-evaluation/classTriggerMultipliers.ts` |
| 爆穴ハント | `src/domain/race-evaluation/longshotReversal.ts` |
| 印ポートフォリオ | `src/domain/race-evaluation/markPortfolio.ts` |
| 短評生成 | `src/domain/race-evaluation/predictionComment.ts` |
| 馬券ルール | `src/domain/betting/bettingRules.ts` |
| 払戻計算 | `src/domain/betting/payoutCalculator.ts` |
| バックテスト | `src/domain/betting/runBacktest.ts` |
| CLI | `scripts/run-betting-backtest.mjs` |
| ダッシュボード | `src/app/backtest/page.tsx` |

## 処理フロー（実装版）

```
evaluateRace 前: longshotReversalIntrinsicBoost（前走補正）
  ↓
第1層 intrinsic + classTriggerMultipliers
  ↓
raceAdjustedInput → 相対化 → 文脈・ラップ → finalEvaluationScore
  ↓
assignMarks → distributeMarkPortfolio → 4角◎振替 → …
  ↓
generatePredictionShortComment
  ↓
（別パイプライン）generateTickets → calculateRacePayout → 集計
```

## 払戻データについて

現行 `src/data/results/*.json` は着順のみ。馬連・3連複は **単勝オッズからの推定払戻** を使用（`payoutCalculator.ts` の `estimated` フラグ）。公式払戻が取れるようになったら `dividends` を差し替え可能。
