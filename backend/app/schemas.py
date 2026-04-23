from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, Field, model_validator


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


class CarPriceBreakdownItemOut(BaseModel):
    key: str
    label: str
    amount_rub: float
    description: str = ""


class CarPriceBreakdownOut(BaseModel):
    total_rub: float
    owner_type: str
    age_group: str
    engine_type_calc: str
    components: list[CarPriceBreakdownItemOut]


class CarOut(BaseModel):
    id: int
    brand_id: int
    model_id: int
    generation_id: int | None = None
    """Поколение в справочнике; null — не привязано к поколению."""
    brand_slug: str = ""
    """Сегмент URL каталога для марки (совпадает с /catalog/tree)."""
    model_slug: str = ""
    """Сегмент URL каталога для модели внутри марки."""
    generation_slug: str = ""
    """Сегмент URL для страницы поколения (/catalog/марка/модель/поколение)."""
    generation: str | None = None
    """Название поколения для отображения."""
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
    price_breakdown: CarPriceBreakdownOut | None = None
    """Ориентировочная детализация итоговой цены в РФ."""
    estimated_total_rub: float | None = None
    """Ориентировочный итог в ₽ (как в разборе по строкам) без детализации; для листингов, когда price_breakdown не считаем."""


class CarsListOut(BaseModel):
    items: list[CarOut]
    total: int
    cbr: CbrSnapshot | None = None
    cbr_error: str | None = None


class CarBrandBriefOut(BaseModel):
    id: int
    name: str
    logo_storage_url: str | None = None
    quick_filter_rank: int | None = None

    class Config:
        from_attributes = True


class CarBrandUpdateIn(BaseModel):
    """Частичное обновление марки (только переданные поля)."""

    name: str | None = Field(default=None, min_length=1, max_length=128)
    quick_filter_rank: int | None = None


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
    slug: str = ""
    listings_count: int = 0
    models_with_listings: int = 0
    logo_storage_url: str | None = None
    quick_filter_rank: int | None = None


class CatalogModelOut(BaseModel):
    id: int
    brand_id: int
    name: str
    slug: str = ""
    listings_count: int = 0


class CatalogTreeGenerationOut(BaseModel):
    id: int
    name: str
    slug: str
    listings_count: int = 0


class CatalogTreeModelOut(BaseModel):
    id: int
    name: str
    slug: str
    listings_count: int = 0
    generations: list[CatalogTreeGenerationOut] = Field(default_factory=list)


class CatalogTreeBrandOut(BaseModel):
    id: int
    name: str
    slug: str
    listings_count: int = 0
    models_with_listings: int = 0
    models: list[CatalogTreeModelOut]


class CarGenerationCreateIn(BaseModel):
    name: str = Field(..., min_length=1, max_length=160)


class CarBrandCreateIn(BaseModel):
    name: str = Field(..., min_length=1, max_length=128)


class CarModelCreateIn(BaseModel):
    name: str = Field(..., min_length=1, max_length=128)


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


class AdminCalculationRequestOut(CalculationRequestMyOut):
    """Заявка для админ-раздела: email клиента и ссылка на объявление."""

    client_email: str | None = None
    client_user_id: int | None = None
    car_page_url: str | None = None


class AdminUserOut(BaseModel):
    id: int
    email: str
    phone: str | None = None
    full_name: str
    display_name: str = ""
    company_name: str | None = None
    role: str
    is_active: bool
    email_verified: bool


class AdminUserCreateIn(BaseModel):
    email: str
    password: str | None = None
    phone: str | None = None
    full_name: str = ""
    role: str = "user"


class AdminUserUpdateIn(BaseModel):
    email: str | None = None
    phone: str | None = None
    full_name: str | None = None
    display_name: str | None = None
    company_name: str | None = None
    role: str | None = None
    is_active: bool | None = None


class AdminUserCreateResultOut(BaseModel):
    user: AdminUserOut
    generated_password: str | None = None


class AdminPasswordResetOut(BaseModel):
    new_password: str


class CustomsCalcConfigOut(BaseModel):
    config_yaml: str
    util_coefficients_individual: str | None = None
    util_coefficients_company: str | None = None
    additional_expenses_json: str | None = None
    updated_at: datetime | None = None


class CustomsCalcConfigIn(BaseModel):
    config_yaml: str
    util_coefficients_individual: str | None = None
    util_coefficients_company: str | None = None
    additional_expenses_json: str | None = None


class UtilCoeffDefaultsOut(BaseModel):
    individual: str
    company: str


class CustomsCalcEstimateIn(BaseModel):
    age: str = Field(..., description="new|1-3|3-5|5-7|over_7")
    engine_capacity: int = Field(..., ge=0, le=20000, description="Для электро допускается 0 (нет объёма ДВС).")
    engine_type: str = Field(..., description="gasoline|diesel|electric|hybrid")
    power: int = Field(..., ge=1, le=3000)
    price: float = Field(..., gt=0, le=1_000_000_000)
    owner_type: str = Field(..., description="individual|company")
    currency: str = Field(..., min_length=3, max_length=3)

    @model_validator(mode="after")
    def validate_engine_capacity_for_type(self) -> "CustomsCalcEstimateIn":
        et = (self.engine_type or "").strip().lower()
        if et == "electric":
            return self
        if self.engine_capacity < 50:
            raise ValueError("Для бензина, дизеля и гибрида укажите объём двигателя не менее 50 см³.")
        return self


class CustomsCalcEtcContext(BaseModel):
    """Расшифровка ETC: для физлица — пошлина по возрасту и утилизация; для юрлица — справка по YAML."""

    age: str
    engine_type: str
    engine_capacity_cc: int
    customs_value_rub: float | None = None
    customs_value_eur: float | None = None
    duty_mode: str = ""
    duty_percent: float | None = None
    duty_min_eur_per_cc: float | None = None
    rate_per_cc_eur: float | None = None
    duty_rub: float | None = None
    utilization_fee_rub: float | None = None
    recycling_fee_rub: float | None = None
    clearance_fee_rub: float | None = None
    util_fee_rub: float | None = None
    utilization_mode: str | None = Field(
        default=None,
        description="Как считался утилизационный сбор: flat_le_hp, high_hp_scaled_by_cc, …",
    )
    hint: str = Field(
        default="",
        description="Подсказка по конфигу или режиму расчёта.",
    )


class CustomsCalcSummary(BaseModel):
    """Краткая разбивка для витрины: оформление, пошлина, утилизация, итого."""

    clearance_fee_rub: float = Field(..., description="Таможенное оформление (сбор), ₽")
    duty_rub: float = Field(..., description="Таможенная пошлина (для юрлица при необходимости включает акциз и НДС в одной сумме)")
    utilization_fee_rub: float = Field(..., description="Утилизационный сбор, ₽")
    total_rub: float = Field(..., description="Итого к уплате (оценка), ₽")


class CustomsCalcEstimateOut(BaseModel):
    etc: dict
    ctp: dict
    disclaimer: str
    primary_mode: str = Field(
        default="etc",
        description="Какой блок ориентировать на выбранный тип ввоза: etc (физлицо) или ctp (юрлицо).",
    )
    calculation_note: str = Field(
        default="",
        description="Кратко: что изменено относительно сырого tks-api (ступени сбора, физлицо).",
    )
    etc_context: CustomsCalcEtcContext | None = Field(
        default=None,
        description="Расшифровка ETC: возраст, ставка из конфига, компоненты — чтобы было видно, что возраст учтён.",
    )
    summary: CustomsCalcSummary | None = Field(
        default=None,
        description="Упрощённая разбивка платежей для пользователя.",
    )


class ModelWhitelistItem(BaseModel):
    model_id: int
    enabled: bool


class CarModelCatalogIn(BaseModel):
    """URL страницы серии на che168 для парсинга списка объявлений."""
    che168_url: str | None = None


class ParserImportListingIn(BaseModel):
    """Разовый импорт одной карточки: ссылка на объявление che168 (dealer/… или i.che168.com/car/…)."""
    model_id: int
    che168_url: str


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
    import_model_id: int | None = None
    """Для type=import_one — модель в справочнике."""
    import_detail_url: str | None = None
    """Для type=import_one — исходная ссылка на объявление che168."""

    class Config:
        from_attributes = True


class RegisterIn(BaseModel):
    email: str
    phone: str
    full_name: str = ""


class LoginIn(BaseModel):
    """Поле email: адрес почты или номер телефона (цифры; маска допускается)."""

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
    access_token: str | None = None
    token_type: str = "bearer"


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
