/**
 * Переводит типичные WebAuthn / DOMException сообщения в понятный русский текст.
 */
export function humanizeWebAuthnError(err, fallback = "Не удалось настроить биометрию") {
  const raw = String(err?.message || err?.name || "").trim();
  const lower = raw.toLowerCase();
  const name = String(err?.name || "");

  if (
    name === "InvalidStateError" ||
    lower.includes("already registered") ||
    lower.includes("one of the credentials already registered")
  ) {
    return "Биометрия на этом устройстве уже привязана. Продолжите с PIN — или настройте вход в профиле.";
  }
  if (name === "NotAllowedError" || lower.includes("not allowed") || lower.includes("timed out")) {
    return "Биометрию отменили или время ожидания истекло. Можно продолжить только с PIN.";
  }
  if (name === "AbortError") {
    return "Настройка биометрии прервана. Можно продолжить только с PIN.";
  }
  if (name === "SecurityError" || lower.includes("security")) {
    return "Биометрия недоступна в этом браузере или без HTTPS.";
  }
  if (name === "NotSupportedError" || lower.includes("not supported")) {
    return "Это устройство не поддерживает вход по биометрии.";
  }
  // Уже локализованные сообщения с бэка / нашего кода
  if (/[А-Яа-яЁё]/.test(raw)) return raw;
  // Технический английский без маппинга — не показываем as-is
  if (raw && /^[A-Za-z0-9 ,.'":_()\-]+$/.test(raw) && raw.length > 40) {
    return fallback;
  }
  return raw || fallback;
}
