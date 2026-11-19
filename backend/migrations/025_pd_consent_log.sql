-- Журнал отдельных согласий и запросов на отзыв.
-- Новая таблица также создаётся через Base.metadata.create_all при старте API.
CREATE TABLE IF NOT EXISTS pd_consent_log (
    id SERIAL PRIMARY KEY,
    created_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT NOW(),
    form_code VARCHAR(32) NOT NULL,
    document_version VARCHAR(32) NOT NULL,
    accepted BOOLEAN NOT NULL DEFAULT TRUE,
    subject_email VARCHAR(255),
    subject_phone VARCHAR(32),
    user_id INTEGER REFERENCES users(id),
    guest_token VARCHAR(64),
    ip VARCHAR(64),
    user_agent VARCHAR(256),
    note TEXT
);

CREATE INDEX IF NOT EXISTS ix_pd_consent_log_form_code ON pd_consent_log (form_code);
CREATE INDEX IF NOT EXISTS ix_pd_consent_log_user_id ON pd_consent_log (user_id);
CREATE INDEX IF NOT EXISTS ix_pd_consent_log_guest_token ON pd_consent_log (guest_token);
