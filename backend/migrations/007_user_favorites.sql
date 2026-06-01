-- Избранные объявления пользователя.
-- Новые установки: перезапуск backend (create_all) создаст таблицу user_favorites.

CREATE TABLE IF NOT EXISTS user_favorites (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    car_id INTEGER NOT NULL REFERENCES cars(id) ON DELETE CASCADE,
    created_at TIMESTAMP WITHOUT TIME ZONE DEFAULT (NOW() AT TIME ZONE 'utc'),
    CONSTRAINT uq_user_favorite_car UNIQUE (user_id, car_id)
);

CREATE INDEX IF NOT EXISTS ix_user_favorites_user_id ON user_favorites (user_id);
CREATE INDEX IF NOT EXISTS ix_user_favorites_car_id ON user_favorites (car_id);
