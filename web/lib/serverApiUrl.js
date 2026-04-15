/**
 * База URL API для кода, выполняющегося на сервере Next (getServerSideProps, Route Handlers).
 * В Docker web-контейнере localhost:8000 — не backend; задайте SERVER_API_URL=http://backend:8000
 * (см. docker-compose.yml). В проде при публичном API достаточно NEXT_PUBLIC_API_URL.
 */
export function getServerApiBase() {
  const raw = (
    process.env.SERVER_API_URL ||
    process.env.NEXT_PUBLIC_API_URL ||
    "http://localhost:8000"
  ).trim();
  return raw.replace(/\/$/, "");
}
