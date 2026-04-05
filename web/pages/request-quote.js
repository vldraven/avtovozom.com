import Link from "next/link";
import { useRouter } from "next/router";
import { useEffect, useState } from "react";

import { publicCarHref } from "../lib/carRoutes";
import { mediaSrc } from "../lib/media";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

function parseApiDetail(body) {
  if (!body || typeof body !== "object") return null;
  const d = body.detail;
  if (typeof d === "string") return d;
  if (Array.isArray(d)) return d.map((x) => (typeof x === "object" && x.msg ? x.msg : JSON.stringify(x))).join("; ");
  return null;
}

export default function RequestQuotePage() {
  const router = useRouter();
  const rawCar = router.query.car_id;
  const carId =
    rawCar == null ? "" : String(Array.isArray(rawCar) ? rawCar[0] : rawCar).trim();
  const nextUrl =
    typeof router.query.next === "string" && router.query.next.startsWith("/")
      ? router.query.next
      : null;

  const [car, setCar] = useState(null);
  const [loadError, setLoadError] = useState("");
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [comment, setComment] = useState(
    "Нужен расчёт под ключ до РФ. Прошу уточнить сроки и стоимость доставки."
  );
  const [step, setStep] = useState("form");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    if (!router.isReady || !carId) return;
    (async () => {
      setLoadError("");
      const res = await fetch(`${API_URL}/cars/${carId}`);
      if (!res.ok) {
        setLoadError("Объявление не найдено или снято с публикации.");
        return;
      }
      setCar(await res.json());
    })();
  }, [router.isReady, carId]);

  async function submitLead(e) {
    e.preventDefault();
    setError("");
    setMessage("");
    setBusy(true);
    try {
      const res = await fetch(`${API_URL}/requests/lead`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: email.trim().toLowerCase(),
          phone: phone.trim(),
          full_name: fullName.trim(),
          car_id: Number(carId),
          comment: comment.trim(),
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        const d = parseApiDetail(body);
        setError(d || "Не удалось отправить заявку.");
        return;
      }
      setMessage(body.message || "Заявка принята.");
      setStep("verify");
    } finally {
      setBusy(false);
    }
  }

  async function verifyEmail() {
    setError("");
    setMessage("");
    setBusy(true);
    try {
      const res = await fetch(`${API_URL}/auth/register/verify`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: email.trim().toLowerCase(),
          code: code.trim(),
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        const d = parseApiDetail(body);
        setError(d || "Неверный или просроченный код.");
        return;
      }
      setStep("done");
      setMessage(
        body.message ||
          "Email подтверждён. Временный пароль отправлен на почту — войдите и при необходимости смените пароль в профиле."
      );
    } finally {
      setBusy(false);
    }
  }

  if (!router.isReady) {
    return (
      <div className="layout">
        <main className="site-main">
          <div className="container">
            <p className="muted">Загрузка…</p>
          </div>
        </main>
      </div>
    );
  }

  if (!carId) {
    return (
      <div className="layout">
        <header className="site-header">
          <div className="container site-header__inner">
            <Link href="/" className="site-logo">
              avtovozom
            </Link>
          </div>
        </header>
        <main className="site-main">
          <div className="container">
            <p>Не указан автомобиль. Вернитесь в <Link href="/">каталог</Link>.</p>
          </div>
        </main>
      </div>
    );
  }

  const backHref = nextUrl || (car ? publicCarHref(car) : "/");

  return (
    <div className="layout">
      <header className="site-header">
        <div className="container site-header__inner">
          <div className="site-header__brand">
            <Link href="/" className="site-logo">
              avtovozom
            </Link>
            <span className="site-tagline">Заявка на расчёт</span>
          </div>
          <div className="auth-bar">
            <Link href={backHref} className="btn btn-ghost btn-sm">
              ← Назад
            </Link>
            <Link href="/auth" className="btn btn-secondary btn-sm">
              Вход
            </Link>
          </div>
        </div>
      </header>
      <main className="site-main">
        <div className="container page-narrow">
          <h1 className="section-title">Заявка на расчёт</h1>

          {loadError && <div className="alert alert--danger">{loadError}</div>}
          {error && <div className="alert alert--danger">{error}</div>}
          {message && step !== "form" && <div className="alert alert--success">{message}</div>}

          {car && !loadError && (
            <div className="panel request-quote-car-panel">
              {(() => {
                const ph = car.photos?.length
                  ? [...car.photos].sort((a, b) => a.sort_order - b.sort_order)[0]
                  : null;
                return ph?.storage_url ? (
                <img
                  className="request-quote-car-panel__img"
                  src={mediaSrc(ph.storage_url)}
                  alt=""
                  width={96}
                  height={72}
                />
                ) : null;
              })()}
              <div>
                <div className="request-quote-car-panel__title">{car.title}</div>
                <div className="muted">
                  {car.brand} {car.model} · {car.year}
                </div>
              </div>
            </div>
          )}

          {step === "form" && car && (
            <form className="panel form-stack" onSubmit={submitLead}>
              <label className="muted form-label">
                Имя
                <input
                  className="input"
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  placeholder="Как к вам обращаться"
                  required
                />
              </label>
              <label className="muted form-label">
                Email
                <input
                  className="input"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="На этот адрес придёт код"
                  required
                />
              </label>
              <label className="muted form-label">
                Телефон
                <input
                  className="input"
                  type="tel"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="+7…"
                />
              </label>
              <label className="muted form-label">
                Комментарий к заявке
                <textarea className="input" rows={4} value={comment} onChange={(e) => setComment(e.target.value)} />
              </label>
              <button type="submit" className="btn btn-primary" disabled={busy}>
                {busy ? "Отправка…" : "Отправить заявку"}
              </button>
              <p className="muted request-quote-footnote">
                Уже есть аккаунт?{" "}
                <Link
                  href={`/auth?next=${encodeURIComponent(nextUrl || (car ? publicCarHref(car) : `/cars/${carId}`))}`}
                >
                  Войдите
                </Link>{" "}
                и
                отправьте заявку в один клик.
              </p>
            </form>
          )}

          {step === "verify" && (
            <div className="panel form-stack">
              <h2 className="section-title verify-panel-title">Подтвердите email</h2>
              <p className="muted verify-panel-intro">
                Введите код из письма, отправленного на <strong>{email.trim().toLowerCase()}</strong>.
              </p>
              <input
                className="input"
                placeholder="Код из письма"
                value={code}
                onChange={(e) => setCode(e.target.value)}
                autoComplete="one-time-code"
              />
              <button type="button" className="btn btn-primary" disabled={busy || !code.trim()} onClick={verifyEmail}>
                {busy ? "Проверка…" : "Подтвердить"}
              </button>
            </div>
          )}

          {step === "done" && (
            <div className="panel form-stack">
              <Link
                href={`/auth?next=${encodeURIComponent(nextUrl || (car ? publicCarHref(car) : `/cars/${carId}`))}`}
                className="btn btn-primary"
              >
                Перейти ко входу
              </Link>
              <Link href={nextUrl || (car ? publicCarHref(car) : `/cars/${carId}`)} className="btn btn-secondary">
                Вернуться к объявлению
              </Link>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
