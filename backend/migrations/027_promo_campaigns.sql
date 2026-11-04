-- Promo campaigns + placements; promo_code on calculation requests.

CREATE TABLE IF NOT EXISTS promo_campaigns (
    id SERIAL PRIMARY KEY,
    slug VARCHAR(64) NOT NULL UNIQUE,
    name VARCHAR(160) NOT NULL DEFAULT '',
    is_enabled BOOLEAN NOT NULL DEFAULT FALSE,
    starts_at TIMESTAMP NULL,
    ends_at TIMESTAMP NULL,
    promo_code VARCHAR(64) NOT NULL DEFAULT '',
    accent_color VARCHAR(16) NOT NULL DEFAULT '#d9f43a',
    eyebrow VARCHAR(160) NOT NULL DEFAULT '',
    title_accent VARCHAR(64) NOT NULL DEFAULT '',
    title_rest VARCHAR(240) NOT NULL DEFAULT '',
    subtitle TEXT NOT NULL DEFAULT '',
    cta_label VARCHAR(120) NOT NULL DEFAULT '',
    cta_path VARCHAR(240) NOT NULL DEFAULT '/request-quote',
    hero_image_url VARCHAR(512) NOT NULL DEFAULT '',
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS ix_promo_campaigns_slug ON promo_campaigns (slug);
CREATE INDEX IF NOT EXISTS ix_promo_campaigns_enabled ON promo_campaigns (is_enabled);

CREATE TABLE IF NOT EXISTS promo_placements (
    id SERIAL PRIMARY KEY,
    campaign_id INTEGER NOT NULL REFERENCES promo_campaigns(id) ON DELETE CASCADE,
    placement VARCHAR(32) NOT NULL,
    is_enabled BOOLEAN NOT NULL DEFAULT TRUE,
    image_url VARCHAR(512) NOT NULL DEFAULT '',
    badge VARCHAR(64) NOT NULL DEFAULT '',
    title VARCHAR(240) NOT NULL DEFAULT '',
    subtitle VARCHAR(320) NOT NULL DEFAULT '',
    kicker VARCHAR(160) NOT NULL DEFAULT '',
    cta_label VARCHAR(120) NOT NULL DEFAULT '',
    updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_promo_campaign_placement UNIQUE (campaign_id, placement)
);

CREATE INDEX IF NOT EXISTS ix_promo_placements_campaign_id ON promo_placements (campaign_id);

ALTER TABLE calculation_requests
    ADD COLUMN IF NOT EXISTS promo_code VARCHAR(64) NOT NULL DEFAULT '';
