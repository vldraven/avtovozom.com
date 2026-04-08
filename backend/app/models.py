from datetime import datetime

from sqlalchemy import (
    Boolean,
    DateTime,
    Float,
    ForeignKey,
    Integer,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .db import Base


class Role(Base):
    __tablename__ = "roles"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    code: Mapped[str] = mapped_column(String(32), unique=True, nullable=False)
    name: Mapped[str] = mapped_column(String(64), nullable=False)


class User(Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    email: Mapped[str] = mapped_column(String(255), unique=True, nullable=False)
    phone: Mapped[str | None] = mapped_column(String(32), nullable=True)
    password_hash: Mapped[str] = mapped_column(String(255), nullable=False)
    full_name: Mapped[str] = mapped_column(String(128), default="")
    display_name: Mapped[str] = mapped_column(String(128), default="")
    company_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    role_id: Mapped[int] = mapped_column(ForeignKey("roles.id"), nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    email_verified: Mapped[bool] = mapped_column(Boolean, default=True)
    must_change_password: Mapped[bool] = mapped_column(Boolean, default=False)
    verification_code: Mapped[str | None] = mapped_column(String(16), nullable=True)
    verification_expires_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

    role = relationship("Role")


class CarBrand(Base):
    __tablename__ = "car_brands"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    name: Mapped[str] = mapped_column(String(128), unique=True, nullable=False)


class CarModel(Base):
    __tablename__ = "car_models"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    brand_id: Mapped[int] = mapped_column(ForeignKey("car_brands.id"), nullable=False)
    name: Mapped[str] = mapped_column(String(128), nullable=False)
    che168_url: Mapped[str | None] = mapped_column(String(512), nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)

    brand = relationship("CarBrand")
    generations = relationship("CarGeneration", back_populates="model")
    __table_args__ = (UniqueConstraint("brand_id", "name", name="uq_brand_model"),)


class CarGeneration(Base):
    """Поколение внутри модели (кузов / рестайлинг)."""

    __tablename__ = "car_generations"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    model_id: Mapped[int] = mapped_column(ForeignKey("car_models.id"), nullable=False)
    name: Mapped[str] = mapped_column(String(160), nullable=False)
    slug: Mapped[str] = mapped_column(String(192), nullable=False)
    year_from: Mapped[int | None] = mapped_column(Integer, nullable=True)
    year_to: Mapped[int | None] = mapped_column(Integer, nullable=True)
    """Диапазон лет выпуска для автопривязки объявлений (включительно); null — без ограничения с этой стороны."""

    model = relationship("CarModel", back_populates="generations")
    __table_args__ = (UniqueConstraint("model_id", "slug", name="uq_model_generation_slug"),)


class ModelWhitelist(Base):
    __tablename__ = "model_whitelist"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    model_id: Mapped[int] = mapped_column(
        ForeignKey("car_models.id"), nullable=False, unique=True
    )
    enabled: Mapped[bool] = mapped_column(Boolean, default=True)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

    model = relationship("CarModel")


class Car(Base):
    __tablename__ = "cars"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    source: Mapped[str] = mapped_column(String(32), default="che168")
    source_listing_id: Mapped[str] = mapped_column(String(128), unique=True, nullable=False)
    brand_id: Mapped[int] = mapped_column(ForeignKey("car_brands.id"), nullable=False)
    model_id: Mapped[int] = mapped_column(ForeignKey("car_models.id"), nullable=False)
    generation_id: Mapped[int | None] = mapped_column(
        ForeignKey("car_generations.id"), nullable=True, index=True
    )
    title: Mapped[str] = mapped_column(String(256), nullable=False)
    description: Mapped[str] = mapped_column(Text, default="")
    year: Mapped[int] = mapped_column(Integer)
    mileage_km: Mapped[int | None] = mapped_column(Integer, nullable=True)
    engine_volume_cc: Mapped[int] = mapped_column(Integer)
    horsepower: Mapped[int] = mapped_column(Integer)
    fuel_type: Mapped[str | None] = mapped_column(String(64), nullable=True)
    transmission: Mapped[str | None] = mapped_column(String(64), nullable=True)
    location_city: Mapped[str | None] = mapped_column(String(128), nullable=True)
    price_cny: Mapped[float] = mapped_column(Float)
    registration_date: Mapped[str | None] = mapped_column(String(32), nullable=True)
    production_date: Mapped[str | None] = mapped_column(String(32), nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_by_user_id: Mapped[int | None] = mapped_column(
        ForeignKey("users.id"), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, default=datetime.utcnow, onupdate=datetime.utcnow
    )

    brand = relationship("CarBrand")
    model = relationship("CarModel")
    generation = relationship("CarGeneration")
    photos = relationship("CarPhoto", back_populates="car", cascade="all,delete-orphan")


class CarPhoto(Base):
    __tablename__ = "car_photos"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    car_id: Mapped[int] = mapped_column(ForeignKey("cars.id"), nullable=False)
    storage_url: Mapped[str] = mapped_column(String(512), nullable=False)
    sort_order: Mapped[int] = mapped_column(Integer, default=0)

    car = relationship("Car", back_populates="photos")


class ParseJob(Base):
    __tablename__ = "parse_jobs"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    type: Mapped[str] = mapped_column(String(32), default="daily")
    status: Mapped[str] = mapped_column(String(32), default="queued")
    started_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    finished_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    total_processed: Mapped[int] = mapped_column(Integer, default=0)
    total_created: Mapped[int] = mapped_column(Integer, default=0)
    total_updated: Mapped[int] = mapped_column(Integer, default=0)
    total_errors: Mapped[int] = mapped_column(Integer, default=0)
    message: Mapped[str] = mapped_column(String(512), default="")
    import_model_id: Mapped[int | None] = mapped_column(
        Integer, ForeignKey("car_models.id"), nullable=True
    )
    import_detail_url: Mapped[str | None] = mapped_column(String(2048), nullable=True)


class CalculationRequest(Base):
    __tablename__ = "calculation_requests"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    user_name: Mapped[str] = mapped_column(String(128), nullable=False)
    user_contact: Mapped[str] = mapped_column(String(128), nullable=False)
    user_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    car_id: Mapped[int] = mapped_column(ForeignKey("cars.id"), nullable=False)
    comment: Mapped[str] = mapped_column(Text, default="")
    status: Mapped[str] = mapped_column(String(32), default="open")
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    offers_seen_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    """Когда клиент последний раз отметил просмотр расчётов дилеров по этой заявке."""


class DealerOffer(Base):
    __tablename__ = "dealer_offers"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    request_id: Mapped[int] = mapped_column(
        ForeignKey("calculation_requests.id"), nullable=False
    )
    dealer_user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), nullable=False)
    total_price: Mapped[float] = mapped_column(Float, nullable=False)
    currency: Mapped[str] = mapped_column(String(16), default="USD")
    eta_days: Mapped[int] = mapped_column(Integer, default=30)
    terms_text: Mapped[str] = mapped_column(Text, default="")
    status: Mapped[str] = mapped_column(String(32), default="sent")
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)


class Chat(Base):
    """Один чат на пару (заявка, дилер), чтобы несколько дилеров могли вести переписку по одной заявке."""

    __tablename__ = "chats"
    __table_args__ = (
        UniqueConstraint("request_id", "dealer_user_id", name="uq_chat_request_dealer"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    request_id: Mapped[int] = mapped_column(ForeignKey("calculation_requests.id"), nullable=False)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), nullable=False)
    dealer_user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), nullable=False)
    status: Mapped[str] = mapped_column(String(32), default="open")
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    user_last_read_message_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    dealer_last_read_message_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    last_message_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)


class ChatMessage(Base):
    __tablename__ = "chat_messages"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    chat_id: Mapped[int] = mapped_column(ForeignKey("chats.id"), nullable=False)
    sender_user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), nullable=False)
    message_type: Mapped[str] = mapped_column(String(16), default="text")
    text: Mapped[str | None] = mapped_column(Text, nullable=True)
    attachment_url: Mapped[str | None] = mapped_column(String(512), nullable=True)
    attachment_original_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
