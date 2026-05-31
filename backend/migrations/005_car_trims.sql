-- Справочник комплектаций (Autohome spec) + ссылка с объявления.

CREATE TABLE IF NOT EXISTS car_trims (
    id SERIAL PRIMARY KEY,
    model_id INTEGER NOT NULL REFERENCES car_models(id) ON DELETE CASCADE,
    generation_id INTEGER REFERENCES car_generations(id) ON DELETE SET NULL,
    autohome_spec_id INTEGER NOT NULL,
    name_zh VARCHAR(256) NOT NULL DEFAULT '',
    name_normalized VARCHAR(256) NOT NULL DEFAULT '',
    name_ru VARCHAR(256) NOT NULL DEFAULT '',
    spec_fingerprint VARCHAR(64) NOT NULL DEFAULT '',
    spec_json TEXT NOT NULL DEFAULT '[]',
    spec_json_ru TEXT NOT NULL DEFAULT '[]',
    source VARCHAR(32) NOT NULL DEFAULT 'autohome',
    created_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT (NOW() AT TIME ZONE 'utc'),
    updated_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT (NOW() AT TIME ZONE 'utc'),
    CONSTRAINT uq_car_trims_autohome_spec UNIQUE (autohome_spec_id),
    CONSTRAINT uq_car_trims_model_gen_fp UNIQUE (model_id, generation_id, spec_fingerprint)
);

CREATE INDEX IF NOT EXISTS ix_car_trims_model_id ON car_trims (model_id);
CREATE INDEX IF NOT EXISTS ix_car_trims_generation_id ON car_trims (generation_id);
CREATE INDEX IF NOT EXISTS ix_car_trims_name_normalized ON car_trims (model_id, generation_id, name_normalized);

ALTER TABLE cars ADD COLUMN IF NOT EXISTS trim_id INTEGER REFERENCES car_trims(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS ix_cars_trim_id ON cars (trim_id);
