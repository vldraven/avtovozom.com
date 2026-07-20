-- Общий серверный план импорта объявлений (staff).
CREATE TABLE IF NOT EXISTS import_plans (
    id SERIAL PRIMARY KEY,
    status VARCHAR(32) NOT NULL DEFAULT 'idle',
    stop_requested BOOLEAN NOT NULL DEFAULT FALSE,
    banner VARCHAR(512) NOT NULL DEFAULT '',
    error VARCHAR(512) NOT NULL DEFAULT '',
    updated_at TIMESTAMP WITHOUT TIME ZONE DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS import_plan_items (
    id SERIAL PRIMARY KEY,
    plan_id INTEGER NOT NULL REFERENCES import_plans(id) ON DELETE CASCADE,
    client_key VARCHAR(64) NOT NULL DEFAULT '',
    sort_order INTEGER NOT NULL DEFAULT 0,
    marketplace VARCHAR(32) NOT NULL DEFAULT 'che168',
    brand_id INTEGER NULL,
    brand_name VARCHAR(128) NOT NULL DEFAULT '',
    model_id INTEGER NULL,
    model_name VARCHAR(128) NOT NULL DEFAULT '',
    generation_id INTEGER NULL,
    generation_name VARCHAR(128) NOT NULL DEFAULT '',
    url VARCHAR(2048) NOT NULL DEFAULT '',
    status VARCHAR(32) NOT NULL DEFAULT 'pending',
    attempts INTEGER NOT NULL DEFAULT 0,
    message VARCHAR(512) NOT NULL DEFAULT '',
    parse_job_id INTEGER NULL REFERENCES parse_jobs(id)
);

CREATE INDEX IF NOT EXISTS ix_import_plan_items_plan_id ON import_plan_items (plan_id);
CREATE INDEX IF NOT EXISTS ix_import_plans_status ON import_plans (status);

INSERT INTO import_plans (id, status, stop_requested, banner, error)
SELECT 1, 'idle', FALSE, '', ''
WHERE NOT EXISTS (SELECT 1 FROM import_plans WHERE id = 1);
