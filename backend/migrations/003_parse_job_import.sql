-- Параметры разового импорта объявления (POST /admin/parser/import-listing).
ALTER TABLE parse_jobs ADD COLUMN IF NOT EXISTS import_model_id INTEGER REFERENCES car_models(id);
ALTER TABLE parse_jobs ADD COLUMN IF NOT EXISTS import_detail_url VARCHAR(2048);
