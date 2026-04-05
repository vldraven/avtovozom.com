from datetime import datetime

from pydantic import BaseModel, Field


class CarPhotoOut(BaseModel):
    id: int
    storage_url: str
    sort_order: int

    class Config:
        from_attributes = True


class CbrSnapshot(BaseModel):
    """Курс юаня по данным ЦБ РФ на дату rate_date."""

    rub_per_cny: float
    rate_date: str


class FreeCalculatorLink(BaseModel):
    title: str
    url: str
    description: str = ""


class CarPricingGuideOut(BaseModel):
    """
    Цена в Китае в ₽ (ЦБ) + сводка параметров и ссылки на бесплатные онлайн-калькуляторы.
    Платные API не используются.
    """

    cbr_rub_per_cny: float
    cbr_date: str
    rub_china: float
    params_lines: list[str]
    calculator_links: list[FreeCalculatorLink]
    disclaimer: str


class CarOut(BaseModel):
    id: int
    brand_id: int
    model_id: int
    created_by_user_id: int | None = None
    """Автор ручного объявления; null у карточек с парсера."""
    has_public_dealer_profile: bool = False
    """True, если автор — дилер и есть публичная страница /dealers/{id}."""
    title: str
    description: str
    year: int
    mileage_km: int | None = None
    engine_volume_cc: int
    horsepower: int
    fuel_type: str | None = None
    transmission: str | None = None
    location_city: str | None = None
    price_cny: float
    registration_date: str | None = None
    production_date: str | None = None
    brand: str
    model: str
    photos: list[CarPhotoOut]
    rub_china: float | None = None
    """Цена в Китае в ₽ по курсу ЦБ (за 1 CNY см. cbr в списке или pricing_guide)."""
    pricing_guide: CarPricingGuideOut | None = None
    """Курс, сводка для калькуляторов и ссылки — только в GET /cars/{id}."""


class CarsListOut(BaseModel):
    items: list[CarOut]
    total: int
    cbr: CbrSnapshot | None = None
    cbr_error: str | None = None


class CarBrandBriefOut(BaseModel):
    id: int
    name: str

    class Config:
        from_attributes = True


class CarModelBriefOut(BaseModel):
    id: int
    brand_id: int
    name: str

    class Config:
        from_attributes = True


class CatalogBrandOut(BaseModel):
    """Публичный каталог марок (как витрина на главной)."""

    id: int
    name: str
    listings_count: int = 0
    models_with_listings: int = 0


class CatalogModelOut(BaseModel):
    id: int
    brand_id: int
    name: str
    listings_count: int = 0


class CreateRequestIn(BaseModel):
    user_name: str | None = None
    user_contact: str | None = None
    car_id: int
    comment: str = ""


class PublicRequestLeadIn(BaseModel):
    """Заявка без входа: контакты + под капотом создание неподтверждённого аккаунта и код на email."""

    email: str
    phone: str = ""
    full_name: str = ""
    car_id: int
    comment: str = ""


class PublicRequestLeadOut(BaseModel):
    ok: bool = True
    request_id: int
    message: str


class CalculationRequestOut(BaseModel):
    id: int
    user_name: str
    user_contact: str
    car_id: int
    comment: str
    status: str
    created_at: datetime

    class Config:
        from_attributes = True


class DealerOfferCreateIn(BaseModel):
    total_price: float
    currency: str = "USD"
    eta_days: int = 30
    terms_text: str = ""


class DealerOfferOut(BaseModel):
    id: int
    request_id: int
    dealer_user_id: int
    total_price: float
    currency: str
    eta_days: int
    terms_text: str
    status: str
    created_at: datetime
    chat_id: int | None = None

    class Config:
        from_attributes = True


class OpenChatOut(BaseModel):
    chat_id: int


class CalculationRequestDealerOut(BaseModel):
    """Открытая заявка в кабинете дилера: авто, комментарий клиента, своё предложение и чат."""

    id: int
    user_name: str
    user_contact: str
    car_id: int
    comment: str
    status: str
    created_at: datetime
    car_title: str
    car_brand: str
    car_model: str
    car_year: int | None = None
    car_thumb_url: str | None = None
    my_offer: DealerOfferOut | None = None
    chat_id: int | None = None
    client_has_account: bool = True
    """False — гостевая заявка без user_id; чат с клиентом на платформе невозможен."""


class CalculationRequestMyOut(BaseModel):
    """Заявка клиента с данными авто и предложениями дилеров (GET /requests/my)."""

    id: int
    user_name: str
    user_contact: str
    car_id: int
    comment: str
    status: str
    created_at: datetime
    car_title: str
    car_brand: str
    car_model: str
    car_year: int | None = None
    car_thumb_url: str | None = None
    offers: list[DealerOfferOut] = Field(default_factory=list)
    unread_offers_count: int = 0
    """Число расчётов дилеров, появившихся после последнего просмотра клиентом."""


class ModelWhitelistItem(BaseModel):
    model_id: int
    enabled: bool


class CarModelCatalogIn(BaseModel):
    """URL страницы серии на che168 для парсинга списка объявлений."""
    che168_url: str | None = None


class ParseJobOut(BaseModel):
    id: int
    type: str
    status: str
    started_at: datetime | None
    finished_at: datetime | None
    total_processed: int
    total_created: int
    total_updated: int
    total_errors: int
    message: str

    class Config:
        from_attributes = True


class RegisterIn(BaseModel):
    email: str
    phone: str
    full_name: str = ""


class LoginIn(BaseModel):
    email: str
    password: str


class TokenOut(BaseModel):
    access_token: str
    token_type: str = "bearer"


class MeOut(BaseModel):
    id: int
    email: str
    phone: str | None = None
    full_name: str
    display_name: str = ""
    company_name: str | None = None
    role: str
    email_verified: bool = True
    must_change_password: bool = False


class RegisterVerifyIn(BaseModel):
    email: str
    code: str


class RegisterStartOut(BaseModel):
    ok: bool
    message: str


class ProfileUpdateIn(BaseModel):
    full_name: str | None = None
    phone: str | None = None
    display_name: str | None = None
    company_name: str | None = None


class DealerPublicProfileOut(BaseModel):
    user_id: int
    display_name: str = ""
    company_name: str | None = None
    headline: str
    listings_total: int
    cars: list[CarOut]


class PasswordChangeIn(BaseModel):
    old_password: str
    new_password: str


class ChatOut(BaseModel):
    id: int
    request_id: int
    user_id: int
    dealer_user_id: int
    status: str
    created_at: datetime

    class Config:
        from_attributes = True


class ChatListItemOut(BaseModel):
    """Элемент списка чатов: превью, собеседник, непрочитанные (как в мессенджерах)."""

    id: int
    request_id: int
    user_id: int
    dealer_user_id: int
    status: str
    created_at: datetime
    title: str
    peer_role: str
    peer_display: str
    last_message_text: str | None = None
    last_message_at: datetime | None = None
    unread_count: int = 0


class ChatMessageOut(BaseModel):
    id: int
    chat_id: int
    sender_user_id: int
    message_type: str
    text: str | None
    attachment_url: str | None = None
    attachment_original_name: str | None = None
    created_at: datetime

    class Config:
        from_attributes = True


class ChatMessageCreateIn(BaseModel):
    text: str = ""
