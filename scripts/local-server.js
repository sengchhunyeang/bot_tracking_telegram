const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

function loadEnv() {
  try {
    for (const line of fs.readFileSync(path.join(__dirname, '..', '.env'), 'utf8').split(/\r?\n/)) {
      const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
      if (match && process.env[match[1]] === undefined) process.env[match[1]] = match[2].replace(/^['"]|['"]$/g, '');
    }
  } catch (error) { if (error.code !== 'ENOENT') throw error; }
}
loadEnv();

const token = process.env.TELEGRAM_BOT_TOKEN;
const port = Number(process.env.PORT || 3000);
const targetChatId = process.env.TELEGRAM_CHAT_ID || '';
const dataDir = path.join(__dirname, '..', 'data');
const messagesPath = path.join(dataDir, 'messages.json');
const maxDownloadBytes = 20 * 1024 * 1024;
const mimeByExtension = {
  jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif', webp: 'image/webp', heic: 'image/heic', svg: 'image/svg+xml',
  mp4: 'video/mp4', m4v: 'video/mp4', mov: 'video/quicktime', webm: 'video/webm', mkv: 'video/x-matroska',
  mp3: 'audio/mpeg', m4a: 'audio/mp4', ogg: 'audio/ogg', oga: 'audio/ogg', opus: 'audio/ogg', wav: 'audio/wav', flac: 'audio/flac',
  pdf: 'application/pdf', zip: 'application/zip', rar: 'application/vnd.rar', '7z': 'application/x-7z-compressed',
};
const extensionOf = name => (String(name || '').split('.').pop() || '').toLowerCase();
const kindForMime = mime => mime.startsWith('image/') ? 'photo' : mime.startsWith('video/') ? 'video' : mime.startsWith('audio/') ? 'audio' : 'file';
let messages = [];
let offset = 0;
try { messages = JSON.parse(fs.readFileSync(messagesPath, 'utf8')); } catch (error) { if (error.code !== 'ENOENT') console.error('Could not load saved message history:', error.message); }
let bot = null;
let groupHealth = null;
let polling = false;
let lastError = null;
const profilePhotoCache = new Map();

async function telegram(method, params = {}) {
  const response = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(params),
    signal: AbortSignal.timeout(method === 'getUpdates' ? 30000 : 15000),
  });
  const data = await response.json();
  if (!response.ok || !data.ok) throw new Error(data.description || `Telegram API returned ${response.status}`);
  return data.result;
}

function mediaOf(message) {
  const make = (kind, file, name, mime) => {
    const type = mime || file.mime_type || mimeByExtension[extensionOf(name || file.file_name)] || '';
    return {
      kind: kindForMime(type) === 'file' ? kind : kindForMime(type), fileId: file.file_id,
      name: name || file.file_name || 'Attachment', size: file.file_size || 0, mime: type,
      tooLarge: (file.file_size || 0) > maxDownloadBytes,
    };
  };
  if (message.photo?.length) { const photo = message.photo.at(-1); return make('photo', photo, 'Photo', 'image/jpeg'); }
  if (message.video) return make('video', message.video, message.video.file_name || 'Video');
  if (message.animation) return make('video', message.animation, message.animation.file_name || 'Animation');
  if (message.video_note) return make('video', message.video_note, 'Video message', 'video/mp4');
  if (message.sticker) {
    const sticker = message.sticker;
    return make(sticker.is_video || sticker.is_animated ? 'video' : 'photo', sticker, 'Sticker', sticker.is_animated || sticker.is_video ? 'video/webm' : 'image/webp');
  }
  if (message.audio) return make('audio', message.audio, message.audio.file_name || message.audio.title || 'Audio');
  if (message.voice) return make('audio', message.voice, 'Voice message', message.voice.mime_type || 'audio/ogg');
  if (message.document) return make('file', message.document, message.document.file_name || 'Document');
  return null;
}

function addMessage(message) {
  const media = mediaOf(message);
  const kind = ['contact', 'dice', 'game', 'poll', 'venue', 'location', 'story', 'checklist', 'paid_media', 'users_shared', 'chat_shared', 'web_app_data'].find(key => message[key]);
  const body = message.text || message.caption || (media ? media.name : kind === 'contact' ? `Contact: ${message.contact.first_name || ''} ${message.contact.last_name || ''} ${message.contact.phone_number || ''}`.trim()
    : kind === 'location' ? `Location: ${message.location.latitude}, ${message.location.longitude}`
    : kind === 'venue' ? `Place: ${message.venue.title} — ${message.venue.address}`
    : kind === 'dice' ? `Dice: ${message.dice.emoji} ${message.dice.value}`
    : kind === 'poll' ? `Poll: ${message.poll.question}`
    : kind ? `${kind.replaceAll('_', ' ')} message`
    : `Telegram message (${Object.keys(message).filter(k => !['message_id','date','chat','from','message_thread_id','entities','link_preview_options'].includes(k)).join(', ') || 'other content'})`);
  const nameParts = [message.from?.first_name, message.from?.last_name].filter(Boolean);
  const sender = nameParts.join(nameParts.length > 1 ? ' - ' : '') || message.from?.username || message.sender_chat?.title || 'Unknown sender';
  messages.unshift({
    id: `${message.chat.id}-${message.message_id}`, date: message.date * 1000,
    chatId: String(message.chat.id), chat: message.chat.title || [message.chat.first_name, message.chat.last_name].filter(Boolean).join(' ') || message.chat.username || 'Private chat',
    type: message.chat.type, sender,
    senderId: message.from?.id ? String(message.from.id) : '', username: message.from?.username || message.sender_chat?.username || '', text: body, messageId: message.message_id, media,
  });
  const seen = new Set(); messages = messages.filter(m => !seen.has(m.id) && seen.add(m.id));
  if (messages.length > 5000) messages.length = 5000;
}

function saveMessages() {
  fs.mkdirSync(dataDir, { recursive: true });
  const temp = `${messagesPath}.tmp`;
  fs.writeFileSync(temp, JSON.stringify(messages)); fs.renameSync(temp, messagesPath);
}

async function poll() {
  if (polling || !token) return;
  polling = true;
  try {
    const updates = await telegram('getUpdates', { offset, timeout: 20, allowed_updates: ['message', 'edited_message', 'channel_post', 'edited_channel_post'] });
    for (const update of updates) {
      offset = update.update_id + 1;
      const message = update.message || update.edited_message || update.channel_post || update.edited_channel_post;
      if (!message) continue;
      try { addMessage(message); }
      catch (error) { console.error(`Could not store message ${message.message_id}:`, error.message); }
    }
    if (updates.length) saveMessages();
    lastError = null;
  } catch (error) {
    lastError = error.message;
    await new Promise(resolve => setTimeout(resolve, 4000));
  } finally { polling = false; }
  setImmediate(poll);
}

async function diagnoseGroup() {
  if (!token) return;
  try { bot = await telegram('getMe'); }
  catch (error) { lastError = error.message; }
  if (!targetChatId || !bot) return;
  try {
    const [chat, member, webhook] = await Promise.all([
      telegram('getChat', { chat_id: targetChatId }),
      telegram('getChatMember', { chat_id: targetChatId, user_id: bot.id }),
      telegram('getWebhookInfo'),
    ]);
    const isAdmin = ['administrator', 'creator'].includes(member.status);
    groupHealth = {
      accessible: true, title: chat.title || 'Telegram group', memberStatus: member.status, isAdmin,
      canReadAllGroupMessages: Boolean(bot.can_read_all_group_messages),
      privacyMayBlock: !isAdmin && !bot.can_read_all_group_messages,
      webhookActive: Boolean(webhook.url),
    };
  } catch (error) {
    groupHealth = { accessible: false, error: error.message };
  }
}

const html = fs.readFileSync(path.join(__dirname, '..', 'views', 'index.html'));
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  if (url.pathname === '/api/status') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ configured: Boolean(token), connected: Boolean(bot) && !lastError, bot, lastError, groupHealth, count: messages.length })); return;
  }
  if (url.pathname === '/api/messages') {
    const q = (url.searchParams.get('q') || '').toLowerCase();
    const activeChat = url.searchParams.has('chat') ? (url.searchParams.get('chat') || '') : targetChatId;
    const filtered = messages.filter(m => (!activeChat || m.chatId === activeChat) && (!q || `${m.text} ${m.sender} ${m.chat} ${m.username}`.toLowerCase().includes(q)));
    res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify(filtered)); return;
  }
  if (url.pathname === '/api/profiles') {
    const chat = url.searchParams.has('chat') ? (url.searchParams.get('chat') || '') : targetChatId;
    const userIds = [...new Set(messages.filter(m => (!chat || m.chatId === chat) && m.senderId).map(m => m.senderId))].slice(0, 50);
    const profiles = await Promise.all(userIds.map(async userId => {
      if (!profilePhotoCache.has(userId)) {
        const request = telegram('getUserProfilePhotos', { user_id: Number(userId), limit: 1 })
          .then(result => result.photos?.[0]?.at(-1)?.file_id || null).catch(() => null);
        profilePhotoCache.set(userId, request);
      }
      const fileId = await profilePhotoCache.get(userId);
      return [userId, { photoUrl: fileId ? `/api/profile-photo/${encodeURIComponent(userId)}` : null }];
    }));
    res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify(Object.fromEntries(profiles))); return;
  }
  if (url.pathname.startsWith('/api/profile-photo/')) {
    const userId = decodeURIComponent(url.pathname.slice('/api/profile-photo/'.length));
    const fileId = await profilePhotoCache.get(userId);
    if (!fileId) { res.writeHead(404); res.end('Profile photo not found'); return; }
    try {
      const file = await telegram('getFile', { file_id: fileId });
      const download = await fetch(`https://api.telegram.org/file/bot${token}/${file.file_path}`, { signal: AbortSignal.timeout(60000) });
      if (!download.ok) throw new Error(`Telegram profile photo returned ${download.status}`);
      res.writeHead(200, { 'content-type': download.headers.get('content-type') || 'image/jpeg', 'cache-control': 'private, max-age=3600' });
      const { Readable } = require('node:stream'); Readable.fromWeb(download.body).pipe(res);
    } catch { res.writeHead(502); res.end('Could not load Telegram profile photo'); }
    return;
  }
  if (url.pathname.startsWith('/api/media/')) {
    const fileId = decodeURIComponent(url.pathname.slice('/api/media/'.length));
    const entry = messages.find(m => m.media?.fileId === fileId);
    if (!entry) { res.writeHead(404); res.end('Media not found'); return; }
    try {
      const file = await telegram('getFile', { file_id: fileId });
      const range = req.headers.range;
      const download = await fetch(`https://api.telegram.org/file/bot${token}/${file.file_path}`, {
        headers: range ? { range } : undefined, signal: AbortSignal.timeout(300000),
      });
      if (!download.ok) throw new Error(`Telegram file download returned ${download.status}`);
      const reported = (download.headers.get('content-type') || '').split(';')[0].trim();
      const type = reported && reported !== 'application/octet-stream' ? reported
        : mimeByExtension[extensionOf(file.file_path || entry.media.name)] || entry.media.mime || 'application/octet-stream';
      const name = String(entry.media.name || file.file_path || 'file').replace(/["\\\r\n]/g, '_');
      const canPreview = /^(image\/(jpeg|png|gif|webp|avif)|video\/|audio\/)/i.test(type) || type === 'application/pdf';
      const asAttachment = url.searchParams.has('download') || !canPreview;
      res.writeHead(download.status === 206 ? 206 : 200, {
        'content-type': canPreview ? type : 'application/octet-stream', 'cache-control': 'private, max-age=3600',
        'content-disposition': `${asAttachment ? 'attachment' : 'inline'}; filename*=UTF-8''${encodeURIComponent(name)}`,
        ...(download.headers.get('content-length') ? { 'content-length': download.headers.get('content-length') } : {}),
        ...(download.headers.get('content-range') ? { 'content-range': download.headers.get('content-range') } : {}),
        'accept-ranges': 'bytes',
      });
      if (!download.body) { res.end(); return; }
      const { Readable } = require('node:stream'); Readable.fromWeb(download.body).pipe(res);
    } catch (error) {
      const tooBig = /too big/i.test(error.message);
      res.writeHead(tooBig ? 413 : 502, { 'content-type': 'text/plain; charset=utf-8' });
      res.end(tooBig ? 'Telegram only allows bots to download files up to 20 MB. Open the message in Telegram to view this file.' : 'Could not load Telegram media');
    }
    return;
  }
  if (url.pathname === '/api/chats') {
    const chats = [...new Map(messages.map(m => [m.chatId, { id: m.chatId, title: m.chat, type: m.type }])).values()];
    if (targetChatId && !chats.some(c => c.id === targetChatId)) chats.unshift({ id: targetChatId, title: groupHealth?.title || 'Selected Telegram group', type: 'supergroup' });
    res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify(chats)); return;
  }
  if (url.pathname === '/' || url.pathname === '/index.html') {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' }); res.end(html); return;
  }
  res.writeHead(404); res.end('Not found');
});

server.listen(port, '127.0.0.1', async () => {
  console.log(`Telegram dashboard: http://localhost:${port}`);
  if (!token) { console.log('Set TELEGRAM_BOT_TOKEN in .env to connect your bot.'); return; }
  try { bot = await telegram('getMe'); console.log(`Connected as @${bot.username || bot.first_name}`); await diagnoseGroup(); console.log(`Group access: ${JSON.stringify(groupHealth)}`); poll(); setInterval(() => diagnoseGroup().catch(() => {}), 60000).unref(); }
  catch (error) { lastError = error.message; console.error(`Telegram connection failed: ${error.message}`); poll(); }
});
