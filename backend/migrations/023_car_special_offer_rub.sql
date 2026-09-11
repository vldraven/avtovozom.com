-- Ручная спецпредложение «под ключ» (₽). NULL — без акции.
ALTER TABLE cars ADD COLUMN IF NOT EXISTS special_offer_rub DOUBLE PRECISION;

CREATE INDEX IF NOT EXISTS ix_cars_active_special_offer_rub
  ON cars (special_offer_rub ASC NULLS LAST, id DESC)
  WHERE is_active IS TRUE AND special_offer_rub IS NOT NULL;
