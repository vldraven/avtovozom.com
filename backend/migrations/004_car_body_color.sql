-- Цвет кузова: slug из справочника (см. backend/app/body_colors.py, GET /catalog/body-colors)
ALTER TABLE cars ADD COLUMN IF NOT EXISTS body_color_slug VARCHAR(32);
