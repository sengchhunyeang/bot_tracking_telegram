# Telegram Group Dashboard

A Telegram Bot API dashboard for group messages, sender profiles, and shared media.

## Shared history on Vercel and local

Vercel Functions are stateless, so both environments use a shared Postgres database. Telegram sends messages to a Vercel webhook, which stores them in the database. The local dashboard and Vercel dashboard both read from that database.

1. Import `sengchhunyeang/bot_tracking_telegram` in Vercel with `main` as the Production Branch. Pushes to `main` deploy to production.
2. Create a dedicated Neon Postgres project in Singapore (`aws-ap-southeast-1`) and add its pooled connection string as `DATABASE_URL` in Vercel Production and in the local `.env` file. Keep the direct URL as local `DATABASE_URL_UNPOOLED` for migrations.
3. Add `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`, and `TELEGRAM_WEBHOOK_SECRET` to Vercel Production. Put the same bot token, chat ID, webhook secret, and pooled `DATABASE_URL` in local `.env`. Keep all credentials out of GitHub.
4. Run `npm run db:migrate` to create the table and indexes.
5. Run `npm run db:import-local` once to copy the existing `data/messages.json` history into Postgres. The import is safe to repeat; message IDs are upserted.
6. After Vercel has deployed with those variables, set Telegram's webhook to the production API endpoint:

   ```sh
   npm run telegram:set-webhook -- https://your-project.vercel.app/api/webhook
   ```

   This uses `TELEGRAM_WEBHOOK_SECRET` from local `.env`. Telegram delivers future messages to the webhook, and the database keeps the history beyond Telegram's 24-hour update queue.

The local server reads from Postgres and does not poll Telegram in shared mode. Standalone polling can be explicitly enabled with `LOCAL_TELEGRAM_POLLING=true`, but should be left off while the webhook is active.

The dashboard has no login: anyone with the URL can read the group's messages and media.

## Local development

`npm start` runs the dashboard at `http://localhost:3000`. With `DATABASE_URL` configured, it reads the same messages as Vercel. Without a database, it can display the existing local `data/messages.json` file; by default it does not poll Telegram.

## Telegram behavior

The bot must be in the target group and be an administrator (or have Group Privacy Mode disabled) to receive ordinary messages. The Bot API cannot fetch earlier group history. Telegram's hosted Bot API allows bots to download files up to 20 MB.

## Secrets

Do not commit `.env` or bot tokens.
