-- Признак «популярное» для витрины на главной (марки и модели).

ALTER TABLE car_brands ADD COLUMN IF NOT EXISTS is_popular BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE car_models ADD COLUMN IF NOT EXISTS is_popular BOOLEAN NOT NULL DEFAULT FALSE;

-- Сид: если ещё никто не отмечен, берём топ по объявлениям (один раз при миграции).
UPDATE car_models m SET is_popular = TRUE
WHERE NOT EXISTS (SELECT 1 FROM car_models WHERE is_popular IS TRUE)
  AND m.id IN (
    SELECT c.model_id FROM cars c
    WHERE c.is_active IS TRUE AND c.model_id IS NOT NULL
    GROUP BY c.model_id
    ORDER BY COUNT(*) DESC
    LIMIT 8
  );

UPDATE car_brands b SET is_popular = TRUE
WHERE NOT EXISTS (SELECT 1 FROM car_brands WHERE is_popular IS TRUE)
  AND (
    b.quick_filter_rank IS NOT NULL
    OR b.logo_storage_url IS NOT NULL
    OR b.id IN (
      SELECT c.brand_id FROM cars c
      WHERE c.is_active IS TRUE AND c.brand_id IS NOT NULL
      GROUP BY c.brand_id
      ORDER BY COUNT(*) DESC
      LIMIT 8
    )
  );
