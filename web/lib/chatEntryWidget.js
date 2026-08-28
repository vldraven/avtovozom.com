export const CHAT_ENTRY_COLLAPSED_TITLE = "Спросите про любое авто";
export const CHAT_ENTRY_COLLAPSED_SUB = "Отвечаем в течение минуты, без регистрации";
export const CHAT_ENTRY_COLLAPSED_HINT = "Спросите — ответим за минуту";

export { GUEST_QUICK_PROMPTS as CHAT_ENTRY_SUGGESTIONS } from "./guestChat";

export const CHAT_ENTRY_WELCOME_GUEST =
  "Здравствуйте! Помогу с подбором авто из Китая, расчётом «под ключ» и сроками доставки. Задайте вопрос или выберите пример ниже.";

export const CHAT_ENTRY_WELCOME_AUTH =
  "Здравствуйте! Напишите — команда Avtovozom ответит в этом чате по вашей сделке.";

export const CHAT_ENTRY_TITLE_GUEST = "Консультант Avtovozom";
export const CHAT_ENTRY_TITLE_AUTH = "Чат с Avtovozom";
export const CHAT_ENTRY_SUB_GUEST = "Отвечает сразу · ИИ-помощник";
export const CHAT_ENTRY_SUB_AUTH = "Avtovozom · сделка";

export function chatEntryPathHidden(pathname) {
  const path = pathname || "";
  return (
    path === "/messages" ||
    path === "/auth" ||
    path === "/reset-password" ||
    path.startsWith("/staff/")
  );
}

export function chatEntryRoleHidden(role) {
  if (role == null || role === "") return false;
  const r = String(role).trim().toLowerCase();
  return r === "admin" || r === "moderator" || r === "dealer";
}
