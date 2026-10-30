const fs = require('node:fs');
const path = require('node:path');

const html = fs.readFileSync(path.join(process.cwd(), 'views', 'index.html'), 'utf8');
const TOKEN = process.env.TELEGRAM_BOT_TOKEN || '';
const CHAT_ID = process.env.TELEGRAM_CHAT_ID || '';
const UPDATE_TYPES = ['message', 'edited_message', 'channel_post', 'edited_channel_post'];
const MAX_DOWNLOAD_BYTES = 20 * 1024 * 1024;
const mimeByExtension = {
  jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif', webp: 'image/webp', heic: 'image/heic', svg: 'image/svg+xml',
  mp4: 'video/mp4', m4v: 'video/mp4', mov: 'video/quicktime', webm: 'video/webm', mkv: 'video/x-matroska',
  mp3: 'audio/mpeg', m4a: 'audio/mp4', ogg: 'audio/ogg', oga: 'audio/ogg', opus: 'audio/ogg', wav: 'audio/wav', flac: 'audio/flac',
  pdf: 'application/pdf', zip: 'application/zip', rar: 'application/vnd.rar', '7z': 'application/x-7z-compressed',
};

function sendJson(res, status, value) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(JSON.stringify(value));
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

// Vercel keeps no state between requests, so messages are read straight from Telegram.
// Updates are never confirmed, which lets Telegram keep them (for up to 24 hours).
async function readMessages() {
  if (!TOKEN) return [];
  let batch = await telegram('getUpdates', { limit: 100, timeout: 0, allowed_updates: UPDATE_TYPES });
  let previous = [];
  // getUpdates returns the oldest 100; skip ahead so the newest messages are always visible.
  while (batch.length === 100) {
    previous = batch;
    batch = await telegram('getUpdates', { offset: batch.at(-1).update_id + 1, limit: 100, timeout: 0, allowed_updates: UPDATE_TYPES });
  }
  const byId = new Map();
  for (const update of [...previous, ...batch]) {
    const message = update.message || update.edited_message || update.channel_post || update.edited_channel_post;
    if (!message || (CHAT_ID && String(message.chat.id) !== CHAT_ID)) continue;
    const record = normalizeMessage(message, update.update_id);
    byId.set(record.id, record);
  }
  return [...byId.values()].sort((a, b) => b.updateId - a.updateId);
}

module.exports = async function handler(req, res) {
  const url = new URL(req.url, 'https://vercel.invalid');
  const route = url.pathname.replace(/^\/api\/?/, '').split('/').filter(Boolean);
  const endpoint = route[0] || '';
  res.setHeader('x-content-type-options', 'nosniff');
  res.setHeader('referrer-policy', 'same-origin');

  try {
    // The / rewrite keeps the original URL, so an empty route is the dashboard too.
    if (endpoint === 'dashboard' || endpoint === '') {
      if (req.method !== 'GET') { res.writeHead(405); res.end('Method not allowed'); return; }
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' }); res.end(html); return;
    }
    if (endpoint === 'status') {
      if (!TOKEN || !CHAT_ID) { sendJson(res, 200, { mode: 'vercel', configured: false, connected: false, bot: null, lastError: null, groupHealth: null, count: 0 }); return; }
      const bot = await telegram('getMe');
      const [chat, member, webhook] = await Promise.all([
        telegram('getChat', { chat_id: CHAT_ID }), telegram('getChatMember', { chat_id: CHAT_ID, user_id: bot.id }), telegram('getWebhookInfo'),
      ]);
      const isAdmin = ['administrator', 'creator'].includes(member.status);
      const messages = webhook.url ? [] : await readMessages();
      sendJson(res, 200, { mode: 'vercel', configured: true, connected: true, bot, lastError: null,
        groupHealth: { accessible: true, title: chat.title || 'Telegram group', memberStatus: member.status, isAdmin,
          privacyMayBlock: !isAdmin && !bot.can_read_all_group_messages, webhookActive: Boolean(webhook.url) },
        count: messages.length }); return;
    }
    if (endpoint === 'messages') {
      if (req.method !== 'GET') { res.writeHead(405); res.end('Method not allowed'); return; }
      const q = (url.searchParams.get('q') || '').toLowerCase(); const chat = url.searchParams.has('chat') ? url.searchParams.get('chat') : CHAT_ID;
      const messages = await readMessages();
      sendJson(res, 200, messages.filter(m => (!chat || m.chatId === chat) && (!q || `${m.text} ${m.sender} ${m.chat} ${m.username}`.toLowerCase().includes(q)))); return;
    }
    if (endpoint === 'chats') {
      const messages = await readMessages();
      const chats = [...new Map(messages.map(m => [m.chatId, { id: m.chatId, title: m.chat, type: m.type }])).values()];
      if (CHAT_ID && !chats.some(chat => chat.id === CHAT_ID)) chats.unshift({ id: CHAT_ID, title: 'Selected Telegram group', type: 'supergroup' });
      sendJson(res, 200, chats); return;
    }
    if (endpoint === 'profiles') {
      const chat = url.searchParams.has('chat') ? url.searchParams.get('chat') : CHAT_ID;
      const messages = await readMessages();
      const userIds = [...new Set(messages.filter(m => (!chat || m.chatId === chat) && m.senderId).map(m => m.senderId))];
      // The photo endpoint looks up the picture; the page hides the <img> if there is none.
      sendJson(res, 200, Object.fromEntries(userIds.map(userId => [userId, { photoUrl: `/api/profile-photo/${encodeURIComponent(userId)}` }]))); return;
    }
    if (endpoint === 'profile-photo' && route[1]) {
      const userId = Number(decodeURIComponent(route[1]));
      const result = await telegram('getUserProfilePhotos', { user_id: userId, limit: 1 }).catch(() => null);
      const fileId = result?.photos?.[0]?.at(-1)?.file_id;
      if (!fileId) { res.writeHead(404, { 'cache-control': 'public, max-age=3600' }); res.end('Profile photo not found'); return; }
      await sendFile(res, fileId, 'profile.jpg'); return;
    }
    if (endpoint === 'media' && route[1]) {
      const fileId = decodeURIComponent(route.slice(1).join('/'));
      const messages = await readMessages();
      const record = messages.find(m => m.media?.fileId === fileId);
      if (!record) { res.writeHead(404); res.end('Media not found'); return; }
      await sendFile(res, fileId, record.media.name, req.headers.range); return;
    }
    res.writeHead(404); res.end('Not found');
  } catch (error) {
    sendJson(res, 500, { error: error.message });
  }
};
