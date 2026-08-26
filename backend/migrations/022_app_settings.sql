-- App key/value settings (e.g. rotating VK user token for wall photos).
CREATE TABLE IF NOT EXISTS app_settings (
    key VARCHAR(64) PRIMARY KEY,
    value TEXT NOT NULL DEFAULT '',
    updated_at TIMESTAMP WITHOUT TIME ZONE DEFAULT NOW()
);
