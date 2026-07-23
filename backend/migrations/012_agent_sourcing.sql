-- Sourcing agent: profiles, candidates staging, long-term memory, approval sessions

CREATE TABLE IF NOT EXISTS search_profiles (
    id SERIAL PRIMARY KEY,
    name VARCHAR(128) NOT NULL DEFAULT '',
    enabled BOOLEAN NOT NULL DEFAULT TRUE,
    criteria JSONB NOT NULL DEFAULT '{}'::jsonb,
    brief TEXT NOT NULL DEFAULT '',
    max_select INTEGER NOT NULL DEFAULT 20,
    created_at TIMESTAMP WITHOUT TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITHOUT TIME ZONE DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS import_candidates (
    id SERIAL PRIMARY KEY,
    profile_id INTEGER NOT NULL REFERENCES search_profiles(id) ON DELETE CASCADE,
    url VARCHAR(2048) NOT NULL DEFAULT '',
    listing_id VARCHAR(128) NOT NULL DEFAULT '',
    marketplace VARCHAR(32) NOT NULL DEFAULT 'che168',
    brand_id INTEGER NULL,
    brand_name VARCHAR(128) NOT NULL DEFAULT '',
    model_id INTEGER NULL,
    model_name VARCHAR(128) NOT NULL DEFAULT '',
    generation_id INTEGER NULL,
    generation_name VARCHAR(128) NOT NULL DEFAULT '',
    year INTEGER NULL,
    price_cny DOUBLE PRECISION NULL,
    mileage_km INTEGER NULL,
    title VARCHAR(512) NOT NULL DEFAULT '',
    score DOUBLE PRECISION NULL,
    reasons JSONB NOT NULL DEFAULT '[]'::jsonb,
    status VARCHAR(32) NOT NULL DEFAULT 'new',
    -- new | filtered | scored | selected | rejected | imported
    filter_reasons JSONB NOT NULL DEFAULT '[]'::jsonb,
    selected_at TIMESTAMP WITHOUT TIME ZONE NULL,
    created_at TIMESTAMP WITHOUT TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITHOUT TIME ZONE DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_import_candidates_profile_listing
    ON import_candidates (profile_id, listing_id)
    WHERE listing_id <> '';

CREATE INDEX IF NOT EXISTS ix_import_candidates_profile_id ON import_candidates (profile_id);
CREATE INDEX IF NOT EXISTS ix_import_candidates_status ON import_candidates (status);
CREATE INDEX IF NOT EXISTS ix_import_candidates_selected_at ON import_candidates (selected_at);

CREATE TABLE IF NOT EXISTS agent_memories (
    id SERIAL PRIMARY KEY,
    agent_key VARCHAR(64) NOT NULL DEFAULT 'sourcing',
    kind VARCHAR(32) NOT NULL DEFAULT 'lesson',
    -- lesson | preference | ban | market_note
    content TEXT NOT NULL DEFAULT '',
    source VARCHAR(32) NOT NULL DEFAULT 'manual',
    -- tg_revise | tg_cancel | manual | run
    created_at TIMESTAMP WITHOUT TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS ix_agent_memories_agent_key ON agent_memories (agent_key);
CREATE INDEX IF NOT EXISTS ix_agent_memories_created_at ON agent_memories (created_at DESC);

CREATE TABLE IF NOT EXISTS sourcing_approval_sessions (
    id SERIAL PRIMARY KEY,
    profile_id INTEGER NOT NULL REFERENCES search_profiles(id) ON DELETE CASCADE,
    status VARCHAR(32) NOT NULL DEFAULT 'pending',
    -- pending | approved | cancelled | expired
    candidate_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
    telegram_chat_id VARCHAR(64) NOT NULL DEFAULT '',
    telegram_message_id VARCHAR(64) NOT NULL DEFAULT '',
    summary TEXT NOT NULL DEFAULT '',
    created_at TIMESTAMP WITHOUT TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITHOUT TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS ix_sourcing_approval_sessions_status
    ON sourcing_approval_sessions (status);

-- Seed default daily profile (idempotent)
INSERT INTO search_profiles (name, enabled, criteria, brief, max_select)
SELECT
    'Ежедневный отбор',
    TRUE,
    '{"year_min": 2019, "mileage_max": 100000, "marketplaces": ["che168"]}'::jsonb,
    'Ищи наиболее востребованные и ликвидные варианты под заказ из Китая на рынок РФ. Учитывай спрос, ликвидность перепродажи, адекватность цены. Не выдумывай URL.',
    20
WHERE NOT EXISTS (
    SELECT 1 FROM search_profiles WHERE name = 'Ежедневный отбор'
);
