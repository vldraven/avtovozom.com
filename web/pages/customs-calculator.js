import Link from "next/link";
import { useState } from "react";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

function parseApiError(body) {
  if (!body || typeof body !== "object") return "";
  if (typeof body.detail === "string") return body.detail;
  return "";
}

function formatRub(n) {
  if (n == null || Number.isNaN(Number(n))) return "—";
  return `${Number(n).toLocaleString("ru-RU", { minimumFractionDigits: 0, maximumFractionDigits: 0 })} ₽`;
}

export default function CustomsCalculatorPage() {
  const [form, setForm] = useState({
    price: "10000",
    currency: "USD",
    engine_capacity: "2000",
    engine_type: "gasoline",
    power: "150",
    age: "5-7",
    owner_type: "individual",
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState(null);

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError("");
    setResult(null);
    try {
      const payload = {
        price: Number(form.price),
        currency: form.currency.trim().toUpperCase(),
        engine_capacity: Number(form.engine_capacity),
        engine_type: form.engine_type,
        power: Number(form.power),
        age: form.age,
        owner_type: form.owner_type,
      };
      const res = await fetch(`${API_URL}/public/customs-calculator/estimate`, {
        method: "POST",
        cache: "no-store",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(parseApiError(body) || "Не удалось выполнить расчёт.");
        return;
      }
      setResult(body);
    } finally {
      setBusy(false);
    }
  }

  const summary = result?.summary;
  const isCompany = result?.primary_mode === "ctp";

  return (
    <div className="layout">
      <header className="site-header">
        <div className="container site-header__inner">
          <Link href="/" className="site-logo">
            avtovozom
          </Link>
          <div className="auth-bar">
            <Link href="/profile" className="btn btn-ghost btn-sm">
              Профиль
            </Link>
          </div>
        </div>
      </header>
      <main className="site-main">
        <div className="container" style={{ maxWidth: 560 }}>
          <h1 className="section-title">Калькулятор растаможки</h1>
          <p className="muted" style={{ marginTop: "-0.35rem", marginBottom: "1rem", fontSize: "0.95rem", lineHeight: 1.45 }}>
            Ориентировочный расчёт для сравнения вариантов. Окончательные суммы определяет таможня.
          </p>
          <form className="panel form-stack" onSubmit={submit}>
            <div className="profile-field-grid">
              <label className="form-label">
                Стоимость авто
                <input
                  className="input"
                  type="number"
                  min="1"
                  step="0.01"
                  value={form.price}
                  onChange={(e) => setForm((p) => ({ ...p, price: e.target.value }))}
                  required
                />
              </label>
              <label className="form-label">
                Валюта
                <select
                  className="input"
                  value={form.currency}
                  onChange={(e) => setForm((p) => ({ ...p, currency: e.target.value }))}
                >
                  <option value="USD">USD</option>
                  <option value="EUR">EUR</option>
                  <option value="CNY">CNY</option>
                  <option value="RUB">RUB</option>
                </select>
              </label>
              <label className="form-label">
                Объём двигателя, см³
                <input
                  className="input"
                  type="number"
                  min="50"
                  value={form.engine_capacity}
                  onChange={(e) => setForm((p) => ({ ...p, engine_capacity: e.target.value }))}
                  required
                />
              </label>
              <label className="form-label">
                Тип двигателя
                <select
                  className="input"
                  value={form.engine_type}
                  onChange={(e) => setForm((p) => ({ ...p, engine_type: e.target.value }))}
                >
                  <option value="gasoline">Бензин</option>
                  <option value="diesel">Дизель</option>
                  <option value="electric">Электро</option>
                  <option value="hybrid">Гибрид</option>
                </select>
              </label>
              <label className="form-label">
                Мощность, л.с.
                <input
                  className="input"
                  type="number"
                  min="1"
                  value={form.power}
                  onChange={(e) => setForm((p) => ({ ...p, power: e.target.value }))}
                  required
                />
              </label>
              <label className="form-label">
                Возраст авто
                <select className="input" value={form.age} onChange={(e) => setForm((p) => ({ ...p, age: e.target.value }))}>
                  <option value="new">Новый</option>
                  <option value="1-3">1–3 года</option>
                  <option value="3-5">3–5 лет</option>
                  <option value="5-7">5–7 лет</option>
                  <option value="over_7">Старше 7 лет</option>
                </select>
              </label>
              <label className="form-label">
                Кто ввозит
                <select
                  className="input"
                  value={form.owner_type}
                  onChange={(e) => setForm((p) => ({ ...p, owner_type: e.target.value }))}
                >
                  <option value="individual">Физлицо</option>
                  <option value="company">Юрлицо</option>
                </select>
              </label>
            </div>
            <button type="submit" className="btn btn-primary" disabled={busy}>
              {busy ? "Считаем…" : "Рассчитать"}
            </button>
          </form>

          {error ? <div className="alert alert--danger" style={{ marginTop: "1rem" }}>{error}</div> : null}

          {result && summary ? (
            <section className="panel" style={{ marginTop: "1rem" }}>
              <h2 className="section-title panel-heading-sm" style={{ marginTop: 0 }}>
                Результат
              </h2>
              <dl
                style={{
                  margin: 0,
                  display: "grid",
                  gap: "0.65rem",
                  fontSize: "1rem",
                }}
              >
                {[
                  ["Таможенное оформление", summary.clearance_fee_rub],
                  [isCompany ? "Пошлина, акциз и НДС (оценка)" : "Таможенная пошлина", summary.duty_rub],
                  ["Утилизационный сбор", summary.utilization_fee_rub],
                ].map(([label, val]) => (
                  <div
                    key={label}
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      gap: "1rem",
                      alignItems: "baseline",
                      borderBottom: "1px solid var(--border-subtle, rgba(0,0,0,0.08))",
                      paddingBottom: "0.5rem",
                    }}
                  >
                    <dt style={{ margin: 0, fontWeight: 500, color: "var(--text-muted, #666)" }}>{label}</dt>
                    <dd style={{ margin: 0, fontWeight: 600, whiteSpace: "nowrap" }}>{formatRub(val)}</dd>
                  </div>
                ))}
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    gap: "1rem",
                    alignItems: "baseline",
                    paddingTop: "0.25rem",
                  }}
                >
                  <dt style={{ margin: 0, fontWeight: 700 }}>Итого</dt>
                  <dd style={{ margin: 0, fontWeight: 700, fontSize: "1.1rem", whiteSpace: "nowrap" }}>
                    {formatRub(summary.total_rub)}
                  </dd>
                </div>
              </dl>
              <p className="muted" style={{ marginTop: "1rem", marginBottom: 0, fontSize: "0.9rem", lineHeight: 1.45 }}>
                {result.disclaimer}
              </p>
            </section>
          ) : result && !summary ? (
            <div className="alert alert--warn" style={{ marginTop: "1rem" }}>
              Нет краткой разбивки в ответе API. Обновите backend.
            </div>
          ) : null}
        </div>
      </main>
    </div>
  );
}
