-- Guest chat: anonymous session token, nullable owners for guest threads.
ALTER TABLE chats ADD COLUMN IF NOT EXISTS guest_token VARCHAR(64) NULL;
ALTER TABLE chats ALTER COLUMN user_id DROP NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_chat_guest_token ON chats (guest_token) WHERE guest_token IS NOT NULL;
ALTER TABLE chat_messages ALTER COLUMN sender_user_id DROP NOT NULL;
