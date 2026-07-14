-- Avito Autoload: публикации и маппинг полей.
-- Новые установки: перезапуск backend (create_all) создаст таблицы.

CREATE TABLE IF NOT EXISTS car_external_publications (
    id SERIAL PRIMARY KEY,
    car_id INTEGER NOT NULL REFERENCES cars(id) ON DELETE CASCADE,
    channel VARCHAR(32) NOT NULL DEFAULT 'avito',
    feed_ad_id VARCHAR(128) NOT NULL,
    avito_item_id BIGINT NULL,
    avito_url VARCHAR(512) NULL,
    status VARCHAR(32) NOT NULL DEFAULT 'draft',
    last_upload_id VARCHAR(64) NULL,
    last_error TEXT NULL,
    compose_snapshot_json TEXT NOT NULL DEFAULT '{}',
    published_at TIMESTAMP NULL,
    created_at TIMESTAMP NOT NULL DEFAULT (NOW() AT TIME ZONE 'utc'),
    updated_at TIMESTAMP NOT NULL DEFAULT (NOW() AT TIME ZONE 'utc'),
    CONSTRAINT uq_car_external_publication_car_channel UNIQUE (car_id, channel)
);

CREATE INDEX IF NOT EXISTS ix_car_external_publications_feed_ad_id
    ON car_external_publications (feed_ad_id);

CREATE TABLE IF NOT EXISTS avito_field_mappings (
    id SERIAL PRIMARY KEY,
    entity_type VARCHAR(32) NOT NULL,
    local_value VARCHAR(256) NOT NULL,
    avito_value VARCHAR(256) NOT NULL,
    CONSTRAINT uq_avito_field_mapping UNIQUE (entity_type, local_value)
);

CREATE INDEX IF NOT EXISTS ix_avito_field_mappings_entity_type
    ON avito_field_mappings (entity_type);
