-- Push notification device tokens for mobile app (Expo / FCM)
CREATE TABLE IF NOT EXISTS user_push_devices (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    platform VARCHAR(16) NOT NULL DEFAULT 'android',
    push_token TEXT NOT NULL,
    device_name VARCHAR(128) NOT NULL DEFAULT '',
    updated_at TIMESTAMP NOT NULL DEFAULT (NOW() AT TIME ZONE 'utc'),
    UNIQUE (user_id, push_token)
);

CREATE INDEX IF NOT EXISTS ix_user_push_devices_user_id ON user_push_devices(user_id);
