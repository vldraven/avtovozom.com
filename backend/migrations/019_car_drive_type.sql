-- Ручной привод на объявлении (override комплектации Autohome).
ALTER TABLE cars ADD COLUMN IF NOT EXISTS drive_type VARCHAR(64);
