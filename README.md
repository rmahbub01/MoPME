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
```

### After deploying, register Telegram's webhook by calling the Worker setup route:

Replace the example URL and secret with the deployed Worker URL and the exact `TELEGRAM_WEBHOOK_SECRET` configured with `wrangler secret put`. The setup route registers `https://<worker-host>/webhook` with Telegram and configures the `message` update type. **It discards any Telegram updates already waiting to be delivered.** Do not call it if you need to retain pending updates; instead, register with Telegram's Bot API `setWebhook` using the same URL and secret, leaving `drop_pending_updates` unset:
```
curl --fail-with-body -X POST "https://api.telegram.org/bot<TELEGRAM_BOT_TOKEN>/setWebhook" \
  -d "url=https://mopme-notice-bot.mopme.workers.dev/webhook" \
  -d "secret_token=<TELEGRAM_WEBHOOK_SECRET>" \
  --data-urlencode 'allowed_updates=["message"]'
```

Check the result with Telegram's `getWebhookInfo` method. The returned `url` should end in `/webhook`; `pending_update_count` should normally return to zero. Keep the bot token private:
```
curl "https://api.telegram.org/bot<TELEGRAM_BOT_TOKEN>/getWebhookInfo"
```

`.dev.vars` is used only by `wrangler dev`; deployed Workers use their own secrets. List configured secret names with `npx wrangler secret list` and update them with `npx wrangler secret put <NAME>`. The webhook secret Telegram stores must match the deployed `TELEGRAM_WEBHOOK_SECRET`, or Telegram's requests will be rejected with HTTP 403. Setup failures return HTTP 502 with the upstream error.

To unregister the webhook without deleting the Worker or its data, call Telegram's `deleteWebhook` method:
```
curl -X POST "https://api.telegram.org/bot<TELEGRAM_BOT_TOKEN>/deleteWebhook"
```
Deleting the webhook stops Telegram from delivering bot updates. It does not delete the Worker, its secrets, or the D1 database.

Telegram updates are accepted at both `/webhook` and `/` for compatibility with an older root-path webhook; setup registers `/webhook`. The curl command above that posts to `/` is not webhook registration: it only sends a test HTTP request to the Worker.
## Stop temporarily (keep data)
```
# Remove cron only: delete the [triggers] crons line in wrangler.toml, then
npm run deploy
# Or set crons = [] to keep the Worker but stop polling
```

## Full teardown
```
# 1. Unregister the Telegram webhook
curl -X POST "https://api.telegram.org/bot<TELEGRAM_BOT_TOKEN>/deleteWebhook"

# 2. Delete the Worker (also removes cron + secrets)
npx wrangler delete mopme-notice-bot

# 3. Delete the D1 database (all notice history is lost)
npx wrangler d1 delete mopme-notice-bot
```

Admin commands (private/admin chat only): `/force` sends the newest available notice from each source to the admin, even if already delivered (newest publication date wins; if dates are missing, the first listed notice is used); `/health` reports source status. The HTTP health endpoint is `GET /healthz`; it is separate from the Telegram `/health` command.

## Troubleshooting

| Symptom | Cause / fix |
|---|---|
| Bot does not receive commands; `getWebhookInfo` has an empty `url` | Register the webhook using the steps above. |
| Telegram reports `403 Forbidden` for webhook delivery | The registered webhook secret does not match the deployed `TELEGRAM_WEBHOOK_SECRET`. Set the same value in both places, then register again. |
| `/healthz` returns `200`, but Telegram commands do not work | `/healthz` only checks that the Worker responds. Check `getWebhookInfo`, then inspect logs with `npx wrangler tail mopme-notice-bot --format=pretty`. |
| `/health` reports `Command failed` and logs show `no such table: source_state` | The remote D1 schema is missing. Apply the migration with `npm run db:migrate`, then retry `/health`. |
| `/health` or `/force` gets no reply | These commands are restricted to `ADMIN_CHAT_ID`; send them from that Telegram chat. Check Worker logs for Telegram API errors if the chat is correct. |

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
