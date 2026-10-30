# Telegram Group Dashboard

A Telegram Bot API dashboard for group messages, sender profiles, and shared media.

## Deploy from GitHub to Vercel

1. Import `sengchhunyeang/bot_tracking_telegram` in Vercel with `main` as the Production Branch. Pushes to `main` deploy to production.
2. Add these environment variables for Production:
   - `TELEGRAM_BOT_TOKEN` — the BotFather token; enter it in Vercel settings, never in GitHub.
   - `TELEGRAM_CHAT_ID` — defaults to `-1004466733765`.
3. Redeploy after setting the variables.

No database is needed. The Vercel version reads messages directly from Telegram (`getUpdates`) on each request, without confirming them, so it shows what Telegram still holds: **messages from the last 24 hours**. The bot must not have a webhook set.

The dashboard has no login: anyone with the URL can read the group's messages and media.

## Local development

`npm start` runs the local polling server (`scripts/local-server.js`; kept out of the project root so Vercel does not detect it as the app entrypoint) at `http://localhost:3000`. It confirms updates as it reads them and saves history to `data/`, so while it runs, those messages are removed from Telegram's queue and will not appear on the Vercel dashboard.

## Telegram behavior

The bot must be in the target group and be an administrator (or have Group Privacy Mode disabled) to receive ordinary messages. The Bot API cannot fetch earlier group history. Telegram's hosted Bot API allows bots to download files up to 20 MB.

## Secrets

Do not commit `.env` or bot tokens.
