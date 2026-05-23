# JRAオッズAPI設定手順

**日常のオッズ更新手順（Playwright 公式サイト・live-fallback・backfill）**は  
[現状実装まとめ-2026-05.md](./現状実装まとめ-2026-05.md) §3 を参照。

本ファイルは主に **自前 JRA 系 HTTP API**（`JRA_ODDS_API_BASE_URL`）の設定用です。  
API 未設定時は **`scripts/lib/jraDriver.mjs`** が sp.jra.jp を Playwright で取得します（追加設定不要）。

## 1) ローカル設定

1. プロジェクト直下で `.env.local` を作成（`.env.example` をコピー）
2. 最低限 `JRA_ODDS_API_BASE_URL` を設定

例:

```bash
cp .env.example .env.local
```

`.env.local`:

```env
JRA_ODDS_API_BASE_URL="https://your-jra-api.example.com/odds"
JRA_ODDS_API_TOKEN="xxxxxxxx"
```

補足:
- `JRA_ODDS_API_TOKEN` は `Authorization: Bearer ...` ヘッダで送信
- `JRA_ODDS_API_KEY` は `X-API-Key` ヘッダで送信
- APIが `GET /api/odds/{raceId}` 形式なら `JRA_ODDS_API_ENDPOINT_TEMPLATE` を設定
- レスポンス配列が `data.rows` などにある場合は `JRA_ODDS_API_ROWS_PATH` を設定

## 2) 動作確認

```bash
node scripts/refresh-latest-odds.mjs --date=2026-05-23 --live-fallback --retries=3 --retry-wait=30000
python3 scripts/backfill-ai-predictions.py --start-date 2026-05-23 --end-date 2026-05-23 --ts-only
```

期待出力例:
- `jra_rows=...` が 0 より大きい（`jra_miss_races=0` が理想）
- `round 1/3: changed=36`（live-fallback）
- backfill: `Done: 36/36 races updated`

## 3) 本番（Vercel）設定

Vercelプロジェクトに同じ環境変数を設定:

```bash
vercel env add JRA_ODDS_API_BASE_URL production
vercel env add JRA_ODDS_API_TOKEN production
```

必要に応じて:

```bash
vercel env add JRA_ODDS_API_KEY production
vercel env add JRA_ODDS_API_ENDPOINT_TEMPLATE production
vercel env add JRA_ODDS_API_ROWS_PATH production
```

設定後に再デプロイ:

```bash
npx vercel --prod --yes
```
