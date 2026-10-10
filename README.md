# MoPME Notice Bot (TypeScript · Cloudflare Workers)

Cron (every 2 min) scrapes MoPME / DPE / DPE Munshiganj notice pages → sends new notices to Telegram. D1 dedups. Zero runtime deps.

## Layout
- `src/domain` – types, sources list, text/date helpers (pure)
- `src/application` – ports + `poll` use-case (no I/O imports)
- `src/infrastructure` – D1 repo, HTTP scraper + HTML parser, Telegram client
- `src/index.ts` – Worker entry (cron, webhook, routes)

## Deploy
```
npm i
npx wrangler login
npx wrangler d1 create mopme-notice-bot      # paste database_id into wrangler.toml
npm run db:migrate
npx wrangler secret put TELEGRAM_BOT_TOKEN
npx wrangler secret put TELEGRAM_CHAT_IDS    # comma separated
npx wrangler secret put ADMIN_CHAT_ID
npx wrangler secret put TELEGRAM_WEBHOOK_SECRET   # openssl rand -hex 32
npm run deploy
curl -i -X POST https://<worker>.<account>.workers.dev/setup-webhook \
  -H "x-telegram-bot-api-secret-token: <TELEGRAM_WEBHOOK_SECRET>"
```
Replace the URL and secret placeholders with their actual values (without angle brackets). The request header must match `TELEGRAM_WEBHOOK_SECRET` exactly. `.dev.vars` is only used by `wrangler dev`; deployed Workers need their own secrets, which can be checked with `npx wrangler secret list` and set with `npx wrangler secret put <NAME>`. Telegram setup failures return HTTP 502 with the upstream error instead of a generic Cloudflare exception.
Telegram updates are accepted at both `/webhook` and `/` so an older root-path webhook continues to work; the setup command registers `/webhook`.
## Stop temporarily (keep data)
```
# Remove cron only: delete the [triggers] crons line in wrangler.toml, then
npm run deploy
# Or set crons = [] to keep the Worker but stop polling
```

## Full teardown
```
# 1. Unregister Telegram webhook (so Telegram stops calling the Worker)
curl "https://api.telegram.org/bot<TOKEN>/deleteWebhook"

# 2. Delete the Worker (also removes cron + secrets)
npx wrangler delete mopme-notice-bot

# 3. Delete the D1 database (all notice history is lost)
npx wrangler d1 delete mopme-notice-bot
```

Admin commands: `/force` sends the newest available notice from each source to the admin only, even if already delivered (newest publication date wins; if dates are missing, the first listed notice is used); `/health` reports source status.

## How to test?
```
npm i --legacy-peer-deps   # once
npm test                   # runs parser tests
npm run check              # typecheck
```

## Notes
- Scheduled = notices dated today (Asia/Dhaka). `/force` sends only the newest notice from each source to the admin.
- Notices without a recognized publication date are skipped rather than sent with a missing-date placeholder; the parser recognizes numeric dates and Bengali/English month names.
- Max 8 notices/run (Workers subrequest cap); rest go next run.
- Parser is heuristic (table rows / list items with link + date). If a portal changes layout, `/health` alerts after 5 failures; tune `src/infrastructure/html-parser.ts`.
- Broken-TLS portals can't be fetched from Workers (no verify-off).
- Dev: `npm run check`, `npm test`.
