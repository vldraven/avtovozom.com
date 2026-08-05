import Head from "next/head";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
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

/** Desktop mockup 37: 4 сегмента. API: new|1-3|3-5|5-7|over_7 — «< 3» ≈ до 3 лет (1-3). */
const AGE_SEGMENTS = [
  { value: "1-3", label: "< 3" },
  { value: "3-5", label: "3–5" },
  { value: "5-7", label: "5–7" },
  { value: "over_7", label: "7+" },
];

const AGE_OPTIONS = [
  { value: "new", label: "Новый" },
  { value: "1-3", label: "До 3 лет" },
  { value: "3-5", label: "3–5 лет" },
  { value: "5-7", label: "5–7 лет" },
  { value: "over_7", label: "Старше 7 лет" },
];

const OWNER_OPTIONS = [
  { value: "individual", label: "Физлицо" },
  { value: "company", label: "Юрлицо" },
];

const DEFAULT_FORM = {
  price: "10 000",
  currency: "USD",
  engine_capacity: "2000",
  engine_type: "gasoline",
  power: "150",
  age: "3-5",
  owner_type: "individual",
};

function parseApiError(body) {
  if (!body || typeof body !== "object") return "";
  if (typeof body.detail === "string") return body.detail;
  return "";
}

/** Группы по 3 цифры: 200000 → «200 000». */
function formatGroupedNumber(raw) {
  const s = String(raw ?? "").replace(/\s/g, "").replace(",", ".");
  if (!s) return "";
  const neg = s.startsWith("-");
  const body = neg ? s.slice(1) : s;
  const [intPart, fracPart] = body.split(".");
  if (!/^\d*$/.test(intPart || "")) return String(raw ?? "");
  const grouped = (intPart || "0").replace(/\B(?=(\d{3})+(?!\d))/g, " ");
  const withFrac = fracPart != null && fracPart !== "" ? `${grouped}.${fracPart}` : grouped;
  return neg ? `-${withFrac}` : withFrac;
}

function parseGroupedNumber(raw) {
  const s = String(raw ?? "")
    .replace(/\s/g, "")
    .replace(",", ".")
    .trim();
  if (!s) return "";
  if (!/^-?\d+(\.\d*)?$/.test(s)) return null;
  return s.replace(/\.$/, "");
}

function formatRub(n) {
  if (n == null || Number.isNaN(Number(n))) return "—";
  return `${formatGroupedNumber(Math.round(Number(n)))} ₽`;
}

function Segmented({ label, value, options, onChange, ariaLabel, fullWidth = true, columns }) {
  const cols = columns || options.length;
  return (
    <div className={`form-label${fullWidth ? " form-label--full" : ""}`}>
      {label ? <span className="form-label__text">{label}</span> : null}
      <div
        className={`seg-control seg-control--cols-${cols}`}
        role="radiogroup"
        aria-label={ariaLabel || label}
      >
        {options.map((opt) => (
          <button
            key={opt.value}
            type="button"
            role="radio"
            aria-checked={value === opt.value}
            className={`seg-control__btn${value === opt.value ? " is-active" : ""}`}
            onClick={() => onChange(opt.value)}
          >
            {opt.label}
          </button>
        ))}
      </div>
    </div>
  );
}

function ResultCard({ summary, isCompany, disclaimer }) {
  if (!summary) return null;
  return (
    <section className="customs-calc-result customs-calc-result--ink" aria-live="polite">
      <p className="customs-calc-result__eyebrow">Платежи при ввозе</p>
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
      {disclaimer ? (
        <p className="customs-calc-result__disclaimer customs-calc-result__disclaimer--in-card">
          {disclaimer}
        </p>
      ) : null}
    </section>
  );
}

function NextSteps({ compact }) {
  return (
    <section className={`customs-calc-next${compact ? " customs-calc-next--compact" : ""}`}>
      {!compact ? <p className="customs-calc-next__title">Что дальше</p> : null}
      <div className="customs-calc-next__actions">
        <Link href="/catalog" className="btn btn-primary">
          {compact ? "Показать авто" : "Показать авто под этот бюджет"}
        </Link>
        <Link href="/request-quote" className="btn btn-secondary">
          {compact ? "В заявку" : "Оставить заявку"}
        </Link>
      </div>
      {!compact ? (
        <p className="customs-calc-next__note muted">
          Оценка предварительная. Точная сумма фиксируется в договоре после выбора лота.
        </p>
      ) : null}
    </section>
  );
}

export default function CustomsCalculatorPage() {
  const [form, setForm] = useState(DEFAULT_FORM);
  const isElectric = form.engine_type === "electric";
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState(null);
  const [cbr, setCbr] = useState(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`${API_URL}/cars?limit=1`, { cache: "no-store" });
        if (!res.ok) return;
        const body = await res.json().catch(() => ({}));
        if (!cancelled && body?.cbr) setCbr(body.cbr);
      } catch {
        /* ignore */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

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

  function resetForm() {
    setForm(DEFAULT_FORM);
    setResult(null);
    setError("");
  }

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError("");
    setResult(null);
    try {
      const priceRaw = parseGroupedNumber(form.price);
      const payload = {
        price: Number(priceRaw),
        currency: form.currency.trim().toUpperCase(),
        engine_capacity: Number(form.engine_capacity),
        engine_type: form.engine_type,
        power: Number(form.power),
        age: form.age,
        owner_type: form.owner_type,
      };
      if (!priceRaw || !(payload.price > 0)) {
        setError("Укажите стоимость авто.");
        return;
      }
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

  const heroLead = useMemo(() => {
    if (cbr?.rate_date) {
      return `Пошлина, акциз и утильсбор по ставкам ФТС. Курс ЦБ на ${cbr.rate_date}.`;
    }
    return "Пошлина, акциз и утильсбор по ставкам ФТС. Оценка за минуту — точная сумма в договоре.";
  }, [cbr]);

  const rateLine = useMemo(() => {
    if (!cbr?.rate_date) return null;
    const cur = form.currency.trim().toUpperCase();
    if (cur === "CNY" && cbr.rub_per_cny != null) {
      return `Курс ЦБ на ${cbr.rate_date} · 1 CNY = ${Number(cbr.rub_per_cny).toLocaleString("ru-RU", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      })} ₽`;
    }
    return `Курс ЦБ на ${cbr.rate_date} · расчёт по официальным курсам`;
  }, [cbr, form.currency]);

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
            <h1 className="customs-calc-hero__title">Калькулятор растаможки</h1>
            <p className="muted customs-calc-hero__lead">{heroLead}</p>
          </header>

          <form className="customs-calc-form panel form-stack" onSubmit={submit}>
            <div className="customs-calc-fields">
              <div className="customs-calc-pair">
                <label className="form-label">
                  <span className="form-label__text">Стоимость авто</span>
                  <input
                    className="input"
                    type="text"
                    inputMode="decimal"
                    autoComplete="off"
                    value={form.price}
                    onChange={(e) => {
                      const next = parseGroupedNumber(e.target.value);
                      if (next === null) return;
                      setForm((p) => ({ ...p, price: formatGroupedNumber(next) }));
                    }}
                    required
                  />
                </label>
                <label className="form-label">
                  <span className="form-label__text">Валюта</span>
                  <SiteSelectDropdown
                    className="site-dropdown--block customs-calc-select"
                    label=""
                    ariaLabel="Валюта"
                    value={form.currency}
                    onChange={(v) => setForm((p) => ({ ...p, currency: String(v) }))}
                    options={CURRENCY_OPTIONS}
                  />
                </label>
              </div>

              <div className="customs-calc-pair">
                <label className="form-label">
                  <span className="form-label__text">
                    {isElectric ? "Объём ДВС, см³" : "Объём двигателя, см³"}
                  </span>
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
                    <span className="customs-calc-hint muted">
                      Для электромобиля укажите 0 — рабочего объёма ДВС нет.
                    </span>
                  ) : null}
                </label>
                <label className="form-label">
                  <span className="form-label__text">Мощность, л.с.</span>
                  <input
                    className="input"
                    type="number"
                    min="1"
                    value={form.power}
                    onChange={(e) => setForm((p) => ({ ...p, power: e.target.value }))}
                    required
                  />
                </label>
              </div>

              <Segmented
                label="Тип двигателя"
                value={form.engine_type}
                options={ENGINE_TYPE_OPTIONS}
                onChange={onEngineTypeChange}
              />

              <div className="customs-calc-pair customs-calc-only-mobile">
                <div className="form-label">
                  <SiteSelectDropdown
                    className="site-dropdown--block"
                    label="Возраст"
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

              <div className="customs-calc-pair customs-calc-only-desktop">
                <Segmented
                  label="Возраст авто"
                  value={AGE_SEGMENTS.some((a) => a.value === form.age) ? form.age : "1-3"}
                  options={AGE_SEGMENTS}
                  onChange={(v) => setForm((p) => ({ ...p, age: v }))}
                  fullWidth={false}
                />
                <Segmented
                  label="Кто ввозит"
                  value={form.owner_type}
                  options={OWNER_OPTIONS}
                  onChange={(v) => setForm((p) => ({ ...p, owner_type: v }))}
                  fullWidth={false}
                />
              </div>
            </div>

            <div className="customs-calc-form__footer">
              {rateLine ? <p className="customs-calc-rate muted">{rateLine}</p> : <span />}
              <div className="customs-calc-form__footer-actions">
                <button type="button" className="btn btn-secondary" onClick={resetForm}>
                  Сбросить
                </button>
                <button type="submit" className="btn btn-primary" disabled={busy}>
                  {busy ? "Считаем…" : "Рассчитать"}
                </button>
              </div>
            </div>
          </form>

          <aside className="customs-calc-aside">
            {error ? <div className="alert alert--danger customs-calc-alert">{error}</div> : null}

            {result && summary ? (
              <>
                <ResultCard summary={summary} isCompany={isCompany} />
                <p className="customs-calc-result__disclaimer customs-calc-only-mobile">
                  {result.disclaimer}
                </p>
                <div className="customs-calc-only-desktop">
                  <NextSteps />
                </div>
                <div className="customs-calc-mobile-cta customs-calc-only-mobile">
                  <NextSteps compact />
                </div>
              </>
            ) : result && !summary ? (
              <div className="alert alert--warn customs-calc-alert">
                Нет краткой разбивки в ответе API. Обновите backend.
              </div>
            ) : (
              <div className="customs-calc-placeholder customs-calc-only-desktop panel">
                <p className="customs-calc-placeholder__eyebrow">Платежи при ввозе</p>
                <p className="muted">
                  Заполните параметры и нажмите «Рассчитать» — здесь появится оценка пошлин и
                  утильсбора.
                </p>
              </div>
            )}
          </aside>
        </div>
      </main>
    </div>
  );
}
