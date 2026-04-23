-- Выполнить один раз на существующей БД (PostgreSQL).
-- Логотип марки и порядок в будущем ряду «быстрых фильтров» на главной.

ALTER TABLE car_brands ADD COLUMN IF NOT EXISTS logo_storage_url VARCHAR(512);
ALTER TABLE car_brands ADD COLUMN IF NOT EXISTS quick_filter_rank INTEGER;
