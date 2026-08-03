const GUEST_CHAT_TOKEN_KEY = "avt_guest_chat_token";

export function getGuestChatToken() {
  if (typeof window === "undefined") return "";
  try {
    return (window.localStorage.getItem(GUEST_CHAT_TOKEN_KEY) || "").trim();
  } catch {
    return "";
  }
}

export function setGuestChatToken(token) {
  if (typeof window === "undefined") return;
  const value = (token || "").trim();
  try {
    if (value) window.localStorage.setItem(GUEST_CHAT_TOKEN_KEY, value);
    else window.localStorage.removeItem(GUEST_CHAT_TOKEN_KEY);
  } catch {
    /* ignore quota / private mode */
  }
}
