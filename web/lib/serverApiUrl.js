/**
 * База URL API для кода, выполняющегося на сервере Next (getServerSideProps, Route Handlers).
 * В Docker web-контейнере задайте SERVER_API_URL=http://backend:8000 (dev и prod compose),
 * иначе SSR пойдёт на публичный NEXT_PUBLIC_API_URL через Caddy и может висеть до 300s.
 */
export function getServerApiBase() {
  const raw = (
    process.env.SERVER_API_URL ||
    process.env.NEXT_PUBLIC_API_URL ||
    "http://localhost:8000"
  ).trim();
  return raw.replace(/\/$/, "");
}

/** Таймаут SSR→API: лучше отдать пустые props / клиентский догруз, чем ждать Caddy 504. */
export const SERVER_FETCH_TIMEOUT_MS = 8_000;

export function serverFetch(url, init = {}) {
  const timeoutMs = Number(init.timeoutMs) > 0 ? Number(init.timeoutMs) : SERVER_FETCH_TIMEOUT_MS;
  const { timeoutMs: _drop, signal: outerSignal, ...rest } = init;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  if (outerSignal) {
    if (outerSignal.aborted) controller.abort();
    else outerSignal.addEventListener("abort", () => controller.abort(), { once: true });
  }
  return fetch(url, { ...rest, signal: controller.signal }).finally(() => clearTimeout(timer));
}
