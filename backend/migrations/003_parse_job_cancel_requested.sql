-- Выполнить один раз на существующей БД (PostgreSQL).
-- Флаг запроса остановки фоновой задачи парсера.

ALTER TABLE parse_jobs ADD COLUMN IF NOT EXISTS cancel_requested BOOLEAN DEFAULT FALSE;
