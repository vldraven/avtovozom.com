-- Диапазоны лет для сопоставления поколения с Car.year (скрипт справочника).

ALTER TABLE car_generations ADD COLUMN IF NOT EXISTS year_from INTEGER;
ALTER TABLE car_generations ADD COLUMN IF NOT EXISTS year_to INTEGER;
