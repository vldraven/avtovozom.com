import { useEffect, useRef, useState } from "react";

import PinSetupPanel from "./PinSetupPanel";
import SiteLogo from "./SiteLogo";
import { saveToken } from "../lib/auth";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";
const OTP_LENGTH = 6;
const RESEND_COOLDOWN_SEC = 60;

function AuthOtpCells({ value, onChange, disabled = false, autoFocus = false }) {
  const refs = useRef([]);
  const digits = Array.from({ length: OTP_LENGTH }, (_, i) => value[i] || "");

  function setAt(index, digit) {
    const next = digits.slice();
    next[index] = digit;
    onChange(next.join("").slice(0, OTP_LENGTH));
  }

  function handleChange(index, raw) {
    const cleaned = String(raw || "").replace(/\D/g, "");
    if (!cleaned) {
      setAt(index, "");
      return;
    }
    if (cleaned.length > 1) {
      const merged = (value.slice(0, index) + cleaned).replace(/\D/g, "").slice(0, OTP_LENGTH);
      onChange(merged);
      const focusIdx = Math.min(merged.length, OTP_LENGTH - 1);
      refs.current[focusIdx]?.focus();
      return;
    }
    setAt(index, cleaned);
    if (index < OTP_LENGTH - 1) refs.current[index + 1]?.focus();
  }

  function handleKeyDown(index, e) {
    if (e.key === "Backspace" && !digits[index] && index > 0) {
      e.preventDefault();
      setAt(index - 1, "");
      refs.current[index - 1]?.focus();
    }
    if (e.key === "ArrowLeft" && index > 0) {
      e.preventDefault();
      refs.current[index - 1]?.focus();
    }
    if (e.key === "ArrowRight" && index < OTP_LENGTH - 1) {
      e.preventDefault();
      refs.current[index + 1]?.focus();
    }
  }

  function handlePaste(e) {
    const text = e.clipboardData?.getData("text") || "";
    const cleaned = text.replace(/\D/g, "").slice(0, OTP_LENGTH);
    if (!cleaned) return;
    e.preventDefault();
    onChange(cleaned);
    refs.current[Math.min(cleaned.length, OTP_LENGTH - 1)]?.focus();
  }

  return (
    <div className="auth-otp" role="group" aria-label="Код подтверждения" onPaste={handlePaste}>
      {digits.map((digit, index) => (
        <input
          // eslint-disable-next-line react/no-array-index-key
          key={index}
          ref={(el) => {
            refs.current[index] = el;
          }}
          className="auth-otp__cell"
          inputMode="numeric"
          autoComplete={index === 0 ? "one-time-code" : "off"}
          autoFocus={autoFocus && index === 0}
          maxLength={OTP_LENGTH}
          value={digit}
          disabled={disabled}
          aria-label={`Цифра ${index + 1}`}
          onChange={(e) => handleChange(index, e.target.value)}
          onKeyDown={(e) => handleKeyDown(index, e)}
          onFocus={(e) => e.target.select()}
        />
      ))}
    </div>
  );
}

function formatResendTimer(totalSec) {
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

/**
 * Полный поток: вход / регистрация / OTP / forgot / PIN.
 * @param {{
 *   variant?: "page" | "modal",
 *   initialMode?: "login" | "register" | "forgot",
 *   nextUrl?: string,
 *   onClose?: () => void,
 *   onComplete?: (nextUrl: string) => void,
 *   syncQuery?: boolean,
 *   onModeChange?: (mode: string) => void,
 * }} props
 */
export default function AuthFlow({
  variant = "page",
  initialMode = "login",
  nextUrl = "/",
  onClose,
  onComplete,
  syncQuery = false,
  onModeChange,
}) {
  const [mode, setMode] = useState(initialMode);
  const [loginIdentifier, setLoginIdentifier] = useState("");
  const [loginPassword, setLoginPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [regEmail, setRegEmail] = useState("");
  const [regPhone, setRegPhone] = useState("");
  const [regName, setRegName] = useState("");
  const [regCode, setRegCode] = useState("");
  const [resetEmail, setResetEmail] = useState("");
  const [resetSentEmail, setResetSentEmail] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [codeSent, setCodeSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [pinSetupRequired, setPinSetupRequired] = useState(false);
  const [resendAt, setResendAt] = useState(0);
  const [resendLeft, setResendLeft] = useState(0);

  useEffect(() => {
    setMode(initialMode);
  }, [initialMode]);

  useEffect(() => {
    onModeChange?.(mode);
  }, [mode, onModeChange]);

  useEffect(() => {
    if (!resendAt) {
      setResendLeft(0);
      return undefined;
    }
    const tick = () => {
      const left = Math.max(0, Math.ceil((resendAt - Date.now()) / 1000));
      setResendLeft(left);
    };
    tick();
    const id = window.setInterval(tick, 250);
    return () => window.clearInterval(id);
  }, [resendAt]);

  function finish(url = nextUrl) {
    if (onComplete) onComplete(url);
  }

  function replaceQuery(modeValue) {
    if (!syncQuery || typeof window === "undefined") return;
    const url = new URL(window.location.href);
    if (!modeValue || modeValue === "login") url.searchParams.delete("mode");
    else url.searchParams.set("mode", modeValue);
    window.history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
  }

  function goRegister() {
    setMode("register");
    setError("");
    setMessage("");
    setCodeSent(false);
    setRegCode("");
    replaceQuery("register");
  }

  function goLogin() {
    setMode("login");
    setResetSentEmail("");
    setError("");
    setMessage("");
    setCodeSent(false);
    setRegCode("");
    replaceQuery("login");
  }

  function goForgot() {
    setMode("forgot");
    setResetSentEmail("");
    setError("");
    setMessage("");
    replaceQuery("forgot");
  }

  function startResendCooldown() {
    setResendAt(Date.now() + RESEND_COOLDOWN_SEC * 1000);
  }

  async function login() {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const res = await fetch(`${API_URL}/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: loginIdentifier.trim(),
          password: loginPassword,
          device_name: typeof navigator !== "undefined" ? navigator.userAgent.slice(0, 120) : "",
        }),
      });
      if (!res.ok) {
        const txt = await res.text();
        setError(txt || "Ошибка входа");
        return;
      }
      const data = await res.json();
      saveToken(data.access_token, data.refresh_token);
      if (data.refresh_token) {
        setPinSetupRequired(true);
      } else {
        finish(nextUrl);
      }
    } finally {
      setBusy(false);
    }
  }

  async function startRegister({ resend = false } = {}) {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const res = await fetch(`${API_URL}/auth/register/start`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: regEmail.trim().toLowerCase(),
          phone: regPhone.trim(),
          full_name: regName.trim(),
        }),
      });
      if (!res.ok) {
        const txt = await res.text();
        setError(txt || "Не удалось отправить код");
        return;
      }
      setCodeSent(true);
      startResendCooldown();
      if (!resend) setRegCode("");
    } finally {
      setBusy(false);
    }
  }

  async function verifyRegister() {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const res = await fetch(`${API_URL}/auth/register/verify`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: regEmail.trim().toLowerCase(), code: regCode.trim() }),
      });
      if (!res.ok) {
        const txt = await res.text();
        setError(txt || "Неверный код");
        return;
      }
      const data = await res.json().catch(() => ({}));
      if (data.access_token) {
        saveToken(data.access_token, data.refresh_token);
        if (data.refresh_token) {
          setPinSetupRequired(true);
          return;
        }
      }
      setMessage(data.message || "Регистрация завершена. Временный пароль отправлен вам на email.");
      setLoginIdentifier(regEmail.trim().toLowerCase());
      setCodeSent(false);
      goLogin();
    } finally {
      setBusy(false);
    }
  }

  async function startPasswordReset() {
    const email = resetEmail.trim().toLowerCase();
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const res = await fetch(`${API_URL}/auth/password-reset/start`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(body.detail || "Не удалось отправить ссылку восстановления");
        return;
      }
      setResetSentEmail(email);
    } finally {
      setBusy(false);
    }
  }

  const showTabs = !pinSetupRequired && !codeSent;
  const otpView = !pinSetupRequired && mode === "register" && codeSent;
  const title =
    pinSetupRequired
      ? null
      : mode === "forgot"
        ? "Восстановление пароля"
        : otpView
          ? "Подтвердите email"
          : mode === "register"
            ? "Регистрация"
            : "Вход";
  const lead =
    pinSetupRequired
      ? null
      : mode === "forgot"
        ? "Укажите email — пришлём ссылку для сброса пароля."
        : otpView
          ? `Отправили код на ${regEmail.trim().toLowerCase() || "ваш email"}.`
          : "Избранное, заказ отчетов, чаты по сделке и личный кабинет";

  const isModal = variant === "modal";

  return (
    <div
      className={`auth-card${pinSetupRequired ? " auth-card--pin" : ""}${isModal ? " auth-card--modal" : ""}`}
      role={isModal ? "dialog" : undefined}
      aria-modal={isModal ? "true" : undefined}
      aria-labelledby={pinSetupRequired ? undefined : "auth-flow-title"}
    >
      {!pinSetupRequired ? (
        <div className="auth-card__top">
          <div className="auth-card__brand">
            <SiteLogo />
          </div>
          {onClose ? (
            <button type="button" className="auth-card__close" aria-label="Закрыть" onClick={onClose}>
              ✕
            </button>
          ) : null}
        </div>
      ) : null}

      {otpView ? (
        <button type="button" className="auth-card__back" onClick={() => setCodeSent(false)}>
          ← Назад
        </button>
      ) : null}

      {mode === "forgot" && !pinSetupRequired ? (
        <button type="button" className="auth-card__back" onClick={goLogin}>
          ← Назад
        </button>
      ) : null}

      {showTabs ? (
        <div className="auth-tabs" role="tablist" aria-label="Вход или регистрация">
          <button
            type="button"
            role="tab"
            aria-selected={mode === "login" || mode === "forgot"}
            className={`auth-tabs__tab${mode === "login" || mode === "forgot" ? " auth-tabs__tab--active" : ""}`}
            onClick={goLogin}
          >
            Вход
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={mode === "register"}
            className={`auth-tabs__tab${mode === "register" ? " auth-tabs__tab--active" : ""}`}
            onClick={goRegister}
          >
            Регистрация
          </button>
        </div>
      ) : null}

      {!pinSetupRequired && title ? (
        <header className="auth-page-hero">
          <h1 id="auth-flow-title" className="section-title auth-page-hero__title">
            {title}
          </h1>
          {lead ? <p className="auth-page-hero__lead muted">{lead}</p> : null}
        </header>
      ) : null}

      {message ? <div className="alert alert--success">{message}</div> : null}
      {error ? <div className="alert alert--danger">{error}</div> : null}

            {pinSetupRequired ? (
        <div className="panel panel--pin-setup">
          <PinSetupPanel onComplete={() => finish(nextUrl)} onSkip={() => finish(nextUrl)} />
        </div>
      ) : null}

      {!pinSetupRequired && mode === "login" ? (
        <div className="auth-panel">
          <form
            className="form-stack form-stack--tight"
            autoComplete="on"
            onSubmit={(e) => {
              e.preventDefault();
              login();
            }}
          >
            <label className="auth-field">
              <span className="auth-field__label">Email или телефон</span>
              <input
                className="input"
                name="username"
                placeholder="Email или телефон"
                type="text"
                autoComplete="username"
                value={loginIdentifier}
                onChange={(e) => setLoginIdentifier(e.target.value)}
              />
            </label>
            <label className="auth-field">
              <span className="auth-field__label">Пароль</span>
              <div className="auth-password">
                <input
                  className="input auth-password__input"
                  name="password"
                  placeholder="Пароль"
                  type={showPassword ? "text" : "password"}
                  autoComplete="current-password"
                  value={loginPassword}
                  onChange={(e) => setLoginPassword(e.target.value)}
                />
                <button
                  type="button"
                  className="auth-password__toggle"
                  onClick={() => setShowPassword((v) => !v)}
                >
                  {showPassword ? "Скрыть" : "Показать"}
                </button>
              </div>
            </label>
            <div className="toolbar auth-actions">
              <button type="submit" className="btn btn-primary auth-submit-wide" disabled={busy}>
                Войти
              </button>
            </div>
            <p className="auth-reset-disclaimer">
              Забыли пароль?{" "}
              <button type="button" className="auth-reset-disclaimer__link" onClick={goForgot}>
                Восстановить
              </button>
            </p>
            <p className="auth-switch-hint">
              Нет аккаунта?{" "}
              <button type="button" className="auth-reset-disclaimer__link" onClick={goRegister}>
                Зарегистрироваться
              </button>
            </p>
          </form>
        </div>
      ) : null}

      {!pinSetupRequired && mode === "forgot" ? (
        <div className="auth-panel">
          {resetSentEmail ? (
            <div className="auth-reset-success">
              <p className="auth-reset-success__title">Письмо отправлено</p>
              <p className="auth-reset-success__text">
                Если аккаунт с email <strong>{resetSentEmail}</strong> существует, мы отправили письмо с инструкцией
                для восстановления пароля.
              </p>
              <p className="auth-reset-success__hint">Проверьте входящие и папку спама.</p>
              <div className="toolbar auth-actions auth-actions--stack">
                <button type="button" className="btn btn-primary auth-submit-wide" onClick={goLogin}>
                  Вернуться ко входу
                </button>
                <button
                  type="button"
                  className="btn btn-secondary auth-submit-wide"
                  onClick={() => setResetSentEmail("")}
                >
                  Отправить ещё раз
                </button>
              </div>
            </div>
          ) : (
            <div className="form-stack form-stack--tight">
              <label className="auth-field">
                <span className="auth-field__label">Email</span>
                <input
                  className="input"
                  placeholder="Email"
                  type="email"
                  autoComplete="email"
                  value={resetEmail}
                  onChange={(e) => setResetEmail(e.target.value)}
                />
              </label>
              <button
                type="button"
                className="btn btn-primary auth-submit-wide"
                disabled={busy || !resetEmail.trim()}
                onClick={startPasswordReset}
              >
                Отправить ссылку
              </button>
              <button type="button" className="btn btn-ghost auth-submit-wide" onClick={goLogin}>
                Вернуться ко входу
              </button>
            </div>
          )}
        </div>
      ) : null}

      {!pinSetupRequired && mode === "register" && !codeSent ? (
        <div className="auth-panel">
          <div className="form-stack form-stack--tight">
            <label className="auth-field">
              <span className="auth-field__label">Email</span>
              <input
                className="input"
                placeholder="Email"
                type="email"
                autoComplete="email"
                value={regEmail}
                onChange={(e) => setRegEmail(e.target.value)}
              />
            </label>
            <label className="auth-field">
              <span className="auth-field__label">Телефон</span>
              <input
                className="input"
                placeholder="Телефон"
                type="tel"
                autoComplete="tel"
                value={regPhone}
                onChange={(e) => setRegPhone(e.target.value)}
              />
            </label>
            <label className="auth-field">
              <span className="auth-field__label">Имя</span>
              <input
                className="input"
                placeholder="Имя"
                autoComplete="name"
                value={regName}
                onChange={(e) => setRegName(e.target.value)}
              />
            </label>
            <button
              type="button"
              className="btn btn-primary auth-submit-wide"
              disabled={busy}
              onClick={() => startRegister()}
            >
              Отправить код на email
            </button>
            <p className="auth-switch-hint">
              Уже есть аккаунт?{" "}
              <button type="button" className="auth-reset-disclaimer__link" onClick={goLogin}>
                Войти
              </button>
            </p>
          </div>
        </div>
      ) : null}

      {otpView ? (
        <div className="auth-panel">
          <div className="form-stack form-stack--tight">
            <AuthOtpCells value={regCode} onChange={setRegCode} disabled={busy} autoFocus />
            <button
              type="button"
              className="btn btn-primary auth-submit-wide"
              disabled={busy || regCode.trim().length < OTP_LENGTH}
              onClick={verifyRegister}
            >
              Подтвердить
            </button>
            {resendLeft > 0 ? (
              <p className="auth-resend muted">Отправить код повторно через {formatResendTimer(resendLeft)}</p>
            ) : (
              <button
                type="button"
                className="btn btn-ghost auth-submit-wide"
                disabled={busy}
                onClick={() => startRegister({ resend: true })}
              >
                Отправить код повторно
              </button>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}
