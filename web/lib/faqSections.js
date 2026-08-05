/** Разделы FAQ — синхрон с backend/app/faq_sections.py */

export const FAQ_SECTIONS = [
  { id: "all", label: "Все вопросы", mobileLabel: "Все" },
  { id: "general", label: "Общие вопросы", mobileLabel: "Общее" },
  { id: "china", label: "Доставка из Китая", mobileLabel: "Китай" },
  { id: "korea", label: "Доставка из Кореи", mobileLabel: "Корея" },
  { id: "customs", label: "Растаможка и платежи", mobileLabel: "Таможня" },
  { id: "payment", label: "Оплата и договор", mobileLabel: "Оплата" },
  { id: "warranty", label: "Гарантия и сервис", mobileLabel: "Гарантия" },
];

export const FAQ_SECTION_DEFAULT = "general";

export const FAQ_SECTION_OPTIONS = FAQ_SECTIONS.filter((s) => s.id !== "all");

export const FAQ_MOBILE_TABS = FAQ_SECTIONS.filter((s) => s.mobileLabel);

export function faqSectionLabel(sectionId) {
  return FAQ_SECTIONS.find((s) => s.id === sectionId)?.label || sectionId;
}

/** Короткая подпись для мобильных табов (те же разделы, что в sidebar). */
export function faqSectionTabLabel(section) {
  return section?.mobileLabel || section?.label || "";
}

export function normalizeFaqSection(value) {
  const raw = String(value || "").trim().toLowerCase();
  return FAQ_SECTION_OPTIONS.some((s) => s.id === raw) ? raw : FAQ_SECTION_DEFAULT;
}
