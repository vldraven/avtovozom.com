-- Platform chat «Чат с Avtovozom»: один чат на клиента, staff отвечает из общего inbox.
ALTER TABLE chats ADD COLUMN IF NOT EXISTS chat_type VARCHAR(16) NOT NULL DEFAULT 'dealer';
ALTER TABLE chats ALTER COLUMN request_id DROP NOT NULL;
ALTER TABLE chats ALTER COLUMN dealer_user_id DROP NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_chat_platform_user ON chats (user_id) WHERE chat_type = 'platform';
