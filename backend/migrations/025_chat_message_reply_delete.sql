-- Reply-to quote + soft-delete for chat messages (staff moderation).
ALTER TABLE chat_messages
    ADD COLUMN IF NOT EXISTS reply_to_message_id INTEGER NULL;
ALTER TABLE chat_messages
    ADD COLUMN IF NOT EXISTS reply_quote_text VARCHAR(280) NULL;
ALTER TABLE chat_messages
    ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP WITHOUT TIME ZONE NULL;

CREATE INDEX IF NOT EXISTS ix_chat_messages_reply_to_message_id
    ON chat_messages (reply_to_message_id);
CREATE INDEX IF NOT EXISTS ix_chat_messages_chat_id_deleted_at
    ON chat_messages (chat_id, deleted_at);
