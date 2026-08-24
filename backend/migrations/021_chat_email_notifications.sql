-- Delayed email notifications for unread chat messages (client recipients).
CREATE TABLE IF NOT EXISTS chat_email_notifications (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id),
    chat_id INTEGER NOT NULL REFERENCES chats(id),
    status VARCHAR(16) NOT NULL DEFAULT 'pending',
    target_message_id INTEGER NOT NULL,
    preview VARCHAR(512) NOT NULL DEFAULT '',
    send_after TIMESTAMP WITHOUT TIME ZONE NOT NULL,
    sent_at TIMESTAMP WITHOUT TIME ZONE NULL,
    created_at TIMESTAMP WITHOUT TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITHOUT TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS ix_chat_email_notifications_user_id
    ON chat_email_notifications (user_id);
CREATE INDEX IF NOT EXISTS ix_chat_email_notifications_chat_id
    ON chat_email_notifications (chat_id);
CREATE INDEX IF NOT EXISTS ix_chat_email_notifications_status
    ON chat_email_notifications (status);
CREATE INDEX IF NOT EXISTS ix_chat_email_notifications_send_after
    ON chat_email_notifications (send_after);
CREATE INDEX IF NOT EXISTS ix_chat_email_notifications_pending_due
    ON chat_email_notifications (status, send_after);
