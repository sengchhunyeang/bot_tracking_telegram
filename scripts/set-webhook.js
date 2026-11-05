require('../lib/load-env');

const token = process.env.TELEGRAM_BOT_TOKEN;
const secret = process.env.TELEGRAM_WEBHOOK_SECRET;
const webhookUrl = process.argv[2] || process.env.TELEGRAM_WEBHOOK_URL;

async function main() {
  if (!token) throw new Error('TELEGRAM_BOT_TOKEN is not configured.');
  if (!secret || !/^[A-Za-z0-9_-]{1,256}$/.test(secret)) {
    throw new Error('TELEGRAM_WEBHOOK_SECRET must contain 1–256 letters, numbers, underscores, or hyphens.');
  }
  if (!webhookUrl) throw new Error('Pass the production /api/webhook URL or set TELEGRAM_WEBHOOK_URL in .env.');
  const url = new URL(webhookUrl);
  if (url.protocol !== 'https:' || !url.pathname.endsWith('/api/webhook')) {
    throw new Error('The webhook URL must be HTTPS and end with /api/webhook.');
  }
  const response = await fetch(`https://api.telegram.org/bot${token}/setWebhook`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      url: url.toString(),
      secret_token: secret,
      allowed_updates: ['message', 'edited_message', 'channel_post', 'edited_channel_post'],
      drop_pending_updates: false,
    }),
    signal: AbortSignal.timeout(15000),
  });
  const result = await response.json();
  if (!response.ok || !result.ok) throw new Error(result.description || `Telegram API returned ${response.status}`);
  console.log(`Telegram webhook set to ${url.origin}${url.pathname}.`);
}

main().catch(error => {
  console.error(`Webhook setup failed: ${error.message}`);
  process.exitCode = 1;
});
