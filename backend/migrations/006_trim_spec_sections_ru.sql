-- Каноническое хранение комплектации на русском; сырой импорт — опционально.

ALTER TABLE car_trims ADD COLUMN IF NOT EXISTS spec_sections TEXT;
ALTER TABLE car_trims ADD COLUMN IF NOT EXISTS source_spec_json TEXT;

-- Сырой JSON импорта (Autohome и др.) — необязателен.
UPDATE car_trims
SET source_spec_json = spec_json
WHERE source_spec_json IS NULL AND spec_json IS NOT NULL AND spec_json <> '[]';

-- Перенос готового русского кэша в spec_sections (legacy: массив секций).
UPDATE car_trims
SET spec_sections = spec_json_ru
WHERE (spec_sections IS NULL OR spec_sections = '' OR spec_sections = '[]')
  AND spec_json_ru IS NOT NULL AND spec_json_ru <> '[]';

-- Ручные / другие источники: autohome_spec_id необязателен.
ALTER TABLE car_trims ALTER COLUMN autohome_spec_id DROP NOT NULL;
