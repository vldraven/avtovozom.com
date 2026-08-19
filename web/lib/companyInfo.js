import { TELEGRAM_CHANNEL_URL } from "./telegramChannel";

function env(name, fallback = "") {
  const value = process.env[name];
  if (value == null) return fallback;
  const trimmed = String(value).trim();
  return trimmed || fallback;
}

/** Публичные данные компании для страниц /about, /contacts, футера и JSON-LD. */
export const COMPANY = {
  brandName: "Автовозом",
  legalName: env("NEXT_PUBLIC_COMPANY_LEGAL_NAME", "ООО «АВТОВОЗОМ»"),
  inn: env("NEXT_PUBLIC_COMPANY_INN", "7751397465"),
  ogrn: env("NEXT_PUBLIC_COMPANY_OGRN", "1267700278416"),
  kpp: env("NEXT_PUBLIC_COMPANY_KPP", "775101001"),
  address: env("NEXT_PUBLIC_COMPANY_ADDRESS", "г. Москва, Прокшинский пр. 11"),
  city: env("NEXT_PUBLIC_COMPANY_CITY", "Москва"),
  phone: env("NEXT_PUBLIC_COMPANY_PHONE", "+7 (916) 297-61-87"),
  email: env("NEXT_PUBLIC_COMPANY_EMAIL", "noreply@avtovozom.com"),
  workingHours: env("NEXT_PUBLIC_COMPANY_HOURS"),
  telegramUrl: TELEGRAM_CHANNEL_URL,
  telegramHandle: "@avtovozom",
};

export function hasLegalRequisites() {
  return Boolean(COMPANY.legalName && COMPANY.inn);
}

/** tel:+7... для ссылки из произвольной строки телефона. */
export function phoneHref(phone = COMPANY.phone) {
  const raw = String(phone || "").trim();
  if (!raw) return "";
  const digits = raw.replace(/\D/g, "");
  if (!digits) return "";
  if (digits.length === 11 && digits.startsWith("7")) return `+${digits}`;
  if (digits.length === 10) return `+7${digits}`;
  return raw.startsWith("+") ? raw : `+${digits}`;
}
