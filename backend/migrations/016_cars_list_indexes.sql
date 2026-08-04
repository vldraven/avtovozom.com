-- Индексы для списков каталога/главной и подгрузки фото.
-- Новые установки: также создаются при рестарте backend (startup).

-- Активные лоты, сортировка по дате (default GET /cars, главная).
CREATE INDEX IF NOT EXISTS ix_cars_active_created_at
  ON cars (created_at DESC, id DESC)
  WHERE is_active IS TRUE;

-- Фильтры brand_id / model_id на витрине каталога.
CREATE INDEX IF NOT EXISTS ix_cars_active_brand_created
  ON cars (brand_id, created_at DESC, id DESC)
  WHERE is_active IS TRUE;

CREATE INDEX IF NOT EXISTS ix_cars_active_model_created
  ON cars (model_id, created_at DESC, id DESC)
  WHERE is_active IS TRUE;

-- Популярные на главной: is_popular + дата.
CREATE INDEX IF NOT EXISTS ix_cars_active_popular_created
  ON cars (created_at DESC, id DESC)
  WHERE is_active IS TRUE AND is_popular IS TRUE;

-- FK lookup + selectinload/joinedload фото.
CREATE INDEX IF NOT EXISTS ix_car_photos_car_id_sort
  ON car_photos (car_id, sort_order, id);
