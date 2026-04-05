-- Имя в чатах, компания дилера, вложения в сообщениях
ALTER TABLE users ADD COLUMN IF NOT EXISTS display_name VARCHAR(128) NOT NULL DEFAULT '';
ALTER TABLE users ADD COLUMN IF NOT EXISTS company_name VARCHAR(255);

ALTER TABLE chat_messages ADD COLUMN IF NOT EXISTS attachment_url VARCHAR(512);
ALTER TABLE chat_messages ADD COLUMN IF NOT EXISTS attachment_original_name VARCHAR(255);
