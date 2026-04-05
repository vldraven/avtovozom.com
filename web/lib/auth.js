export function getStoredToken() {
  if (typeof window === "undefined") return "";
  return localStorage.getItem("avt_token") || "";
}

export function saveToken(token) {
  if (typeof window === "undefined") return;
  localStorage.setItem("avt_token", token);
  window.dispatchEvent(new Event("avt-token-changed"));
}

export function clearToken() {
  if (typeof window === "undefined") return;
  localStorage.removeItem("avt_token");
  window.dispatchEvent(new Event("avt-token-changed"));
}
