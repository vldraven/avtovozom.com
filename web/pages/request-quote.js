import Link from "next/link";
import { useRouter } from "next/router";
import { useEffect, useState } from "react";

import SiteHeader from "../components/SiteHeader";
import { saveToken } from "../lib/auth";
import { publicCarHref } from "../lib/carRoutes";
import { MEDIA_WIDTH, mediaSrc } from "../lib/media";
import { formatRuPhoneMask, normalizeRuPhoneDigits, phoneDigitsToApi } from "../lib/ruPhoneMask";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

const NEXT_STEPS = [
  {
    n: "01",
    title: "Расчёт стоимости до вашего города",
    text: "В течение 2 часов в рабочее время",
  },
  {
    n: "02",
    title: "Подходящие варианты",
    text: "С фото и ключевыми параметрами",
  },
  {
    n: "03",
    title: "Чат с менеджером",
    text: "Ответы по срокам, доставке и условиям",
  },
];

const BENEFITS = [
  "Расчёт стоимости до вашего города",
  "Подходящие варианты под задачу",
  "Чат с менеджером по заявке",
];

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
  const carId = rawCar == null ? "" : String(Array.isArray(rawCar) ? rawCar[0] : rawCar).trim();
  const nextUrl =
    typeof router.query.next === "string" && router.query.next.startsWith("/") ? router.query.next : null;

  const [car, setCar] = useState(null);
  const [loadError, setLoadError] = useState("");
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  /** Старт с «7», чтобы сразу видеть +7 и маску (можно стереть полностью). */
  const [phoneDigits, setPhoneDigits] = useState("7");
  const [city, setCity] = useState("");
  const [comment, setComment] = useState(
    "Нужен расчёт доставки и растаможки до РФ. Прошу уточнить сроки и стоимость."
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
  const authNext = nextUrl || (car ? publicCarHref(car) : "/");

  return (
    <div className="layout request-quote-layout-root">
      <SiteHeader tagline="Заявка на подбор">
        <Link href={backHref} className="btn btn-ghost btn-sm">
          ← Назад
        </Link>
        <Link href={`/auth?next=${encodeURIComponent(authNext)}`} className="btn btn-secondary btn-sm">
          Вход
        </Link>
      </SiteHeader>
      <main className="site-main">
        <div className="container request-quote-page">
          {loadError ? <div className="alert alert--danger">{loadError}</div> : null}
          {error ? <div className="alert alert--danger">{error}</div> : null}
          {message && step !== "form" ? <div className="alert alert--success">{message}</div> : null}

          {step === "form" && (car || !carId) ? (
            <div className="request-quote-shell">
              <div className="request-quote-main">
                <header className="request-quote-hero">
                  <h1 className="request-quote-hero__title">Заявка на подбор</h1>
                  <p className="request-quote-hero__lead muted">
                    Опишите, что ищете — вернёмся со сметой и вариантами в течение 2 часов.
                  </p>
                </header>

                {car && !loadError ? (
                  <div className="request-quote-car-panel">
                    {(() => {
                      const ph = car.photos?.length
                        ? [...car.photos].sort((a, b) => a.sort_order - b.sort_order)[0]
                        : null;
                      return ph?.storage_url ? (
                        <img
                          className="request-quote-car-panel__img"
                          src={mediaSrc(ph.storage_url, MEDIA_WIDTH.card)}
                          alt=""
                          width={112}
                          height={84}
                        />
                      ) : null;
                    })()}
                    <div>
                      <div className="request-quote-car-panel__title">{car.title}</div>
                      <div className="muted request-quote-car-panel__meta">
                        {car.brand} {car.model} · {car.year}
                      </div>
                    </div>
                  </div>
                ) : null}

                <form className="request-quote-form" onSubmit={submitLead}>
                  <div className="request-quote-fields">
                    <label className="request-quote-field">
                      <span className="request-quote-field__label">Имя</span>
                      <input
                        className="input"
                        value={fullName}
                        onChange={(e) => setFullName(e.target.value)}
                        placeholder="Как к вам обращаться"
                        autoComplete="name"
                        required
                      />
                    </label>
                    <label className="request-quote-field">
                      <span className="request-quote-field__label">Email</span>
                      <input
                        className="input"
                        type="email"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        placeholder="На этот адрес придёт код"
                        autoComplete="email"
                        required
                      />
                    </label>
                    <label className="request-quote-field">
                      <span className="request-quote-field__label">Телефон</span>
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
                    <label className="request-quote-field">
                      <span className="request-quote-field__label">Город получения</span>
                      <input
                        className="input"
                        value={city}
                        onChange={(e) => setCity(e.target.value)}
                        placeholder="Москва"
                        autoComplete="address-level2"
                      />
                    </label>
                    <label className="request-quote-field request-quote-field--full">
                      <span className="request-quote-field__label">
                        {carId ? "Комментарий к заявке" : "Какой автомобиль вас интересует"}
                      </span>
                      <textarea
                        className="input"
                        rows={4}
                        value={comment}
                        onChange={(e) => setComment(e.target.value)}
                        placeholder={
                          carId
                            ? "Комплектация, цвет, сроки, пожелания…"
                            : "Например: BMW X5, 2021–2023, бензин, сроки доставки"
                        }
                        required={!carId}
                      />
                    </label>
                  </div>

                  <aside className="request-quote-benefits request-quote-benefits--mobile" aria-label="Что вы получите">
                    <h2 className="request-quote-benefits__title">Что вы получите</h2>
                    <ul className="request-quote-benefits__list">
                      {BENEFITS.map((item) => (
                        <li key={item}>{item}</li>
                      ))}
                    </ul>
                  </aside>

                  <div className="request-quote-actions">
                    <button type="submit" className="btn btn-primary request-quote-submit" disabled={busy}>
                      {busy ? "Отправка…" : "Отправить заявку"}
                    </button>
                    <p className="muted request-quote-footnote">
                      Нажимая кнопку, вы соглашаетесь с обработкой персональных данных. Уже есть аккаунт?{" "}
                      <Link href={`/auth?next=${encodeURIComponent(authNext)}`}>Войдите</Link> и отправьте заявку
                      в один клик.
                    </p>
                  </div>
                </form>
              </div>

              <aside className="request-quote-aside" aria-label="Что будет дальше">
                <div className="request-quote-aside__card">
                  <h2 className="request-quote-aside__title">Что будет дальше</h2>
                  <ol className="request-quote-steps">
                    {NEXT_STEPS.map((item) => (
                      <li key={item.n} className="request-quote-steps__item">
                        <span className="request-quote-steps__n" aria-hidden>
                          {item.n}
                        </span>
                        <div>
                          <div className="request-quote-steps__title">{item.title}</div>
                          <p className="request-quote-steps__text">{item.text}</p>
                        </div>
                      </li>
                    ))}
                  </ol>
                </div>
                <div className="request-quote-aside__note">
                  <p className="request-quote-aside__note-title">Есть быстрый вопрос?</p>
                  <p className="muted request-quote-aside__note-text">
                    Напишите в комментарии — ответим в чате после заявки.
                  </p>
                </div>
              </aside>
            </div>
          ) : null}

          {step !== "form" && car && !loadError ? (
            <div className="request-quote-car-panel request-quote-car-panel--solo">
              {(() => {
                const ph = car.photos?.length
                  ? [...car.photos].sort((a, b) => a.sort_order - b.sort_order)[0]
                  : null;
                return ph?.storage_url ? (
                  <img
                    className="request-quote-car-panel__img"
                    src={mediaSrc(ph.storage_url, MEDIA_WIDTH.thumb)}
                    alt=""
                    width={112}
                    height={84}
                  />
                ) : null;
              })()}
              <div>
                <div className="request-quote-car-panel__title">{car.title}</div>
                <div className="muted request-quote-car-panel__meta">
                  {car.brand} {car.model} · {car.year}
                </div>
              </div>
            </div>
          ) : null}

          {step === "verify" ? (
            <div className="request-quote-card form-stack">
              <h2 className="request-quote-card__title">Подтвердите email</h2>
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
              <button
                type="button"
                className="btn btn-primary request-quote-submit"
                disabled={busy || !code.trim()}
                onClick={verifyEmail}
              >
                {busy ? "Проверка…" : "Подтвердить"}
              </button>
            </div>
          ) : null}

          {step === "done" ? (
            <div className="request-quote-card form-stack">
              {verifyMode === "freeform" ? (
                <Link href="/" className="btn btn-primary request-quote-submit">
                  На главную
                </Link>
              ) : verifyMode === "authed" ? (
                <Link
                  href={
                    pendingPlatformChatId != null
                      ? `/messages?chat=${encodeURIComponent(String(pendingPlatformChatId))}`
                      : "/messages"
                  }
                  className="btn btn-primary request-quote-submit"
                >
                  Открыть чат с Avtovozom
                </Link>
              ) : (
                <Link
                  href={`/auth?next=${encodeURIComponent(authNext)}`}
                  className="btn btn-primary request-quote-submit"
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
          ) : null}
        </div>
      </main>
    </div>
  );
}
