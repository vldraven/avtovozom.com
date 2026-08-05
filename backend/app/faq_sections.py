"""Разделы FAQ (синхрон с web/lib/faqSections.js)."""

FAQ_SECTION_IDS: tuple[str, ...] = (
    "general",
    "china",
    "korea",
    "customs",
    "payment",
    "warranty",
)

FAQ_SECTION_DEFAULT = "general"

FAQ_SECTION_LABELS: dict[str, str] = {
    "general": "Общие вопросы",
    "china": "Доставка из Китая",
    "korea": "Доставка из Кореи",
    "customs": "Растаможка и платежи",
    "payment": "Оплата и договор",
    "warranty": "Гарантия и сервис",
}


def normalize_faq_section(value: str | None) -> str:
    raw = (value or "").strip().lower()
    if raw in FAQ_SECTION_IDS:
        return raw
    return FAQ_SECTION_DEFAULT
