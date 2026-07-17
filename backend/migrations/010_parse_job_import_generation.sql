-- Optional generation for single-listing import jobs
ALTER TABLE parse_jobs
  ADD COLUMN IF NOT EXISTS import_generation_id INTEGER REFERENCES car_generations(id);
