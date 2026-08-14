-- Мощность со витрины / carinfo JSON (без открытия карточки).
ALTER TABLE import_candidates ADD COLUMN IF NOT EXISTS horsepower INTEGER NULL;
