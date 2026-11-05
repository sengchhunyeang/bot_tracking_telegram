CREATE TABLE IF NOT EXISTS telegram_messages (
  id TEXT PRIMARY KEY,
  update_id BIGINT NOT NULL,
  chat_id TEXT NOT NULL,
  message_date BIGINT NOT NULL,
  record JSONB NOT NULL,
  inserted_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS telegram_messages_chat_update_idx
  ON telegram_messages (chat_id, update_id DESC);

CREATE INDEX IF NOT EXISTS telegram_messages_media_file_idx
  ON telegram_messages ((record->'media'->>'fileId'));
