# Telegram Group Dashboard

A Telegram Bot API dashboard for group messages, sender profiles, and shared media. The Vercel version uses a Telegram webhook and Upstash Redis so it works with short lived serverless functions. The local `npm start` mode remains available for development.

## Deploy from GitHub to Vercel

1. Push this repository to GitHub and import `sengchhunyeang/bot_tracking_telegram` in Vercel. Set `main` as the Production Branch. Once connected, pushes to `main` create production deployments and other branches create previews.
2. In the Vercel project, add an Upstash Redis database from the Marketplace and connect it to this project. The integration supplies `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN`.
3. Add these project environment variables for Production (and Preview only if needed):
   - `TELEGRAM_BOT_TOKEN` — the BotFather token; enter it in Vercel settings, never in GitHub.
   - `TELEGRAM_CHAT_ID` — defaults to `-1004466733765`.
   - `TELEGRAM_WEBHOOK_SECRET` — a random string using only letters, numbers, `_`, and `-` (1–256 characters).
   - `DASHBOARD_PASSWORD` — a strong password; the public dashboard uses HTTP Basic Auth with username `admin`.
4. Redeploy after setting the variables. Copy `.env.example` to `.env` locally, fill in the Telegram token, chat ID, and webhook secret, then configure Telegram once:

   ```sh
   npm run webhook:set -- https://your-project.vercel.app
   ```

   Use the production Vercel domain. Stop the local polling server before setting the webhook; Telegram does not allow `getUpdates` polling and webhooks at the same time.

After the one-time Vercel import and webhook setup, each push to the production branch deploys automatically. Vercel preview deployments do not change the Telegram webhook.

## Local development

`npm start` runs the existing local polling server at `http://localhost:3000`. The webhook deployment uses Redis and Vercel Functions instead of local disk storage.

## Telegram behavior

The bot must be in the target group and be an administrator (or have Group Privacy Mode disabled) to receive ordinary messages. The Bot API cannot fetch earlier group history; the hosted dashboard stores updates received after the webhook is set. Telegram’s hosted Bot API allows bots to download files up to 20 MB.

## Privacy and secrets

The public dashboard requires `DASHBOARD_PASSWORD`; message and media APIs use the same Basic Auth protection. The Telegram webhook endpoint checks `TELEGRAM_WEBHOOK_SECRET`. Do not commit `.env`, bot tokens, passwords, or Upstash credentials.
