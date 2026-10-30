async function main() {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const secret = process.env.TELEGRAM_WEBHOOK_SECRET;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  const origin = process.argv[2]?.replace(/\/$/, '');

  if (!token || !secret || !chatId || !origin) {
    console.error('Usage: npm run webhook:set -- https://your-project.vercel.app');
    console.error('Set TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID, and TELEGRAM_WEBHOOK_SECRET in .env first.');
    process.exitCode = 1; return;
  }
  if (!/^https:\/\//i.test(origin)) throw new Error('The deployed Vercel URL must use HTTPS.');
  if (!/^[A-Za-z0-9_-]{1,256}$/.test(secret)) throw new Error('TELEGRAM_WEBHOOK_SECRET must use 1–256 letters, numbers, underscores, or hyphens.');

  const response = await fetch(`https://api.telegram.org/bot${token}/setWebhook`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      url: `${origin}/api/telegram-webhook`, secret_token: secret,
      allowed_updates: ['message', 'edited_message', 'channel_post', 'edited_channel_post'],
    }),
  });
  const result = await response.json();
  if (!response.ok || !result.ok) throw new Error(result.description || `Telegram setWebhook failed (${response.status}).`);
  console.log(`Telegram webhook configured for ${origin}/api/telegram-webhook.`);
}

main().catch(error => { console.error(error.message); process.exitCode = 1; });
