const { Pool } = require('pg');
const { attachDatabasePool } = require('@vercel/functions');

let pool;

function database() {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is not configured.');
  if (!pool) {
    pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      max: 1,
      idleTimeoutMillis: 10000,
      connectionTimeoutMillis: 10000,
    });
    if (process.env.VERCEL) attachDatabasePool(pool);
  }
  return pool;
}

async function saveMessage(record, client = database()) {
  await client.query(
    `INSERT INTO telegram_messages (id, update_id, chat_id, message_date, record)
     VALUES ($1, $2, $3, $4, $5::jsonb)
     ON CONFLICT (id) DO UPDATE SET
       update_id = EXCLUDED.update_id,
       chat_id = EXCLUDED.chat_id,
       message_date = EXCLUDED.message_date,
       record = EXCLUDED.record`,
    [record.id, record.updateId || record.messageId, record.chatId, record.date, JSON.stringify(record)],
  );
}

async function listMessages(chatId = '') {
  const result = await database().query(
    `SELECT record FROM telegram_messages
     WHERE ($1 = '' OR chat_id = $1)
     ORDER BY update_id DESC
     LIMIT 5000`,
    [String(chatId || '')],
  );
  return result.rows.map(row => row.record);
}

async function countMessages(chatId = '') {
  const result = await database().query(
    `SELECT count(*)::int AS count FROM telegram_messages WHERE ($1 = '' OR chat_id = $1)`,
    [String(chatId || '')],
  );
  return result.rows[0].count;
}

async function findMessageByMedia(fileId) {
  const result = await database().query(
    `SELECT record FROM telegram_messages WHERE record->'media'->>'fileId' = $1 LIMIT 1`,
    [fileId],
  );
  return result.rows[0]?.record || null;
}

async function listSenderIds(chatId = '') {
  const result = await database().query(
    `SELECT DISTINCT record->>'senderId' AS sender_id
     FROM telegram_messages
     WHERE ($1 = '' OR chat_id = $1) AND COALESCE(record->>'senderId', '') <> ''
     LIMIT 50`,
    [String(chatId || '')],
  );
  return result.rows.map(row => row.sender_id);
}

async function listChats() {
  const result = await database().query(
    `SELECT DISTINCT ON (chat_id) chat_id AS id, record->>'chat' AS title, record->>'type' AS type
     FROM telegram_messages ORDER BY chat_id, update_id DESC`,
  );
  return result.rows;
}

module.exports = { database, saveMessage, listMessages, countMessages, findMessageByMedia, listSenderIds, listChats };
