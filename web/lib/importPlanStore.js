/**
 * План импорта: UI-состояние + sync с сервером.
 * Оркестратор обхода живёт на backend (parser worker); здесь только CRUD/poll.
 */

import { getStoredToken } from "./auth";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";
export const IMPORT_PLAN_STORAGE_KEY = "avtovozom.importPlan.v2";
export const IMPORT_PLAN_MAX_RETRIES = 3;
const POLL_MS_RUNNING = 1500;
const POLL_MS_IDLE = 5000;
const SAVE_DEBOUNCE_MS = 600;

function newRowId() {
  if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID();
  return `row-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

export function emptyImportPlanRow() {
  return {
    id: newRowId(),
    marketplace: "che168",
    brandId: "",
    brandName: "",
    modelId: "",
    modelName: "",
    generationId: "",
    generationName: "",
    url: "",
    status: "pending",
    attempts: 0,
    message: "",
    jobId: null,
  };
}

function normalizeRow(r) {
  return {
    ...emptyImportPlanRow(),
    ...r,
    id: r?.id || newRowId(),
    brandId: r?.brandId != null ? String(r.brandId) : "",
    modelId: r?.modelId != null ? String(r.modelId) : "",
    generationId: r?.generationId != null ? String(r.generationId) : "",
    status: r?.status || "pending",
    attempts: Number(r?.attempts) || 0,
    jobId: r?.jobId ?? r?.job_id ?? null,
    message: r?.message || "",
  };
}

function rowFromApi(r) {
  return normalizeRow({
    id: r.id,
    marketplace: r.marketplace,
    brandId: r.brand_id,
    brandName: r.brand_name,
    modelId: r.model_id,
    modelName: r.model_name,
    generationId: r.generation_id,
    generationName: r.generation_name,
    url: r.url,
    status: r.status,
    attempts: r.attempts,
    message: r.message,
    jobId: r.job_id,
  });
}

function rowToApi(r) {
  const brandId = r.brandId ? Number(r.brandId) : null;
  const modelId = r.modelId ? Number(r.modelId) : null;
  const generationId = r.generationId ? Number(r.generationId) : null;
  return {
    id: r.id,
    marketplace: r.marketplace || "che168",
    brand_id: Number.isFinite(brandId) ? brandId : null,
    brand_name: r.brandName || "",
    model_id: Number.isFinite(modelId) ? modelId : null,
    model_name: r.modelName || "",
    generation_id: Number.isFinite(generationId) ? generationId : null,
    generation_name: r.generationName || "",
    url: String(r.url || "").trim(),
    status: r.status || "pending",
    attempts: Number(r.attempts) || 0,
    message: r.message || "",
    job_id: r.jobId ?? null,
  };
}

function applyApiPlan(data) {
  const rows = Array.isArray(data.rows) ? data.rows.map(rowFromApi) : [emptyImportPlanRow()];
  state = {
    ...state,
    rows: rows.length ? rows : [emptyImportPlanRow()],
    running: Boolean(data.running),
    banner: typeof data.banner === "string" ? data.banner : "",
    error: typeof data.error === "string" ? data.error : "",
    hydrated: true,
    status: data.status || (data.running ? "running" : "idle"),
  };
  emit(false);
}

const listeners = new Set();
let state = {
  rows: [emptyImportPlanRow()],
  running: false,
  banner: "",
  error: "",
  hydrated: false,
  status: "idle",
};
let token = "";
let pollTimer = null;
let saveTimer = null;
let savePromise = null;
let dirty = false;
let pollInFlight = false;

function emit(persistLocal = false) {
  if (persistLocal) {
    /* no-op: source of truth is server */
  }
  const snap = getImportPlanState();
  listeners.forEach((fn) => {
    try {
      fn(snap);
    } catch {
      /* ignore */
    }
  });
}

function setState(patch) {
  state = { ...state, ...patch };
  emit();
}

export function getImportPlanState() {
  return {
    rows: state.rows,
    running: state.running,
    banner: state.banner,
    error: state.error,
    hydrated: state.hydrated,
    status: state.status,
    activeJobId: null,
  };
}

export function subscribeImportPlan(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function setImportPlanToken(nextToken) {
  token = nextToken || "";
}

function authHeaders(json = false) {
  const stored = getStoredToken();
  if (stored) token = stored;
  const headers = { Authorization: `Bearer ${token}` };
  if (json) headers["Content-Type"] = "application/json";
  return headers;
}

async function apiGetPlan() {
  const res = await fetch(`${API_URL}/admin/import-plan`, { headers: authHeaders() });
  if (res.status === 401) {
    setState({ error: "Сессия истекла — войдите снова", running: false });
    return null;
  }
  if (!res.ok) {
    setState({ error: "Не удалось загрузить план импорта" });
    return null;
  }
  return res.json();
}

async function apiPutPlan(rows) {
  const res = await fetch(`${API_URL}/admin/import-plan`, {
    method: "PUT",
    headers: authHeaders(true),
    body: JSON.stringify({ rows: rows.map(rowToApi) }),
  });
  if (res.status === 401) {
    setState({ error: "Сессия истекла — войдите снова" });
    return null;
  }
  if (res.status === 409) {
    const data = await apiGetPlan();
    if (data) applyApiPlan(data);
    setState({ error: "План сейчас выполняется — правки заблокированы" });
    return null;
  }
  if (!res.ok) {
    let detail = "Не удалось сохранить план";
    try {
      const err = await res.json();
      if (err.detail) detail = typeof err.detail === "string" ? err.detail : detail;
    } catch {
      /* ignore */
    }
    setState({ error: detail });
    return null;
  }
  return res.json();
}

function schedulePoll() {
  if (typeof window === "undefined") return;
  if (pollTimer) clearTimeout(pollTimer);
  const ms = state.running ? POLL_MS_RUNNING : POLL_MS_IDLE;
  pollTimer = setTimeout(() => {
    refreshImportPlan().finally(() => schedulePoll());
  }, ms);
}

export function stopImportPlanPolling() {
  if (pollTimer) {
    clearTimeout(pollTimer);
    pollTimer = null;
  }
}

export async function refreshImportPlan() {
  if (!token && !getStoredToken()) return getImportPlanState();
  if (pollInFlight) return getImportPlanState();
  if (dirty) return getImportPlanState();
  pollInFlight = true;
  try {
    const data = await apiGetPlan();
    if (data) applyApiPlan(data);
  } finally {
    pollInFlight = false;
  }
  return getImportPlanState();
}

async function flushSave() {
  if (saveTimer) {
    clearTimeout(saveTimer);
    saveTimer = null;
  }
  if (!dirty || state.running) return;
  dirty = false;
  const rows = state.rows;
  savePromise = apiPutPlan(rows).then((data) => {
    if (data) applyApiPlan(data);
    return data;
  });
  await savePromise;
  savePromise = null;
}

function scheduleSave() {
  dirty = true;
  if (state.running) return;
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    flushSave().catch(() => null);
  }, SAVE_DEBOUNCE_MS);
}

export function setImportPlanRows(updater) {
  if (state.running) return;
  const next = typeof updater === "function" ? updater(state.rows) : updater;
  const rows = (Array.isArray(next) && next.length ? next : [emptyImportPlanRow()]).map(normalizeRow);
  setState({ rows, error: "" });
  scheduleSave();
}

export function patchImportPlanRow(id, patch) {
  if (state.running) return;
  setState({
    rows: state.rows.map((r) => (r.id === id ? normalizeRow({ ...r, ...patch }) : r)),
    error: "",
  });
  scheduleSave();
}

export function addImportPlanRow() {
  if (state.running) return;
  setState({ rows: [...state.rows, emptyImportPlanRow()], error: "" });
  scheduleSave();
}

export function removeImportPlanRow(id) {
  if (state.running) return;
  const next = state.rows.filter((r) => r.id !== id);
  setState({ rows: next.length ? next : [emptyImportPlanRow()], error: "" });
  scheduleSave();
}

export function clearFinishedImportPlanRows() {
  if (state.running) return;
  const next = state.rows.filter((r) => r.status !== "success");
  setState({ rows: next.length ? next : [emptyImportPlanRow()], error: "" });
  scheduleSave();
}

export async function startImportPlan(nextToken) {
  if (nextToken) token = nextToken;
  const stored = getStoredToken();
  if (stored) token = stored;
  if (!token) {
    setState({ error: "Сначала выполните вход" });
    return;
  }
  if (state.running) return;
  await flushSave();
  const res = await fetch(`${API_URL}/admin/import-plan/start`, {
    method: "POST",
    headers: authHeaders(),
  });
  if (res.status === 401) {
    setState({ error: "Сессия истекла — войдите снова" });
    return;
  }
  if (!res.ok) {
    setState({ error: "Не удалось запустить обход" });
    return;
  }
  const data = await res.json();
  applyApiPlan(data);
  schedulePoll();
}

export async function stopImportPlan() {
  if (!state.running) return;
  setState({ banner: "Остановка…" });
  const res = await fetch(`${API_URL}/admin/import-plan/stop`, {
    method: "POST",
    headers: authHeaders(),
  });
  if (res.ok) {
    applyApiPlan(await res.json());
  }
  schedulePoll();
}

function readLegacyLocalStorage() {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(IMPORT_PLAN_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return parsed.length ? parsed.map(normalizeRow) : null;
    }
    if (parsed && Array.isArray(parsed.rows) && parsed.rows.length) {
      return parsed.rows.map(normalizeRow);
    }
  } catch {
    /* ignore */
  }
  return null;
}

function clearLegacyLocalStorage() {
  if (typeof window === "undefined") return;
  try {
    localStorage.removeItem(IMPORT_PLAN_STORAGE_KEY);
  } catch {
    /* ignore */
  }
}

/**
 * Загрузить план с сервера; один раз мигрировать из localStorage, если сервер пуст.
 * Запускает polling.
 */
export async function bootstrapImportPlan(nextToken) {
  if (typeof window === "undefined") return getImportPlanState();
  if (nextToken) token = nextToken;
  const stored = getStoredToken();
  if (stored) token = stored;
  if (!token) return getImportPlanState();

  const data = await apiGetPlan();
  if (!data) {
    schedulePoll();
    return getImportPlanState();
  }

  const apiRows = Array.isArray(data.rows) ? data.rows : [];
  const serverEmpty =
    apiRows.length === 0 ||
    (apiRows.length === 1 &&
      !apiRows[0].model_id &&
      !String(apiRows[0].url || "").trim() &&
      (apiRows[0].status === "pending" || !apiRows[0].status));

  const legacy = readLegacyLocalStorage();
  if (serverEmpty && legacy && legacy.some((r) => r.modelId || String(r.url || "").trim())) {
    applyApiPlan({ ...data, rows: [], running: false, banner: "", error: "" });
    setState({ rows: legacy.map(normalizeRow), running: false, error: "" });
    dirty = true;
    await flushSave();
    clearLegacyLocalStorage();
  } else {
    applyApiPlan(data);
    if (legacy) clearLegacyLocalStorage();
  }

  schedulePoll();
  return getImportPlanState();
}
