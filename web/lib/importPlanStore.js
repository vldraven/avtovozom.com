/**
 * Глобальный store плана импорта: живёт между переходами по сайту,
 * сохраняется в localStorage и умеет продолжить обход после возврата / F5.
 */

import { getStoredToken } from "./auth";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";
export const IMPORT_PLAN_STORAGE_KEY = "avtovozom.importPlan.v2";
export const IMPORT_PLAN_MAX_RETRIES = 3;
const POLL_MS = 1500;

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
    status: r?.status || "pending",
    attempts: Number(r?.attempts) || 0,
    jobId: r?.jobId ?? null,
    message: r?.message || "",
  };
}

function loadPersisted() {
  if (typeof window === "undefined") {
    return { rows: [emptyImportPlanRow()], running: false, banner: "", error: "" };
  }
  try {
    const raw = localStorage.getItem(IMPORT_PLAN_STORAGE_KEY);
    if (!raw) return { rows: [emptyImportPlanRow()], running: false, banner: "", error: "" };
    const parsed = JSON.parse(raw);
    // v1 was a bare array
    if (Array.isArray(parsed)) {
      return {
        rows: parsed.length ? parsed.map(normalizeRow) : [emptyImportPlanRow()],
        running: false,
        banner: "",
        error: "",
      };
    }
    const rows = Array.isArray(parsed.rows) ? parsed.rows.map(normalizeRow) : [emptyImportPlanRow()];
    return {
      rows: rows.length ? rows : [emptyImportPlanRow()],
      running: Boolean(parsed.running),
      banner: typeof parsed.banner === "string" ? parsed.banner : "",
      error: typeof parsed.error === "string" ? parsed.error : "",
    };
  } catch {
    return { rows: [emptyImportPlanRow()], running: false, banner: "", error: "" };
  }
}

const listeners = new Set();
let state = {
  rows: [emptyImportPlanRow()],
  running: false,
  banner: "",
  error: "",
  hydrated: false,
};
let token = "";
let stopRequested = false;
let activeJobId = null;
let loopPromise = null;

function persist() {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(
      IMPORT_PLAN_STORAGE_KEY,
      JSON.stringify({
        rows: state.rows,
        running: state.running,
        banner: state.banner,
        error: state.error,
        savedAt: Date.now(),
      })
    );
  } catch {
    /* quota */
  }
}

function emit() {
  persist();
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
    activeJobId,
  };
}

export function subscribeImportPlan(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function setImportPlanToken(nextToken) {
  token = nextToken || "";
}

function patchRow(id, patch) {
  state = {
    ...state,
    rows: state.rows.map((r) => (r.id === id ? { ...r, ...patch } : r)),
  };
  emit();
}

function patchRowByJob(jobId, patch) {
  state = {
    ...state,
    rows: state.rows.map((r) =>
      r.jobId === jobId || (activeJobId === jobId && (r.status === "running" || r.status === "queued"))
        ? { ...r, ...patch }
        : r
    ),
  };
  emit();
}

export function setImportPlanRows(updater) {
  if (state.running) return;
  const next = typeof updater === "function" ? updater(state.rows) : updater;
  const rows = (Array.isArray(next) && next.length ? next : [emptyImportPlanRow()]).map(normalizeRow);
  setState({ rows, error: "" });
}

export function patchImportPlanRow(id, patch) {
  if (state.running) return;
  patchRow(id, patch);
}

export function addImportPlanRow() {
  if (state.running) return;
  setState({ rows: [...state.rows, emptyImportPlanRow()] });
}

export function removeImportPlanRow(id) {
  if (state.running) return;
  const next = state.rows.filter((r) => r.id !== id);
  setState({ rows: next.length ? next : [emptyImportPlanRow()] });
}

export function clearFinishedImportPlanRows() {
  if (state.running) return;
  const next = state.rows.filter((r) => r.status !== "success");
  setState({ rows: next.length ? next : [emptyImportPlanRow()] });
}

async function sleep(ms) {
  const step = 200;
  let left = ms;
  while (left > 0) {
    if (stopRequested) return;
    await new Promise((r) => setTimeout(r, Math.min(step, left)));
    left -= step;
  }
}

async function fetchJob(jobId) {
  const res = await fetch(`${API_URL}/admin/parser/jobs/${jobId}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) return { status: "failed", message: "Не удалось получить статус задачи", id: jobId };
  return res.json();
}

async function pollJob(jobId) {
  while (!stopRequested) {
    const job = await fetchJob(jobId);
    if (job.status === "queued" || job.status === "running") {
      patchRowByJob(jobId, { status: job.status, message: job.message || "" });
      await sleep(POLL_MS);
      continue;
    }
    return job;
  }
  return { status: "cancelled", message: "Остановлено", id: jobId };
}

function formatImportApiError(detail) {
  const raw = String(detail || "").trim();
  if (!raw) return "Не удалось запустить импорт";
  const lower = raw.toLowerCase();
  if (lower.includes("invalid or expired token") || lower.includes("not authenticated")) {
    return "Сессия истекла — войдите снова и перезапустите обход";
  }
  return raw;
}

async function importOneRow(row) {
  const stored = getStoredToken();
  if (stored) token = stored;
  const res = await fetch(`${API_URL}/admin/parser/import-listing`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      model_id: Number(row.modelId),
      che168_url: String(row.url || "").trim(),
      marketplace: row.marketplace,
      generation_id: row.generationId ? Number(row.generationId) : null,
    }),
  });
  if (!res.ok) {
    let detail = "Не удалось запустить импорт";
    try {
      const err = await res.json();
      if (err.detail) {
        detail = Array.isArray(err.detail)
          ? err.detail.map((x) => x.msg || x).join(" ")
          : String(err.detail);
      }
    } catch {
      /* ignore */
    }
    const message = formatImportApiError(detail);
    // 401 — нет смысла жечь все 3 попытки подряд
    return {
      status: "failed",
      message,
      id: null,
      authError: res.status === 401,
    };
  }
  return res.json();
}

async function cancelActiveJob() {
  if (!activeJobId || !token) return;
  try {
    await fetch(`${API_URL}/admin/parser/jobs/${activeJobId}/cancel`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
    });
  } catch {
    /* ignore */
  }
}

function queueRows(rows) {
  return rows.filter((r) => {
    if (!r.modelId || !String(r.url || "").trim()) return false;
    if (r.status === "success") return false;
    if (r.status === "failed" && r.attempts >= IMPORT_PLAN_MAX_RETRIES) return false;
    return true;
  });
}

/** Новый ручной старт: сбросить исчерпанные failed/cancelled, чтобы можно было повторить. */
function prepareRowsForFreshStart(rows) {
  return rows.map((r) => {
    if (r.status === "success") return r;
    if (r.status === "failed" || r.status === "cancelled") {
      return {
        ...r,
        status: "pending",
        attempts: 0,
        jobId: null,
        message: r.message
          ? `Повтор: ${String(r.message).replace(/^Повтор:\s*/, "")}`
          : "",
      };
    }
    // running/queued leftover without active loop — treat as pending
    if (r.status === "running" || r.status === "queued") {
      return { ...r, status: "pending", jobId: null, message: r.message || "" };
    }
    return r;
  });
}

async function finishActiveJobsIfAny() {
  const active = state.rows.filter(
    (r) => r.jobId && (r.status === "running" || r.status === "queued")
  );
  for (const row of active) {
    if (stopRequested) break;
    activeJobId = row.jobId;
    setState({
      banner: `Продолжаем задачу #${row.jobId}…`,
      running: true,
      error: "",
    });
    const finished = await pollJob(row.jobId);
    activeJobId = null;
    if (finished.status === "success") {
      patchRow(row.id, {
        status: "success",
        message: finished.message || "Готово",
        jobId: row.jobId,
      });
    } else if (finished.status === "cancelled" || stopRequested) {
      patchRow(row.id, {
        status: "cancelled",
        message: finished.message || "Остановлено",
        jobId: row.jobId,
      });
    } else {
      const attempts = row.attempts || 1;
      if (attempts >= IMPORT_PLAN_MAX_RETRIES) {
        patchRow(row.id, {
          status: "failed",
          attempts,
          message: finished.message || "Ошибка импорта",
          jobId: row.jobId,
        });
      } else {
        patchRow(row.id, {
          status: "pending",
          attempts,
          message: `${finished.message || "Ошибка"} · будет повтор`,
          jobId: row.jobId,
        });
      }
    }
  }
}

async function processRow(seed) {
  let attempts = Number(seed.attempts) || 0;
  // If already mid-retries from a previous run, continue counting up
  let done = false;

  while (!done && attempts < IMPORT_PLAN_MAX_RETRIES && !stopRequested) {
    attempts += 1;
    const current = state.rows.find((r) => r.id === seed.id) || seed;
    patchRow(seed.id, {
      status: "running",
      attempts,
      message: `Попытка ${attempts}/${IMPORT_PLAN_MAX_RETRIES}…`,
      jobId: null,
    });

    let job;
    try {
      job = await importOneRow(current);
    } catch {
      job = { status: "failed", message: "Сбой связи с API", id: null };
    }

    if (stopRequested) {
      patchRow(seed.id, {
        status: "cancelled",
        attempts,
        message: "Остановлено",
        jobId: job.id || null,
      });
      return;
    }

    if (!job.id || job.status === "failed") {
      const msg = job.message || "Ошибка запуска";
      if (job.authError) {
        patchRow(seed.id, { status: "failed", attempts, message: msg, jobId: null });
        setState({
          error: msg,
          banner: "Обход остановлен: нужна повторная авторизация.",
        });
        stopRequested = true;
        return;
      }
      if (attempts >= IMPORT_PLAN_MAX_RETRIES) {
        patchRow(seed.id, { status: "failed", attempts, message: msg, jobId: null });
        done = true;
      } else {
        patchRow(seed.id, {
          status: "pending",
          attempts,
          message: `${msg} · повтор ${attempts + 1}/${IMPORT_PLAN_MAX_RETRIES}…`,
        });
        await sleep(800);
      }
      continue;
    }

    activeJobId = job.id;
    patchRow(seed.id, {
      jobId: job.id,
      status: "running",
      attempts,
      message: job.message || "",
    });
    const finished = await pollJob(job.id);
    activeJobId = null;

    if (stopRequested || finished.status === "cancelled") {
      patchRow(seed.id, {
        status: "cancelled",
        attempts,
        message: finished.message || "Остановлено",
        jobId: job.id,
      });
      return;
    }

    if (finished.status === "success") {
      patchRow(seed.id, {
        status: "success",
        attempts,
        message: finished.message || "Готово",
        jobId: job.id,
      });
      done = true;
    } else {
      const msg = finished.message || "Ошибка импорта";
      if (attempts >= IMPORT_PLAN_MAX_RETRIES) {
        patchRow(seed.id, { status: "failed", attempts, message: msg, jobId: job.id });
        done = true;
      } else {
        patchRow(seed.id, {
          status: "pending",
          attempts,
          message: `${msg} · повтор ${attempts + 1}/${IMPORT_PLAN_MAX_RETRIES}…`,
          jobId: job.id,
        });
        await sleep(800);
      }
    }
  }
}

async function runLoop({ resume }) {
  if (!token) {
    setState({ running: false, error: "Нет токена авторизации — выполните вход" });
    return;
  }

  stopRequested = false;
  setState({ running: true, error: "", banner: resume ? "Возобновляем обход…" : state.banner });

  try {
    if (resume) {
      await finishActiveJobsIfAny();
      if (stopRequested) {
        setState({ running: false, banner: "Обход остановлен." });
        return;
      }
    } else {
      // Ручной «Запустить обход»: снова берём failed/cancelled строки
      const prepared = prepareRowsForFreshStart(state.rows);
      state = { ...state, rows: prepared };
      emit();
    }

    const queue = queueRows(state.rows);
    if (!queue.length) {
      const hasFailedExhausted = state.rows.some(
        (r) => r.status === "failed" && r.attempts >= IMPORT_PLAN_MAX_RETRIES
      );
      setState({
        running: false,
        banner: resume ? "Активных задач нет — обход завершён." : state.banner,
        error: resume
          ? ""
          : hasFailedExhausted
            ? "Нет строк для обхода. Нажмите «Запустить обход» ещё раз после входа, если сессия истекла."
            : "Добавьте строки с моделью и ссылкой (ещё не импортированные).",
      });
      return;
    }

    if (!resume) {
      setState({
        banner: `Старт: ${queue.length} объявлений в очереди (до ${IMPORT_PLAN_MAX_RETRIES} попыток на ссылку).`,
      });
    } else {
      setState({
        banner: `Продолжаем: осталось ${queue.length} (до ${IMPORT_PLAN_MAX_RETRIES} попыток на ссылку).`,
      });
    }

    for (const seed of queue) {
      if (stopRequested) break;
      // Skip if another concurrent update marked success
      const latest = state.rows.find((r) => r.id === seed.id);
      if (!latest || latest.status === "success") continue;
      if (latest.status === "failed" && latest.attempts >= IMPORT_PLAN_MAX_RETRIES) continue;
      await processRow(latest);
    }
  } finally {
    activeJobId = null;
    const stopped = stopRequested;
    stopRequested = false;
    setState({
      running: false,
      banner: stopped ? "Обход остановлен." : "Обход завершён.",
    });
    loopPromise = null;
  }
}

function ensureLoop(opts) {
  if (loopPromise) return loopPromise;
  loopPromise = runLoop(opts).catch((e) => {
    loopPromise = null;
    setState({
      running: false,
      error: e instanceof Error ? e.message : "Сбой обхода",
      banner: "",
    });
  });
  return loopPromise;
}

export function startImportPlan(nextToken) {
  if (nextToken) token = nextToken;
  const stored = getStoredToken();
  if (stored) token = stored;
  if (!token) {
    setState({ error: "Сначала выполните вход" });
    return;
  }
  if (state.running || loopPromise) return;
  ensureLoop({ resume: false });
}

export async function stopImportPlan() {
  if (!state.running && !loopPromise) return;
  stopRequested = true;
  setState({ banner: "Остановка…" });
  await cancelActiveJob();
}

/**
 * Подтянуть состояние из localStorage и при необходимости продолжить обход.
 * Безопасно вызывать при каждом заходе на страницу / из _app.
 */
export async function bootstrapImportPlan(nextToken) {
  if (typeof window === "undefined") return getImportPlanState();
  if (nextToken) token = nextToken;

  if (!state.hydrated) {
    const loaded = loadPersisted();
    state = {
      ...state,
      rows: loaded.rows,
      running: Boolean(loopPromise),
      banner: loaded.banner,
      error: loaded.error,
      hydrated: true,
    };
    emit();
  } else if (nextToken) {
    token = nextToken;
  }

  // Уже крутится цикл в этой вкладке
  if (loopPromise) {
    setState({ running: true });
    return getImportPlanState();
  }

  const persisted = loadPersisted();
  const hasActiveJobs = state.rows.some(
    (r) => r.jobId && (r.status === "running" || r.status === "queued")
  );
  const wasRunning = Boolean(persisted.running) || hasActiveJobs;

  if (token && wasRunning) {
    ensureLoop({ resume: true });
  }

  return getImportPlanState();
}
