-- Популярные объявления на главной (флаг на карточке авто).

ALTER TABLE cars ADD COLUMN IF NOT EXISTS is_popular BOOLEAN NOT NULL DEFAULT FALSE;
CREATE INDEX IF NOT EXISTS ix_cars_is_popular ON cars (is_popular) WHERE is_popular IS TRUE;

-- Перенос: если раньше галочки стояли на моделях — отметим по одному свежему лоту на модель.
UPDATE cars c
SET is_popular = TRUE
WHERE c.is_active IS TRUE
  AND c.is_popular IS FALSE
  AND c.id IN (
    SELECT DISTINCT ON (m.id) car.id
    FROM car_models m
    JOIN cars car ON car.model_id = m.id AND car.is_active IS TRUE
    WHERE m.is_popular IS TRUE
    ORDER BY m.id, car.updated_at DESC NULLS LAST, car.id DESC
  );
