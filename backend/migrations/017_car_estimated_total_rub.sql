-- Денормализованный ориентир цены «под ключ» для SQL-фильтра rub_from/rub_to.
-- Новые установки: также создаются при рестарте backend (startup).

ALTER TABLE cars ADD COLUMN IF NOT EXISTS estimated_total_rub DOUBLE PRECISION;
ALTER TABLE cars ADD COLUMN IF NOT EXISTS estimate_cbr_date VARCHAR(32);

CREATE INDEX IF NOT EXISTS ix_cars_active_estimated_total_rub
  ON cars (estimated_total_rub ASC NULLS LAST, id DESC)
  WHERE is_active IS TRUE AND estimated_total_rub IS NOT NULL;
