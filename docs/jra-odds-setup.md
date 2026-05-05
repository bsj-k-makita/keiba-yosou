# JRAオッズAPI設定手順

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
npm run refresh-latest-odds -- --date=2026-05-03 --source=jra
```

期待出力例:
- `jra_rows=...` が 0 より大きい
- `summary` の `actual_odds` が増える

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
