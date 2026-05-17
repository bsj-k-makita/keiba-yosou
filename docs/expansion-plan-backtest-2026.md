# 競馬予想AI機能拡張計画書：重賞・OP攻略および馬券回収率バックテストの実装

設計図・実装トラッキング用。

| 領域 | パス |
|------|------|
| 重賞トリガー乗算 | `src/domain/race-evaluation/classTriggerMultipliers.ts` |
| 爆穴ハント | `src/domain/race-evaluation/longshotReversal.ts` |
| 印ポートフォリオ | `src/domain/race-evaluation/markPortfolio.ts` |
| 短評生成 | `src/domain/race-evaluation/predictionComment.ts` |
| 馬券ルール | `src/domain/betting/bettingRules.ts` |
| 払戻計算 | `src/domain/betting/payoutCalculator.ts` |
| バックテスト | `src/domain/betting/runBacktest.ts` / `runFullBacktest.ts` |
| 確定払戻パース | `scripts/lib/parseNetkeibaPayouts.mjs` |
| 結果取得 | `scripts/fetch-race-results.mjs` |
| ダッシュボード | `src/app/backtest/page.tsx` |

## コマンド

```bash
npm run fetch-results:payouts   # 既存 results/*.json を確定払戻付きで再取得
npm run backtest:bets           # 回収率サマリ生成 → src/data/backtest_summary.json
```

## フェーズ2（進行中）

1. **確定払戻** — 完了。`results/*.json` に `payouts: { WIN, SHOW, REN, WREN, TRI }` を格納。
2. **クラス判定厳密化** — 未着手（`raceGrade` / `classTier`）
3. **3連複フォーメ改造** — 未着手（2頭軸・☆2列目昇格）

## 確定払戻ベース初回（70レース）

| 券種 | 回収率 | 的中率 |
|------|--------|--------|
| 単勝◎ | 55.6% | 14.3% |
| 馬連◎○▲ | 70.6% | 3.3% |
| 3連複フォーメ | 4.9% | 0.5% |
| 合計 | 25.2% | — |

推定払戻時代の馬連26%は過小評価、3連複20.8%は過大評価だった。真のボトルネックは3連複の組み合わせ設計。
