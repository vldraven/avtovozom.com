-- Один чат на пару (заявка, дилер), вместо одного чата на всю заявку.
-- Выполните на существующей БД PostgreSQL перед деплоем (один раз).

ALTER TABLE chats DROP CONSTRAINT IF EXISTS chats_request_id_key;

CREATE UNIQUE INDEX IF NOT EXISTS uq_chat_request_dealer ON chats (request_id, dealer_user_id);
