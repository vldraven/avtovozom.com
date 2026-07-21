const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";
const TOKEN_KEY = "avt_token";
const PENDING_REFRESH_KEY = "avt_refresh_pending";
const UNLOCKED_KEY = "avt_app_unlocked";
const HIDDEN_AT_KEY = "avt_app_hidden_at";
const DB_NAME = "avtovozom-auth";
const DB_VERSION = 1;
const STORE = "secrets";
const PIN_RECORD = "pin-session";
const PIN_ITERATIONS = 250000;
export const APP_LOCK_TIMEOUT_MS = 10 * 60 * 1000;

function decodeJwtPayload(token) {
  try {
    const parts = String(token || "").split(".");
    if (parts.length < 2) return null;
    const json = atob(parts[1].replace(/-/g, "+").replace(/_/g, "/"));
    return JSON.parse(json);
  } catch {
    return null;
  }
}

export function getStoredToken() {
  if (typeof window === "undefined") return "";
  return localStorage.getItem(TOKEN_KEY) || "";
}

/** Access JWT есть и не истёк (с запасом 30 сек). */
export function hasValidAccessToken() {
  if (typeof window === "undefined") return false;
  const token = getStoredToken();
  if (!token) return false;
  const payload = decodeJwtPayload(token);
  if (!payload?.exp) return Boolean(token);
  return payload.exp * 1000 > Date.now() + 30_000;
}

export function saveToken(token, refreshToken = "") {
  if (typeof window === "undefined") return;
  localStorage.setItem(TOKEN_KEY, token);
  if (refreshToken) sessionStorage.setItem(PENDING_REFRESH_KEY, refreshToken);
  markAppUnlocked();
  window.dispatchEvent(new Event("avt-token-changed"));
}

/**
 * Сброс access-сессии.
 *
 * По умолчанию ПИН и серверный refresh НЕ трогаем — это «блокировка»
 * для ежедневного входа по ПИН после истечения JWT.
 *
 * @param {{ logout?: boolean, keepPinLock?: boolean }} options
 * - logout: true — явный «Выйти»: отзыв refresh + удаление ПИН
 * - keepPinLock: true — то же, что поведение по умолчанию (совместимость)
 */
export function clearToken(options = {}) {
  if (typeof window === "undefined") return;
  const explicitLogout = options.logout === true;
  // keepPinLock: true или отсутствие logout → сохраняем ПИН
  const keepPin =
    !explicitLogout && (options.keepPinLock === true || options.keepPinLock === undefined);

  const refreshToken = sessionStorage.getItem(PENDING_REFRESH_KEY);
  if (explicitLogout && refreshToken) {
    fetch(`${API_URL}/auth/logout-session`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refresh_token: refreshToken }),
    }).catch(() => null);
  }

  localStorage.removeItem(TOKEN_KEY);
  sessionStorage.removeItem(PENDING_REFRESH_KEY);

  if (keepPin) {
    lockApp();
  } else {
    sessionStorage.removeItem(UNLOCKED_KEY);
    sessionStorage.removeItem(HIDDEN_AT_KEY);
    if (window.indexedDB) idbDelete(PIN_RECORD).catch(() => null);
  }
  window.dispatchEvent(new Event("avt-token-changed"));
}

export function markAppUnlocked() {
  if (typeof window === "undefined") return;
  sessionStorage.setItem(UNLOCKED_KEY, String(Date.now()));
  sessionStorage.removeItem(HIDDEN_AT_KEY);
}

export function lockApp() {
  if (typeof window === "undefined") return;
  sessionStorage.removeItem(UNLOCKED_KEY);
  sessionStorage.removeItem(HIDDEN_AT_KEY);
  window.dispatchEvent(new Event("avt-app-lock-changed"));
}

export function isAppUnlocked() {
  if (typeof window === "undefined") return false;
  return Boolean(sessionStorage.getItem(UNLOCKED_KEY));
}

export function markAppHidden() {
  if (typeof window === "undefined") return;
  sessionStorage.setItem(HIDDEN_AT_KEY, String(Date.now()));
}

export function shouldLockAfterHidden() {
  if (typeof window === "undefined") return false;
  const hiddenAt = Number(sessionStorage.getItem(HIDDEN_AT_KEY) || "0");
  return Boolean(hiddenAt && Date.now() - hiddenAt > APP_LOCK_TIMEOUT_MS);
}

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      req.result.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function idbGet(key) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readonly");
    const req = tx.objectStore(STORE).get(key);
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => reject(req.error);
  });
}

async function idbSet(key, value) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).put(value, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function idbDelete(key) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).delete(key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

function bytesToBase64(bytes) {
  return btoa(String.fromCharCode(...new Uint8Array(bytes)));
}

function base64ToBytes(value) {
  return Uint8Array.from(atob(value), (ch) => ch.charCodeAt(0));
}

function base64UrlToBuffer(value) {
  const base64 = value.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  return base64ToBytes(base64).buffer;
}

function bufferToBase64Url(buffer) {
  return bytesToBase64(buffer).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

async function derivePinKey(pin, salt) {
  const material = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(pin),
    "PBKDF2",
    false,
    ["deriveKey"]
  );
  return crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      hash: "SHA-256",
      salt,
      iterations: PIN_ITERATIONS,
    },
    material,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );
}

export async function hasPinLock() {
  if (typeof window === "undefined" || !window.indexedDB || !window.crypto?.subtle) return false;
  return Boolean(await idbGet(PIN_RECORD));
}

export async function setupPin(pin) {
  const refreshToken = sessionStorage.getItem(PENDING_REFRESH_KEY);
  if (!refreshToken) throw new Error("Нет сессии для сохранения");
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await derivePinKey(pin, salt);
  const encrypted = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    new TextEncoder().encode(refreshToken)
  );
  await idbSet(PIN_RECORD, {
    salt: bytesToBase64(salt),
    iv: bytesToBase64(iv),
    encrypted: bytesToBase64(encrypted),
    iterations: PIN_ITERATIONS,
    createdAt: Date.now(),
  });
  markAppUnlocked();
}

export function hasPendingPinSetup() {
  if (typeof window === "undefined") return false;
  return Boolean(sessionStorage.getItem(PENDING_REFRESH_KEY));
}

async function decryptRefreshWithPin(pin) {
  const record = await idbGet(PIN_RECORD);
  if (!record) throw new Error("ПИН-код не настроен");
  const salt = base64ToBytes(record.salt);
  const iv = base64ToBytes(record.iv);
  const key = await derivePinKey(pin, salt);
  const decrypted = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv },
    key,
    base64ToBytes(record.encrypted)
  );
  return new TextDecoder().decode(decrypted);
}

export async function unlockWithPin(pin) {
  const refreshToken = await decryptRefreshWithPin(pin);
  return refreshWithToken(refreshToken);
}

export async function refreshWithToken(refreshToken) {
  const res = await fetch(`${API_URL}/auth/refresh`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ refresh_token: refreshToken, device_name: navigator.userAgent.slice(0, 120) }),
  });
  if (!res.ok) throw new Error("Сессия устарела");
  const data = await res.json();
  saveToken(data.access_token, data.refresh_token || refreshToken);
  return data.access_token;
}

export async function tryRefreshAccessToken() {
  if (typeof window === "undefined") return false;
  const refresh = sessionStorage.getItem(PENDING_REFRESH_KEY);
  if (!refresh) return false;
  try {
    await refreshWithToken(refresh);
    return true;
  } catch {
    return false;
  }
}

export async function ensureFreshAccessToken() {
  if (typeof window === "undefined") return false;
  const token = getStoredToken();
  const refresh = sessionStorage.getItem(PENDING_REFRESH_KEY);
  const payload = decodeJwtPayload(token);
  const expMs = payload?.exp ? payload.exp * 1000 : 0;
  const accessFresh = expMs ? expMs > Date.now() + 120_000 : false;

  if (refresh) {
    if (accessFresh) return true;
    const ok = await tryRefreshAccessToken();
    if (ok) return true;
    // refresh в вкладке протух/отозван — если есть ПИН, блокируем, а не «тихо логиним»
    if (await hasPinLock()) {
      await resolveAuthSessionFailure();
      return false;
    }
    clearToken({ logout: true });
    return false;
  }

  if (accessFresh) return true;

  // JWT истёк или отсутствует, refresh только в IndexedDB под ПИН
  if (await hasPinLock()) {
    if (token) await resolveAuthSessionFailure();
    else lockApp();
    return false;
  }

  if (token && expMs && expMs <= Date.now()) {
    clearToken({ logout: true });
    return false;
  }
  return Boolean(token);
}

export async function resolveAuthSessionFailure() {
  if (typeof window === "undefined") return "logout";
  if (await hasPinLock()) {
    clearToken({ keepPinLock: true });
    window.dispatchEvent(new Event("avt-app-lock-changed"));
    return "pin-lock";
  }
  clearToken({ logout: true });
  return "logout";
}

/** При загрузке страницы: валидный access или нужен экран ПИН. */
export async function bootstrapClientAuth() {
  await ensureFreshAccessToken().catch(() => null);
  if (hasValidAccessToken()) return { state: "token" };
  if (await hasPinLock()) {
    lockApp();
    window.dispatchEvent(new Event("avt-app-lock-changed"));
    return { state: "pin-lock" };
  }
  return { state: "anonymous" };
}

/**
 * GET /auth/me с продлением access и корректной обработкой 401 (ПИН не сбрасывается).
 * @returns {Promise<{ ok: true, user: object, accessToken: string } | { ok: false, status: number, kind: string }>}
 */
export async function fetchAuthMe() {
  await ensureFreshAccessToken().catch(() => null);
  let access = getStoredToken();
  if (!access || !hasValidAccessToken()) {
    if (await hasPinLock()) {
      lockApp();
      window.dispatchEvent(new Event("avt-app-lock-changed"));
      return { ok: false, status: 401, kind: "pin-lock" };
    }
    return { ok: false, status: 401, kind: "no-token" };
  }

  const load = () =>
    fetch(`${API_URL}/auth/me`, {
      headers: { Authorization: `Bearer ${access}` },
    });

  let res = await load();
  if (res.status === 401 && (await tryRefreshAccessToken())) {
    access = getStoredToken();
    if (access) res = await load();
  }
  if (res.status === 401) {
    const kind = await resolveAuthSessionFailure();
    return { ok: false, status: 401, kind };
  }
  if (!res.ok) return { ok: false, status: res.status, kind: "error" };
  const user = await res.json();
  return { ok: true, user, accessToken: getStoredToken() || access };
}

export async function rotatePinnedSession(pin) {
  await unlockWithPin(pin);
  await setupPin(pin);
}

function publicKeyCredentialToJSON(value) {
  if (value instanceof ArrayBuffer) return bufferToBase64Url(value);
  if (ArrayBuffer.isView(value)) return bufferToBase64Url(value.buffer);
  if (typeof PublicKeyCredential !== "undefined" && value instanceof PublicKeyCredential) {
    return {
      id: value.id,
      type: value.type,
      rawId: publicKeyCredentialToJSON(value.rawId),
      authenticatorAttachment: value.authenticatorAttachment,
      response: publicKeyCredentialToJSON(value.response),
      clientExtensionResults: value.getClientExtensionResults?.() || {},
    };
  }
  if (typeof AuthenticatorAttestationResponse !== "undefined" && value instanceof AuthenticatorAttestationResponse) {
    return {
      clientDataJSON: publicKeyCredentialToJSON(value.clientDataJSON),
      attestationObject: publicKeyCredentialToJSON(value.attestationObject),
      transports: value.getTransports?.() || [],
    };
  }
  if (typeof AuthenticatorAssertionResponse !== "undefined" && value instanceof AuthenticatorAssertionResponse) {
    return {
      clientDataJSON: publicKeyCredentialToJSON(value.clientDataJSON),
      authenticatorData: publicKeyCredentialToJSON(value.authenticatorData),
      signature: publicKeyCredentialToJSON(value.signature),
      userHandle: value.userHandle ? publicKeyCredentialToJSON(value.userHandle) : null,
    };
  }
  if (Array.isArray(value)) return value.map(publicKeyCredentialToJSON);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, publicKeyCredentialToJSON(item)])
    );
  }
  return value;
}

function prepareCreationOptions(options) {
  return {
    ...options,
    challenge: base64UrlToBuffer(options.challenge),
    user: { ...options.user, id: base64UrlToBuffer(options.user.id) },
    excludeCredentials: (options.excludeCredentials || []).map((cred) => ({
      ...cred,
      id: base64UrlToBuffer(cred.id),
    })),
  };
}

function prepareRequestOptions(options) {
  return {
    ...options,
    challenge: base64UrlToBuffer(options.challenge),
    allowCredentials: (options.allowCredentials || []).map((cred) => ({
      ...cred,
      id: base64UrlToBuffer(cred.id),
    })),
  };
}

export function canUseWebAuthn() {
  return typeof window !== "undefined" && "PublicKeyCredential" in window && navigator.credentials;
}

async function authFetch(url, options) {
  try {
    return await fetch(url, options);
  } catch (err) {
    throw new Error(
      "Не удалось связаться с сервером после биометрии. Проверьте HTTPS, NEXT_PUBLIC_API_URL и CORS для мобильного домена."
    );
  }
}

async function readApiError(res, fallback) {
  const body = await res.json().catch(() => null);
  if (body?.detail) return typeof body.detail === "string" ? body.detail : JSON.stringify(body.detail);
  return fallback;
}

export async function registerPasskey(accessToken) {
  const optionsRes = await authFetch(`${API_URL}/auth/webauthn/register/options`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify({ device_name: navigator.userAgent.slice(0, 120) }),
  });
  if (!optionsRes.ok) throw new Error(await readApiError(optionsRes, "Не удалось начать настройку биометрии"));
  const options = await optionsRes.json();
  const credential = await navigator.credentials.create({
    publicKey: prepareCreationOptions(options),
  });
  const verifyRes = await authFetch(`${API_URL}/auth/webauthn/register/verify`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify({
      challenge_id: options.challenge_id,
      credential: publicKeyCredentialToJSON(credential),
      device_name: navigator.userAgent.slice(0, 120),
    }),
  });
  if (!verifyRes.ok) throw new Error(await readApiError(verifyRes, "Не удалось сохранить биометрию"));
}

export async function loginWithPasskey() {
  const optionsRes = await authFetch(`${API_URL}/auth/webauthn/login/options`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ device_name: navigator.userAgent.slice(0, 120) }),
  });
  if (!optionsRes.ok) throw new Error(await readApiError(optionsRes, "Биометрический вход недоступен"));
  const options = await optionsRes.json();
  const credential = await navigator.credentials.get({
    publicKey: prepareRequestOptions(options),
  });
  const verifyRes = await authFetch(`${API_URL}/auth/webauthn/login/verify`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      challenge_id: options.challenge_id,
      credential: publicKeyCredentialToJSON(credential),
      device_name: navigator.userAgent.slice(0, 120),
    }),
  });
  if (!verifyRes.ok) throw new Error(await readApiError(verifyRes, "Не удалось войти по биометрии"));
  const data = await verifyRes.json();
  saveToken(data.access_token, data.refresh_token);
  return data.access_token;
}
