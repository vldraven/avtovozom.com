"""Курируемые series URL che168 для sourcing-агента (не model_whitelist)."""

from __future__ import annotations

# Фильтры на стороне che168 (возраст и т.п.) уже заложены в URL где возможно.
DEFAULT_SOURCING_SERIES_URLS: list[str] = [
    "https://www.che168.com/china/aodi/aodiq3/s53586-53586-53587-53586-53587-53588/",
    "https://www.che168.com/china/baoma/baoma3xi/s57178-57179-52863-52863-52867-52863-52867-56600-52863-52867-56600-56599/a0_0msdgscncgpi1ltocsp1exs17566-16290/",
    "https://www.che168.com/china/fengtian/kaluola/a3_5msdgscncgpi1ltocsp1ex/",
    "https://www.che168.com/china/benchi/benchicji/a3_5msdgscncgpi1ltocspexx0/",
    "https://www.che168.com/china/benchi/benchiaji/s53923-53922-58415-60070/a3_5msdgscncgpi1ltocsp1exs16603-18340/",
    "https://www.che168.com/china/benchi/benchiclajinkou/a3_5msdgscncgpi1ltocspexx0/",
    "https://www.che168.com/china/benchi/benchigla/s53916-54836-53916-53916/a3_5msdgscncgpi1ltocsp1exs16601/",
    "https://www.che168.com/china/aodi/aodia3/a3_5msdgscncgpi1ltocspexx0/",
    "https://www.che168.com/china/aodi/aodiq2l/a3_5msdgscncgpi1ltocspexx0/",
    "https://www.che168.com/china/richan/a3_5msdgscncgpi1ltocspexx0/",
    "https://www.che168.com/china/jiliqiche/",
    "https://www.che168.com/china/changan/a3_5msdgscncgpi1ltocsp1ex/",
    "https://www.che168.com/china/qirui/a3_5msdgscncgpi1ltocsp1ex/",
    "https://www.che168.com/china/hafu/a3_5msdgscncgpi1ltocsp1ex/",
    "https://www.che168.com/china/lingke/a3_5msdgscncgpi1ltocsp1ex/",
    "https://www.che168.com/china/qiya/a3_5msdgscncgpi1ltocsp1ex/",
]

DEFAULT_SOURCING_CRITERIA: dict = {
    "series_urls": DEFAULT_SOURCING_SERIES_URLS,
    "marketplaces": ["che168"],
    "mileage_max": 50000,
    "reg_age_years_min": 3,
    "reg_age_years_max": 5,
    "price_band": "mid_upper",
}

DEFAULT_SOURCING_BRIEF = (
    "Ищи наиболее востребованные и ликвидные варианты под заказ из Китая на рынок РФ. "
    "Учитывай спрос, ликвидность перепродажи, адекватность цены. "
    "Предпочти пробег до 50 тыс. км, возраст по регистрации 3–5 лет, "
    "внутри модели — средний и верхний ценовой сегмент (дешёвый терциль часто с проблемами кузова). "
    "Не выдумывай URL. Источник объявлений — series_urls профиля, не whitelist сайта."
)
