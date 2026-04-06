import os
from urllib.parse import quote_plus

from sqlalchemy import create_engine
from sqlalchemy.orm import declarative_base, sessionmaker


def _env_part(key: str, default: str = "") -> str:
    """Убирает \\r/\\n и пробелы по краям — типичная проблема после правки .env в Windows или копипаста."""
    raw = os.getenv(key, default)
    if raw is None:
        return default
    return raw.strip().replace("\r", "").replace("\n", "")


def _database_url() -> str:
    """
    В Docker (compose) задаётся POSTGRES_HOST — URL собираем с quote_plus, чтобы пароль с @ : / # и т.д.
    не ломал строку подключения. Иначе — DATABASE_URL или дефолт для локального запуска.
    """
    if _env_part("POSTGRES_HOST"):
        user = _env_part("POSTGRES_USER", "avtovozom")
        password = _env_part("POSTGRES_PASSWORD", "")
        host = _env_part("POSTGRES_HOST", "postgres")
        port = _env_part("POSTGRES_PORT", "5432")
        database = _env_part("POSTGRES_DB", "avtovozom")
        return (
            f"postgresql+psycopg2://{quote_plus(user)}:{quote_plus(password)}"
            f"@{host}:{port}/{quote_plus(database)}"
        )
    return os.getenv(
        "DATABASE_URL",
        "postgresql+psycopg2://avtovozom:avtovozom@localhost:5432/avtovozom",
    )


DATABASE_URL = _database_url()

engine = create_engine(DATABASE_URL, pool_pre_ping=True)
SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False)
Base = declarative_base()


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
