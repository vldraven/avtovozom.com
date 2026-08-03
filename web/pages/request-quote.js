import Link from "next/link";
import { useRouter } from "next/router";
import { useEffect, useState } from "react";

import { publicCarHref } from "../lib/carRoutes";
import { saveToken } from "../lib/auth";
import { mediaSrc } from "../lib/media";
import { formatRuPhoneMask, normalizeRuPhoneDigits, phoneDigitsToApi } from "../lib/ruPhoneMask";
import SiteHeader from "../components/SiteHeader";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

function parseApiDetail(body) {
  if (!body || typeof body !== "object") return null;
  const d = body.detail;
  if (typeof d === "string") return d;
  if (Array.isArray(d)) return d.map((x) => (typeof x === "object" && x.msg ? x.msg : JSON.stringify(x))).join("; ");
  return null;
}

function packQuoteComment({ comment, city }) {
  const parts = [];
  if (city.trim()) parts.push(`Город получения: ${city.trim()}`);
  const meta = parts.join("\n");
  const body = comment.trim();
  if (meta && body) return `${meta}\n\n${body}`;
  return meta || body;
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
  /** Старт с «7», чтобы сразу видеть +7 и маску (можно стереть полностью). */
  const [phoneDigits, setPhoneDigits] = useState("7");
  const [city, setCity] = useState("");
  const [comment, setComment] = useState(
    "Нужен расчёт под ключ до РФ. Прошу уточнить сроки и стоимость доставки."
  );
  const [step, setStep] = useState("form");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  /** После verify: если есть JWT — пользователь уже в авторизованной зоне. */
  const [verifyMode, setVerifyMode] = useState(null);
  const [pendingPlatformChatId, setPendingPlatformChatId] = useState(null);

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
      const endpoint = carId ? "/requests/lead" : "/requests/freeform-lead";
      const packedComment = packQuoteComment({ comment, city });
      const payload = {
        email: email.trim().toLowerCase(),
        phone: phoneDigitsToApi(phoneDigits).trim(),
        full_name: fullName.trim(),
        comment: packedComment,
      };
      if (carId) payload.car_id = Number(carId);
      const res = await fetch(`${API_URL}${endpoint}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        const d = parseApiDetail(body);
        setError(d || "Не удалось отправить заявку.");
        return;
      }
      setMessage(body.message || "Заявка принята.");
      if (body.platform_chat_id != null) {
        setPendingPlatformChatId(body.platform_chat_id);
      }
      if (!carId) {
        setStep("done");
        setVerifyMode("freeform");
        return;
      }
      setVerifyMode(null);
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
      if (body.access_token) {
        saveToken(body.access_token, body.refresh_token);
        setVerifyMode("authed");
        setMessage(
          body.message ||
            "Код подтверждён. Вы вошли в аккаунт — заявка в разделе «Мои заявки на расчёт»."
        );
      } else {
        setVerifyMode("new");
        setMessage(
          body.message ||
            "Email подтверждён. Временный пароль отправлен на почту — войдите и при необходимости смените пароль в профиле."
        );
      }
      setStep("done");
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

  const backHref = nextUrl || (car ? publicCarHref(car) : "/");

  return (
    <div className="layout">
      <SiteHeader tagline="Заявка на подбор">
          <Link href={backHref} className="btn btn-ghost btn-sm">
            ← Назад
          </Link>
          <Link href="/auth" className="btn btn-secondary btn-sm">
            Вход
          </Link>
        </SiteHeader>
      <main className="site-main">
        <div className="container page-narrow request-quote-page">
          <header className="request-quote-hero">
            <h1 className="section-title">Заявка на подбор</h1>
            <p className="muted request-quote-hero__lead">
              Опишите задачу — подготовим ориентир под ключ и ответим в чате. Аккаунт не обязателен.
            </p>
          </header>

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

          {step === "form" && (car || !carId) && (
            <>
              <aside className="request-quote-benefits" aria-label="Что вы получите">
                <h2 className="request-quote-benefits__title">Что вы получите</h2>
                <ul className="request-quote-benefits__list">
                  <li>Ориентир стоимости под ключ до РФ</li>
                  <li>Подбор и проверка вариантов</li>
                  <li>Чат по сделке после заявки</li>
                </ul>
              </aside>

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
                    inputMode="numeric"
                    autoComplete="tel"
                    value={formatRuPhoneMask(phoneDigits)}
                    onChange={(e) => setPhoneDigits(normalizeRuPhoneDigits(e.target.value))}
                    placeholder="+7 (999) 123-45-67"
                  />
                </label>

                <label className="muted form-label">
                  Город получения
                  <input
                    className="input"
                    value={city}
                    onChange={(e) => setCity(e.target.value)}
                    placeholder="Москва"
                    autoComplete="address-level2"
                  />
                </label>

                <label className="muted form-label">
                  {carId ? "Комментарий к заявке" : "Какой автомобиль вас интересует"}
                  <textarea
                    className="input"
                    rows={4}
                    value={comment}
                    onChange={(e) => setComment(e.target.value)}
                    placeholder="Например: BMW X5, 2021-2023, бензин, нужна доставка под ключ."
                    required={!carId}
                  />
                </label>
                <button type="submit" className="btn btn-primary" disabled={busy}>
                  {busy ? "Отправка…" : "Отправить заявку"}
                </button>
                <p className="muted request-quote-footnote">
                  Нажимая кнопку, вы соглашаетесь на обработку данных для связи по заявке. Уже есть аккаунт?{" "}
                  <Link
                    href={`/auth?next=${encodeURIComponent(nextUrl || (car ? publicCarHref(car) : "/"))}`}
                  >
                    Войдите
                  </Link>{" "}
                  и отправьте заявку в один клик.
                </p>
              </form>
            </>
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
              {verifyMode === "freeform" ? (
                <Link href="/" className="btn btn-primary">
                  На главную
                </Link>
              ) : verifyMode === "authed" ? (
                <Link
                  href={
                    pendingPlatformChatId != null
                      ? `/messages?chat=${encodeURIComponent(String(pendingPlatformChatId))}`
                      : "/messages"
                  }
                  className="btn btn-primary"
                >
                  Открыть чат с Avtovozom
                </Link>
              ) : (
                <Link
                  href={`/auth?next=${encodeURIComponent(nextUrl || (car ? publicCarHref(car) : "/"))}`}
                  className="btn btn-primary"
                >
                  Перейти ко входу
                </Link>
              )}
              {car ? (
                <Link href={nextUrl || publicCarHref(car)} className="btn btn-secondary">
                  Вернуться к объявлению
                </Link>
              ) : null}
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
