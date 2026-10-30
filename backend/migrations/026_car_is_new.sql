-- Explicit condition; existing and imported listings remain unflagged.
ALTER TABLE cars ADD COLUMN IF NOT EXISTS is_new BOOLEAN NOT NULL DEFAULT FALSE;
CREATE INDEX IF NOT EXISTS ix_cars_active_new_created
    ON cars (created_at DESC, id DESC)
    WHERE is_active IS TRUE AND is_new IS TRUE;
