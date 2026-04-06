import os
from urllib.parse import quote_plus

from sqlalchemy import create_engine
from sqlalchemy.orm import declarative_base, sessionmaker


def _database_url() -> str:
    """
    В Docker (compose) задаётся POSTGRES_HOST — URL собираем с quote_plus, чтобы пароль с @ : / # и т.д.
    не ломал строку подключения. Иначе — DATABASE_URL или дефолт для локального запуска.
    """
    if os.getenv("POSTGRES_HOST"):
        user = os.getenv("POSTGRES_USER", "avtovozom")
        password = os.getenv("POSTGRES_PASSWORD", "")
        host = os.getenv("POSTGRES_HOST", "postgres")
        port = os.getenv("POSTGRES_PORT", "5432")
        database = os.getenv("POSTGRES_DB", "avtovozom")
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
