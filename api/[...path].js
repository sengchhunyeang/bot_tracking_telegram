const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { Redis } = require('@upstash/redis');

const html = fs.readFileSync(path.join(process.cwd(), 'views', 'index.html'), 'utf8');
const TOKEN = process.env.TELEGRAM_BOT_TOKEN || '';
const CHAT_ID = process.env.TELEGRAM_CHAT_ID || '';
const SECRET = process.env.TELEGRAM_WEBHOOK_SECRET || '';
const PASSWORD = process.env.DASHBOARD_PASSWORD || '';
const MESSAGE_KEY = 'telegram-dashboard:messages';
const MAX_MESSAGES = 5000;
const MAX_DOWNLOAD_BYTES = 20 * 1024 * 1024;
const mimeByExtension = {
  jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif', webp: 'image/webp', heic: 'image/heic', svg: 'image/svg+xml',
  mp4: 'video/mp4', m4v: 'video/mp4', mov: 'video/quicktime', webm: 'video/webm', mkv: 'video/x-matroska',
  mp3: 'audio/mpeg', m4a: 'audio/mp4', ogg: 'audio/ogg', oga: 'audio/ogg', opus: 'audio/ogg', wav: 'audio/wav', flac: 'audio/flac',
  pdf: 'application/pdf', zip: 'application/zip', rar: 'application/vnd.rar', '7z': 'application/x-7z-compressed',
};

function redisClient() {
  const url = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;
  if (!url || !token) throw new Error('Connect an Upstash Redis database and set its REST environment variables.');
  return new Redis({ url, token });
}

function sendJson(res, status, value) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(JSON.stringify(value));
}

function authorized(req) {
  if (!PASSWORD) return false;
  const header = req.headers.authorization || '';
  if (!header.startsWith('Basic ')) return false;
  let supplied;
  try { supplied = Buffer.from(header.slice(6), 'base64').toString('utf8'); } catch { return false; }
  const expected = `admin:${PASSWORD}`;
  const actualBytes = Buffer.from(supplied);
  const expectedBytes = Buffer.from(expected);
  return actualBytes.length === expectedBytes.length && crypto.timingSafeEqual(actualBytes, expectedBytes);
}

function askForLogin(res) {
  res.writeHead(401, { 'www-authenticate': 'Basic realm="Telegram Group Inbox", charset="UTF-8"', 'cache-control': 'no-store' });
  res.end('Sign in to view this Telegram dashboard.');
}

async function telegram(method, params = {}) {
  if (!TOKEN) throw new Error('TELEGRAM_BOT_TOKEN is not configured.');
  const response = await fetch(`https://api.telegram.org/bot${TOKEN}/${method}`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(params), signal: AbortSignal.timeout(25000),
  });
  const data = await response.json();
  if (!response.ok || !data.ok) throw new Error(data.description || `Telegram API returned ${response.status}`);
  return data.result;
}

function extensionOf(name) { return (String(name || '').split('.').pop() || '').toLowerCase(); }
function kindForMime(mime) { return mime.startsWith('image/') ? 'photo' : mime.startsWith('video/') ? 'video' : mime.startsWith('audio/') ? 'audio' : 'file'; }

function mediaOf(message) {
  const make = (kind, file, name, mime) => {
    const type = mime || file.mime_type || mimeByExtension[extensionOf(name || file.file_name)] || '';
    return { kind: kindForMime(type) === 'file' ? kind : kindForMime(type), fileId: file.file_id,
      name: name || file.file_name || 'Attachment', size: file.file_size || 0, mime: type,
      tooLarge: (file.file_size || 0) > MAX_DOWNLOAD_BYTES };
  };
  if (message.photo?.length) return make('photo', message.photo.at(-1), 'Photo', 'image/jpeg');
  if (message.video) return make('video', message.video, message.video.file_name || 'Video');
  if (message.animation) return make('video', message.animation, message.animation.file_name || 'Animation');
  if (message.video_note) return make('video', message.video_note, 'Video message', 'video/mp4');
  if (message.sticker) return make(message.sticker.is_video || message.sticker.is_animated ? 'video' : 'photo', message.sticker, 'Sticker', message.sticker.is_animated || message.sticker.is_video ? 'video/webm' : 'image/webp');
  if (message.audio) return make('audio', message.audio, message.audio.file_name || message.audio.title || 'Audio');
  if (message.voice) return make('audio', message.voice, 'Voice message', message.voice.mime_type || 'audio/ogg');
  if (message.document) return make('file', message.document, message.document.file_name || 'Document');
  return null;
}

function normalizeMessage(message, updateId) {
  const nameParts = [message.from?.first_name, message.from?.last_name].filter(Boolean);
  const sender = nameParts.join(nameParts.length > 1 ? ' - ' : '') || message.from?.username || message.sender_chat?.title || 'Unknown sender';
  const media = mediaOf(message);
  const kind = ['contact', 'dice', 'game', 'poll', 'venue', 'location', 'story', 'checklist', 'paid_media', 'users_shared', 'chat_shared', 'web_app_data'].find(key => message[key]);
  const body = message.text || message.caption || (media ? media.name
    : kind === 'contact' ? `Contact: ${message.contact.first_name || ''} ${message.contact.last_name || ''} ${message.contact.phone_number || ''}`.trim()
    : kind === 'location' ? `Location: ${message.location.latitude}, ${message.location.longitude}`
    : kind === 'venue' ? `Place: ${message.venue.title} — ${message.venue.address}`
    : kind === 'dice' ? `Dice: ${message.dice.emoji} ${message.dice.value}`
    : kind === 'poll' ? `Poll: ${message.poll.question}`
    : kind ? `${kind.replaceAll('_', ' ')} message` : 'Telegram message');
  return {
    id: `${message.chat.id}-${message.message_id}`, updateId, date: message.date * 1000,
    chatId: String(message.chat.id), chat: message.chat.title || [message.chat.first_name, message.chat.last_name].filter(Boolean).join(' ') || message.chat.username || 'Private chat',
    type: message.chat.type, sender, senderId: message.from?.id ? String(message.from.id) : '',
    username: message.from?.username || message.sender_chat?.username || '', text: body, messageId: message.message_id, media,
  };
}

async function requestBody(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  if (typeof req.body === 'string') return JSON.parse(req.body);
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

async function readMessages(redis) {
  const entries = await redis.lrange(MESSAGE_KEY, 0, MAX_MESSAGES - 1);
  return entries.map(entry => typeof entry === 'string' ? JSON.parse(entry) : entry);
}

async function sendFile(res, fileId, name, range) {
  const file = await telegram('getFile', { file_id: fileId });
  const download = await fetch(`https://api.telegram.org/file/bot${TOKEN}/${file.file_path}`, {
    headers: range ? { range } : undefined, signal: AbortSignal.timeout(25000),
  });
  if (!download.ok) throw new Error(`Telegram file download returned ${download.status}`);
  const reported = (download.headers.get('content-type') || '').split(';')[0].trim();
  const mime = reported && reported !== 'application/octet-stream' ? reported : mimeByExtension[extensionOf(file.file_path || name)] || 'application/octet-stream';
  const inline = /^(image\/(jpeg|png|gif|webp|avif)|video\/|audio\/)/i.test(mime) || mime === 'application/pdf';
  const safeName = String(name || file.file_path || 'file').replace(/["\\\r\n]/g, '_');
  res.writeHead(download.status === 206 ? 206 : 200, {
    'content-type': inline ? mime : 'application/octet-stream', 'cache-control': 'private, max-age=3600',
    'content-disposition': `${inline ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(safeName)}`,
    ...(download.headers.get('content-length') ? { 'content-length': download.headers.get('content-length') } : {}),
    ...(download.headers.get('content-range') ? { 'content-range': download.headers.get('content-range') } : {}), 'accept-ranges': 'bytes',
  });
  if (!download.body) { res.end(); return; }
  require('node:stream').Readable.fromWeb(download.body).pipe(res);
}

module.exports = async function handler(req, res) {
  const url = new URL(req.url, 'https://vercel.invalid');
  const route = url.pathname.replace(/^\/api\/?/, '').split('/').filter(Boolean);
  const endpoint = route[0] || '';
  res.setHeader('x-content-type-options', 'nosniff');
  res.setHeader('referrer-policy', 'same-origin');

  if (endpoint === 'telegram-webhook') {
    if (req.method !== 'POST') { res.writeHead(405); res.end('Method not allowed'); return; }
    if (!TOKEN || !CHAT_ID || !SECRET) { sendJson(res, 503, { error: 'Telegram webhook environment is incomplete.' }); return; }
    const sentSecret = req.headers['x-telegram-bot-api-secret-token'] || '';
    const a = Buffer.from(String(sentSecret)); const b = Buffer.from(SECRET);
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) { sendJson(res, 403, { error: 'Invalid webhook secret.' }); return; }
    try {
      const update = await requestBody(req);
      const message = update.message || update.edited_message || update.channel_post || update.edited_channel_post;
      if (!message || String(message.chat.id) !== CHAT_ID) { sendJson(res, 200, { ok: true, ignored: true }); return; }
      const redis = redisClient();
      const accepted = await redis.set(`telegram-dashboard:update:${update.update_id}`, '1', { nx: true, ex: 604800 });
      if (accepted) {
        const record = normalizeMessage(message, update.update_id);
        try {
          await redis.lpush(MESSAGE_KEY, JSON.stringify(record));
          await redis.ltrim(MESSAGE_KEY, 0, MAX_MESSAGES - 1);
          await redis.set('telegram-dashboard:last-update', Date.now());
        } catch (error) {
          await redis.del(`telegram-dashboard:update:${update.update_id}`).catch(() => {});
          throw error;
        }
      }
      sendJson(res, 200, { ok: true });
    } catch (error) { sendJson(res, 500, { error: error.message }); }
    return;
  }

  if (!authorized(req)) {
    if (!PASSWORD) { sendJson(res, 503, { error: 'Set DASHBOARD_PASSWORD in Vercel project environment variables.' }); return; }
    askForLogin(res); return;
  }

  try {
    const redis = redisClient();
    if (endpoint === 'dashboard') {
      if (req.method !== 'GET') { res.writeHead(405); res.end('Method not allowed'); return; }
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' }); res.end(html); return;
    }
    if (endpoint === 'status') {
      const bot = await telegram('getMe');
      const [count, lastUpdate, chat, member, webhook] = await Promise.all([
        redis.llen(MESSAGE_KEY), redis.get('telegram-dashboard:last-update'), telegram('getChat', { chat_id: CHAT_ID }),
        telegram('getChatMember', { chat_id: CHAT_ID, user_id: bot.id }), telegram('getWebhookInfo'),
      ]);
      sendJson(res, 200, { mode: 'webhook', configured: Boolean(TOKEN && CHAT_ID && SECRET && PASSWORD), connected: true, bot,
        groupHealth: { accessible: true, title: chat.title || 'Telegram group', memberStatus: member.status,
          isAdmin: ['administrator', 'creator'].includes(member.status), webhookActive: Boolean(webhook.url) },
        count: Number(count) || 0, lastUpdate }); return;
    }
    if (endpoint === 'messages') {
      if (req.method !== 'GET') { res.writeHead(405); res.end('Method not allowed'); return; }
      const q = (url.searchParams.get('q') || '').toLowerCase(); const chat = url.searchParams.has('chat') ? url.searchParams.get('chat') : CHAT_ID;
      const messages = await readMessages(redis);
      sendJson(res, 200, messages.filter(m => (!chat || m.chatId === chat) && (!q || `${m.text} ${m.sender} ${m.chat} ${m.username}`.toLowerCase().includes(q)))); return;
    }
    if (endpoint === 'chats') {
      const messages = await readMessages(redis);
      const chats = [...new Map(messages.map(m => [m.chatId, { id: m.chatId, title: m.chat, type: m.type }])).values()];
      if (CHAT_ID && !chats.some(chat => chat.id === CHAT_ID)) chats.unshift({ id: CHAT_ID, title: 'Selected Telegram group', type: 'supergroup' });
      sendJson(res, 200, chats); return;
    }
    if (endpoint === 'profiles') {
      const chat = url.searchParams.has('chat') ? url.searchParams.get('chat') : CHAT_ID;
      const messages = await readMessages(redis);
      const userIds = [...new Set(messages.filter(m => (!chat || m.chatId === chat) && m.senderId).map(m => m.senderId))].slice(0, 50);
      const profiles = await Promise.all(userIds.map(async userId => {
        const key = `telegram-dashboard:profile:${userId}`;
        let fileId = await redis.get(key);
        if (fileId === null) {
          try { const result = await telegram('getUserProfilePhotos', { user_id: Number(userId), limit: 1 }); fileId = result.photos?.[0]?.at(-1)?.file_id || ''; }
          catch { fileId = ''; }
          await redis.set(key, fileId, { ex: 86400 });
        }
        return [userId, { photoUrl: fileId ? `/api/profile-photo/${encodeURIComponent(userId)}` : null }];
      }));
      sendJson(res, 200, Object.fromEntries(profiles)); return;
    }
    if (endpoint === 'profile-photo' && route[1]) {
      const userId = decodeURIComponent(route[1]);
      const fileId = await redis.get(`telegram-dashboard:profile:${userId}`);
      if (!fileId) { res.writeHead(404); res.end('Profile photo not found'); return; }
      await sendFile(res, fileId, 'profile.jpg'); return;
    }
    if (endpoint === 'media' && route[1]) {
      const fileId = decodeURIComponent(route.slice(1).join('/'));
      const messages = await readMessages(redis);
      const record = messages.find(m => m.media?.fileId === fileId);
      if (!record) { res.writeHead(404); res.end('Media not found'); return; }
      await sendFile(res, fileId, record.media.name, req.headers.range); return;
    }
    res.writeHead(404); res.end('Not found');
  } catch (error) {
    sendJson(res, 500, { error: error.message });
  }
};
