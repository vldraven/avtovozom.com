-- Поля для сортировки чатов, непрочитанных и «прочитано до».
ALTER TABLE chats ADD COLUMN IF NOT EXISTS user_last_read_message_id INTEGER;
ALTER TABLE chats ADD COLUMN IF NOT EXISTS dealer_last_read_message_id INTEGER;
ALTER TABLE chats ADD COLUMN IF NOT EXISTS last_message_at TIMESTAMP;

UPDATE chats c
SET last_message_at = sub.mx
FROM (
  SELECT chat_id, MAX(created_at) AS mx
  FROM chat_messages
  GROUP BY chat_id
) sub
WHERE c.id = sub.chat_id AND (c.last_message_at IS NULL OR c.last_message_at < sub.mx);
