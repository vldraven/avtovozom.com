-- Выполнить один раз на существующей БД (PostgreSQL), если таблицы ещё нет.
-- Новые установки: достаточно перезапуска backend (create_all создаст схему).

CREATE TABLE IF NOT EXISTS car_generations (
    id SERIAL PRIMARY KEY,
    model_id INTEGER NOT NULL REFERENCES car_models(id),
    name VARCHAR(160) NOT NULL,
    slug VARCHAR(192) NOT NULL,
    CONSTRAINT uq_model_generation_slug UNIQUE (model_id, slug)
);

CREATE INDEX IF NOT EXISTS ix_car_generations_model_id ON car_generations (model_id);

ALTER TABLE cars ADD COLUMN IF NOT EXISTS generation_id INTEGER REFERENCES car_generations(id);
CREATE INDEX IF NOT EXISTS ix_cars_generation_id ON cars (generation_id);
