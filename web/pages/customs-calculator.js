import Head from "next/head";
import Link from "next/link";
import { useState } from "react";
import SiteSelectDropdown from "../components/SiteSelectDropdown";
import { absoluteUrl } from "../lib/siteUrl";
import SiteHeader from "../components/SiteHeader";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";
const CURRENCY_OPTIONS = [
  { value: "USD", label: "USD" },
  { value: "EUR", label: "EUR" },
  { value: "CNY", label: "CNY" },
  { value: "RUB", label: "RUB" },
];
const ENGINE_TYPE_OPTIONS = [
  { value: "gasoline", label: "Бензин" },
  { value: "diesel", label: "Дизель" },
  { value: "electric", label: "Электро" },
  { value: "hybrid", label: "Гибрид" },
];
const AGE_OPTIONS = [
  { value: "new", label: "Новый" },
  { value: "1-3", label: "1–3 года" },
  { value: "3-5", label: "3–5 лет" },
  { value: "5-7", label: "5–7 лет" },
  { value: "over_7", label: "Старше 7 лет" },
];
const OWNER_OPTIONS = [
  { value: "individual", label: "Физлицо" },
  { value: "company", label: "Юрлицо" },
];

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

  const isElectric = form.engine_type === "electric";
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState(null);

  function onEngineTypeChange(t) {
    setForm((p) => {
      if (t === "electric") {
        return { ...p, engine_type: t, engine_capacity: "0" };
      }
      if (p.engine_type === "electric" && (p.engine_capacity === "0" || p.engine_capacity === "")) {
        return { ...p, engine_type: t, engine_capacity: "2000" };
      }
      return { ...p, engine_type: t };
    });
  }

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
      <Head>
        <title>Калькулятор растаможки авто из Китая | avtovozom</title>
        <meta
          name="description"
          content="Бесплатный калькулятор растаможки авто в РФ: пошлина, акциз, утильсбор для физлица и юрлица. Оцените платежи за минуту."
        />
        <link rel="canonical" href={absoluteUrl("/customs-calculator")} />
        <meta property="og:title" content="Калькулятор растаможки авто из Китая | avtovozom" />
        <meta
          property="og:description"
          content="Оценка таможенных платежей и утильсбора для ввоза автомобиля в РФ."
        />
        <meta property="og:url" content={absoluteUrl("/customs-calculator")} />
      </Head>
      <SiteHeader tagline="Растаможка">
          <Link href="/catalog" className="btn btn-ghost btn-sm">
            Каталог
          </Link>
          <Link href="/request-quote" className="btn btn-secondary btn-sm">
            Заявка
          </Link>
        </SiteHeader>
      <main className="site-main">
        <div className="container customs-calc-page">
          <header className="customs-calc-hero">
            <h1 className="section-title">Калькулятор растаможки</h1>
            <p className="muted customs-calc-hero__lead">
              Оцените пошлину, утильсбор и оформление за минуту. Это ориентир — точный расчёт под ключ
              дадим по заявке.
            </p>
          </header>
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
              <div className="form-label">
                <SiteSelectDropdown
                  className="site-dropdown--block"
                  label="Валюта"
                  value={form.currency}
                  onChange={(v) => setForm((p) => ({ ...p, currency: String(v) }))}
                  options={CURRENCY_OPTIONS}
                />
              </div>
              <label className="form-label">
                {isElectric ? "Объём ДВС, см³" : "Объём двигателя, см³"}
                <input
                  className="input"
                  type="number"
                  min={isElectric ? "0" : "50"}
                  step="1"
                  value={form.engine_capacity}
                  onChange={(e) => setForm((p) => ({ ...p, engine_capacity: e.target.value }))}
                  required
                />
                {isElectric ? (
                  <span className="muted" style={{ display: "block", marginTop: "0.35rem", fontSize: "0.88rem", lineHeight: 1.4 }}>
                    Для электромобиля рабочего объёма ДВС нет — укажите 0. Поле нужно для бензина, дизеля и гибрида.
                  </span>
                ) : null}
              </label>
              <div className="form-label form-label--full">
                <span className="form-label__text">Тип двигателя</span>
                <div className="seg-control" role="radiogroup" aria-label="Тип двигателя">
                  {ENGINE_TYPE_OPTIONS.map((opt) => (
                    <button
                      key={opt.value}
                      type="button"
                      role="radio"
                      aria-checked={form.engine_type === opt.value}
                      className={`seg-control__btn${form.engine_type === opt.value ? " is-active" : ""}`}
                      onClick={() => onEngineTypeChange(opt.value)}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>
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
              <div className="form-label">
                <SiteSelectDropdown
                  className="site-dropdown--block"
                  label="Возраст авто"
                  value={form.age}
                  onChange={(v) => setForm((p) => ({ ...p, age: String(v) }))}
                  options={AGE_OPTIONS}
                />
              </div>
              <div className="form-label">
                <SiteSelectDropdown
                  className="site-dropdown--block"
                  label="Кто ввозит"
                  value={form.owner_type}
                  onChange={(v) => setForm((p) => ({ ...p, owner_type: String(v) }))}
                  options={OWNER_OPTIONS}
                />
              </div>
            </div>
            <button type="submit" className="btn btn-primary" disabled={busy}>
              {busy ? "Считаем…" : "Рассчитать"}
            </button>
          </form>

          {error ? <div className="alert alert--danger customs-calc-alert">{error}</div> : null}

          {result && summary ? (
            <section className="customs-calc-result customs-calc-result--ink">
              <p className="customs-calc-result__eyebrow">Оценка платежей</p>
              <h2 className="customs-calc-result__title">Платежи при ввозе</h2>
              <dl className="customs-calc-result__list">
                {[
                  ["Таможенное оформление", summary.clearance_fee_rub],
                  [isCompany ? "Пошлина, акциз и НДС (оценка)" : "Таможенная пошлина", summary.duty_rub],
                  ["Утилизационный сбор", summary.utilization_fee_rub],
                ].map(([label, val]) => (
                  <div key={label} className="customs-calc-result__row">
                    <dt>{label}</dt>
                    <dd>{formatRub(val)}</dd>
                  </div>
                ))}
                <div className="customs-calc-result__row customs-calc-result__row--total">
                  <dt>Итого</dt>
                  <dd>{formatRub(summary.total_rub)}</dd>
                </div>
              </dl>
              <p className="customs-calc-result__disclaimer">{result.disclaimer}</p>
              <div className="customs-calc-result__actions">
                <Link href="/catalog" className="btn btn-primary btn-sm">
                  В каталог
                </Link>
                <Link href="/request-quote" className="btn btn-outline-accent btn-sm">
                  Заявка на подбор
                </Link>
              </div>
            </section>
          ) : result && !summary ? (
            <div className="alert alert--warn customs-calc-alert">
              Нет краткой разбивки в ответе API. Обновите backend.
            </div>
          ) : null}
        </div>
      </main>
    </div>
  );
}
