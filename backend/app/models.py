from datetime import datetime

from sqlalchemy import (
    JSON,
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
    password_reset_token_hash: Mapped[str | None] = mapped_column(String(64), nullable=True)
    password_reset_expires_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

    role = relationship("Role")


class UserSession(Base):
    __tablename__ = "user_sessions"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), nullable=False, index=True)
    token_hash: Mapped[str] = mapped_column(String(64), unique=True, nullable=False, index=True)
    device_name: Mapped[str] = mapped_column(String(128), default="")
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    last_used_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    expires_at: Mapped[datetime] = mapped_column(DateTime, nullable=False)
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)

    user = relationship("User")


class UserWebAuthnCredential(Base):
    __tablename__ = "user_webauthn_credentials"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), nullable=False, index=True)
    credential_id: Mapped[str] = mapped_column(String(512), unique=True, nullable=False)
    public_key: Mapped[str] = mapped_column(Text, nullable=False)
    sign_count: Mapped[int] = mapped_column(Integer, default=0)
    transports: Mapped[str] = mapped_column(String(255), default="")
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    last_used_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)

    user = relationship("User")


class CarBrand(Base):
    __tablename__ = "car_brands"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    name: Mapped[str] = mapped_column(String(128), unique=True, nullable=False)
    # Относительный URL вида /media/brands/{id}/… для быстрых фильтров на главной.
    logo_storage_url: Mapped[str | None] = mapped_column(String(512), nullable=True)
    # Меньше — левее в ряду логотипов; NULL — не показывать в быстром фильтре.
    quick_filter_rank: Mapped[int | None] = mapped_column(Integer, nullable=True)


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


class CarTrim(Base):
    """Справочник комплектаций; каноническое описание — spec_sections на русском."""

    __tablename__ = "car_trims"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    model_id: Mapped[int] = mapped_column(ForeignKey("car_models.id"), nullable=False, index=True)
    generation_id: Mapped[int | None] = mapped_column(
        ForeignKey("car_generations.id"), nullable=True, index=True
    )
    autohome_spec_id: Mapped[int | None] = mapped_column(Integer, nullable=True, unique=True)
    name_zh: Mapped[str] = mapped_column(String(256), default="")
    name_normalized: Mapped[str] = mapped_column(String(256), default="")
    name_ru: Mapped[str] = mapped_column(String(256), default="")
    spec_fingerprint: Mapped[str] = mapped_column(String(64), default="")
    spec_sections: Mapped[str] = mapped_column(Text, default='{"version":1,"sections":[],"param_sections":[]}')
    """Каноническое описание комплектации на русском (JSON-документ)."""
    source_spec_json: Mapped[str | None] = mapped_column(Text, nullable=True)
    """Необязательный сырой JSON импорта (Autohome и др.) для пересборки."""
    spec_json: Mapped[str] = mapped_column(Text, default="[]")
    """Deprecated: дублирует source_spec_json для обратной совместимости."""
    spec_json_ru: Mapped[str] = mapped_column(Text, default="[]")
    """Deprecated: дублирует spec_sections для обратной совместимости."""
    source: Mapped[str] = mapped_column(String(32), default="autohome")
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, default=datetime.utcnow, onupdate=datetime.utcnow
    )

    model = relationship("CarModel")
    generation = relationship("CarGeneration")
    __table_args__ = (
        UniqueConstraint("model_id", "generation_id", "spec_fingerprint", name="uq_car_trims_model_gen_fp"),
    )


class ModelWhitelist(Base):
    __tablename__ = "model_whitelist"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    model_id: Mapped[int] = mapped_column(
        ForeignKey("car_models.id"), nullable=False, unique=True
    )
    enabled: Mapped[bool] = mapped_column(Boolean, default=True)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

    model = relationship("CarModel")


class CustomsCalcSettings(Base):
    __tablename__ = "customs_calc_settings"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    config_yaml: Mapped[str] = mapped_column(Text, nullable=False)
    # JSON-текст: коэффициенты УС (ПП № 1291), редактируются в админке; если NULL — только встроенные/YAML-значения.
    util_coefficients_individual: Mapped[str | None] = mapped_column(Text, nullable=True)
    util_coefficients_company: Mapped[str | None] = mapped_column(Text, nullable=True)
    # JSON-текст: дополнительные расходы для итоговой цены на карточке авто.
    additional_expenses_json: Mapped[str | None] = mapped_column(Text, nullable=True)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, default=datetime.utcnow, onupdate=datetime.utcnow
    )


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
    trim_id: Mapped[int | None] = mapped_column(
        ForeignKey("car_trims.id"), nullable=True, index=True
    )
    title: Mapped[str] = mapped_column(String(256), nullable=False)
    description: Mapped[str] = mapped_column(Text, default="")
    year: Mapped[int] = mapped_column(Integer)
    mileage_km: Mapped[int | None] = mapped_column(Integer, nullable=True)
    engine_volume_cc: Mapped[int] = mapped_column(Integer)
    horsepower: Mapped[int] = mapped_column(Integer)
    fuel_type: Mapped[str | None] = mapped_column(String(64), nullable=True)
    transmission: Mapped[str | None] = mapped_column(String(64), nullable=True)
    body_color_slug: Mapped[str | None] = mapped_column(String(32), nullable=True)
    """Справочное значение: white, black, silver, … см. BODY_COLOR_OPTIONS."""
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
    trim = relationship("CarTrim")
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
    cancel_requested: Mapped[bool] = mapped_column(Boolean, default=False)
    import_model_id: Mapped[int | None] = mapped_column(
        Integer, ForeignKey("car_models.id"), nullable=True
    )
    import_detail_url: Mapped[str | None] = mapped_column(String(2048), nullable=True)
    import_generation_id: Mapped[int | None] = mapped_column(
        Integer, ForeignKey("car_generations.id"), nullable=True
    )


class UserFavorite(Base):
    __tablename__ = "user_favorites"
    __table_args__ = (UniqueConstraint("user_id", "car_id", name="uq_user_favorite_car"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), nullable=False, index=True)
    car_id: Mapped[int] = mapped_column(ForeignKey("cars.id"), nullable=False, index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

    user = relationship("User")
    car = relationship("Car")


class UserPushDevice(Base):
    __tablename__ = "user_push_devices"
    __table_args__ = (UniqueConstraint("user_id", "push_token", name="uq_user_push_device"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), nullable=False, index=True)
    platform: Mapped[str] = mapped_column(String(16), default="android")
    push_token: Mapped[str] = mapped_column(Text, nullable=False)
    device_name: Mapped[str] = mapped_column(String(128), default="")
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

    user = relationship("User")


class CalculationRequest(Base):
    __tablename__ = "calculation_requests"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    user_name: Mapped[str] = mapped_column(String(128), nullable=False)
    user_contact: Mapped[str] = mapped_column(String(128), nullable=False)
    user_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    car_id: Mapped[int | None] = mapped_column(ForeignKey("cars.id"), nullable=True)
    """null — заявка на авто вне каталога (описание в comment)."""
    comment: Mapped[str] = mapped_column(Text, default="")
    source: Mapped[str] = mapped_column(String(32), default="website")
    """website | telegram_bot | freeform | …"""
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
    """Чат клиента с Avtovozom (platform) или legacy-чат по паре (заявка, дилер)."""

    __tablename__ = "chats"
    __table_args__ = (
        UniqueConstraint("request_id", "dealer_user_id", name="uq_chat_request_dealer"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    chat_type: Mapped[str] = mapped_column(String(16), default="dealer", index=True)
    request_id: Mapped[int | None] = mapped_column(ForeignKey("calculation_requests.id"), nullable=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), nullable=False)
    dealer_user_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True)
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


class FaqItem(Base):
    __tablename__ = "faq_items"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    question: Mapped[str] = mapped_column(String(512), nullable=False)
    answer: Mapped[str] = mapped_column(Text, nullable=False)
    sort_order: Mapped[int] = mapped_column(Integer, default=0, index=True)
    is_published: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, default=datetime.utcnow, onupdate=datetime.utcnow
    )


class CarExternalPublication(Base):
    """Связь объявления avtovozom с внешней площадкой (Avito Autoload / VK wall).

    Для channel=avito: avito_item_id / avito_url — идентификаторы Avito.
    Для channel=vk: avito_item_id = post_id стены, avito_url = https://vk.com/wall-…_….
    """

    __tablename__ = "car_external_publications"
    __table_args__ = (UniqueConstraint("car_id", "channel", name="uq_car_external_publication_car_channel"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    car_id: Mapped[int] = mapped_column(ForeignKey("cars.id"), nullable=False, index=True)
    channel: Mapped[str] = mapped_column(String(32), default="avito", nullable=False)
    feed_ad_id: Mapped[str] = mapped_column(String(128), nullable=False, index=True)
    avito_item_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    avito_url: Mapped[str | None] = mapped_column(String(512), nullable=True)
    status: Mapped[str] = mapped_column(String(32), default="draft")
    """draft | pending_upload | published | error | deactivated"""
    last_upload_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    last_error: Mapped[str | None] = mapped_column(Text, nullable=True)
    compose_snapshot_json: Mapped[str] = mapped_column(Text, default="{}")
    published_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, default=datetime.utcnow, onupdate=datetime.utcnow
    )

    car = relationship("Car")


class AvitoFieldMapping(Base):
    """Локальное значение → допустимое значение в фиде Avito."""

    __tablename__ = "avito_field_mappings"
    __table_args__ = (UniqueConstraint("entity_type", "local_value", name="uq_avito_field_mapping"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    entity_type: Mapped[str] = mapped_column(String(32), nullable=False, index=True)
    """brand | model | fuel | transmission | color"""
    local_value: Mapped[str] = mapped_column(String(256), nullable=False)
    avito_value: Mapped[str] = mapped_column(String(256), nullable=False)


class ImportPlan(Base):
    """Общий план импорта для staff (admin/moderator) — один активный список на всех."""

    __tablename__ = "import_plans"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    status: Mapped[str] = mapped_column(String(32), default="idle")
    """idle | running | stopping"""
    stop_requested: Mapped[bool] = mapped_column(Boolean, default=False)
    banner: Mapped[str] = mapped_column(String(512), default="")
    error: Mapped[str] = mapped_column(String(512), default="")
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, default=datetime.utcnow, onupdate=datetime.utcnow
    )

    items = relationship(
        "ImportPlanItem",
        back_populates="plan",
        cascade="all, delete-orphan",
        order_by="ImportPlanItem.sort_order",
    )


class ImportPlanItem(Base):
    __tablename__ = "import_plan_items"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    plan_id: Mapped[int] = mapped_column(ForeignKey("import_plans.id"), nullable=False, index=True)
    client_key: Mapped[str] = mapped_column(String(64), nullable=False, default="")
    """Стабильный id строки для React-ключей (UUID с клиента)."""
    sort_order: Mapped[int] = mapped_column(Integer, default=0)
    marketplace: Mapped[str] = mapped_column(String(32), default="che168")
    brand_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    brand_name: Mapped[str] = mapped_column(String(128), default="")
    model_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    model_name: Mapped[str] = mapped_column(String(128), default="")
    generation_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    generation_name: Mapped[str] = mapped_column(String(128), default="")
    url: Mapped[str] = mapped_column(String(2048), default="")
    status: Mapped[str] = mapped_column(String(32), default="pending")
    """pending | queued | running | success | failed | cancelled"""
    attempts: Mapped[int] = mapped_column(Integer, default=0)
    message: Mapped[str] = mapped_column(String(512), default="")
    parse_job_id: Mapped[int | None] = mapped_column(
        Integer, ForeignKey("parse_jobs.id"), nullable=True
    )

    plan = relationship("ImportPlan", back_populates="items")


class SearchProfile(Base):
    """Критерии ежедневного отбора для sourcing-агента (данные, не промпт n8n)."""

    __tablename__ = "search_profiles"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    name: Mapped[str] = mapped_column(String(128), default="")
    enabled: Mapped[bool] = mapped_column(Boolean, default=True)
    criteria: Mapped[dict] = mapped_column(JSON, default=dict)
    brief: Mapped[str] = mapped_column(Text, default="")
    max_select: Mapped[int] = mapped_column(Integer, default=20)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, default=datetime.utcnow, onupdate=datetime.utcnow
    )

    candidates = relationship("ImportCandidate", back_populates="profile")


class ImportCandidate(Base):
    """Staging объявлений: discover → filter → score → selected → import-plan."""

    __tablename__ = "import_candidates"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    profile_id: Mapped[int] = mapped_column(
        ForeignKey("search_profiles.id"), nullable=False, index=True
    )
    url: Mapped[str] = mapped_column(String(2048), default="")
    listing_id: Mapped[str] = mapped_column(String(128), default="", index=True)
    marketplace: Mapped[str] = mapped_column(String(32), default="che168")
    brand_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    brand_name: Mapped[str] = mapped_column(String(128), default="")
    model_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    model_name: Mapped[str] = mapped_column(String(128), default="")
    generation_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    generation_name: Mapped[str] = mapped_column(String(128), default="")
    year: Mapped[int | None] = mapped_column(Integer, nullable=True)
    price_cny: Mapped[float | None] = mapped_column(Float, nullable=True)
    mileage_km: Mapped[int | None] = mapped_column(Integer, nullable=True)
    title: Mapped[str] = mapped_column(String(512), default="")
    score: Mapped[float | None] = mapped_column(Float, nullable=True)
    reasons: Mapped[list] = mapped_column(JSON, default=list)
    status: Mapped[str] = mapped_column(String(32), default="new", index=True)
    """new | filtered | scored | selected | rejected | imported"""
    filter_reasons: Mapped[list] = mapped_column(JSON, default=list)
    selected_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, default=datetime.utcnow, onupdate=datetime.utcnow
    )

    profile = relationship("SearchProfile", back_populates="candidates")


class AgentMemory(Base):
    """Долгосрочная память агента (уроки из TG revise/cancel и т.п.)."""

    __tablename__ = "agent_memories"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    agent_key: Mapped[str] = mapped_column(String(64), default="sourcing", index=True)
    kind: Mapped[str] = mapped_column(String(32), default="lesson")
    """lesson | preference | ban | market_note"""
    content: Mapped[str] = mapped_column(Text, default="")
    source: Mapped[str] = mapped_column(String(32), default="manual")
    """tg_revise | tg_cancel | manual | run"""
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)


class SourcingApprovalSession(Base):
    """Сессия апрува плана в TG — переживает рестарт n8n."""

    __tablename__ = "sourcing_approval_sessions"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    profile_id: Mapped[int] = mapped_column(
        ForeignKey("search_profiles.id"), nullable=False, index=True
    )
    status: Mapped[str] = mapped_column(String(32), default="pending", index=True)
    """pending | approved | cancelled | expired"""
    candidate_ids: Mapped[list] = mapped_column(JSON, default=list)
    telegram_chat_id: Mapped[str] = mapped_column(String(64), default="")
    telegram_message_id: Mapped[str] = mapped_column(String(64), default="")
    summary: Mapped[str] = mapped_column(Text, default="")
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, default=datetime.utcnow, onupdate=datetime.utcnow
    )
