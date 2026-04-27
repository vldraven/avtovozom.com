import Link from "next/link";
import { useRouter } from "next/router";
import { useEffect, useState } from "react";

import PinSetupPanel from "../components/PinSetupPanel";
import { saveToken } from "../lib/auth";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

export default function AuthPage() {
  const router = useRouter();
  const nextUrl = typeof router.query.next === "string" ? router.query.next : "/";
  const [mode, setMode] = useState("login");
  const [loginIdentifier, setLoginIdentifier] = useState("");
  const [loginPassword, setLoginPassword] = useState("");
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

  useEffect(() => {
    if (!router.isReady) return;
    if (router.query.mode === "register") setMode("register");
    if (router.query.mode === "forgot") setMode("forgot");
  }, [router.isReady, router.query.mode]);

  function goRegister() {
    setMode("register");
    router.replace(
      { pathname: "/auth", query: { ...router.query, mode: "register" } },
      undefined,
      { shallow: true }
    );
  }

  function goLogin() {
    setMode("login");
    setResetSentEmail("");
    const q = { ...router.query };
    delete q.mode;
    router.replace({ pathname: "/auth", query: q }, undefined, { shallow: true });
  }

  function goForgot() {
    setMode("forgot");
    setResetSentEmail("");
    setError("");
    setMessage("");
    const q = { ...router.query, mode: "forgot" };
    router.replace({ pathname: "/auth", query: q }, undefined, { shallow: true });
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
        router.push(nextUrl);
      }
    } finally {
      setBusy(false);
    }
  }

  async function startRegister() {
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
      setMessage("Код подтверждения отправлен на email.");
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

  return (
    <div className="layout layout--no-mobile-dock">
      <header className="site-header">
        <div className="container site-header__inner">
          <Link href="/" className="site-logo">
            avtovozom
          </Link>
        </div>
      </header>
      <main className="site-main">
        <div className="container page-narrow page-narrow--auth">
          <h1 className="section-title">Вход и регистрация</h1>
          {message && <div className="alert alert--success">{message}</div>}
          {error && <div className="alert alert--danger">{error}</div>}

          {pinSetupRequired ? (
            <div className="panel panel--pin-setup">
              <PinSetupPanel onComplete={() => router.push(nextUrl)} />
            </div>
          ) : null}

          {!pinSetupRequired && mode === "login" && (
            <div className="panel">
              <form
                className="form-stack form-stack--tight"
                autoComplete="on"
                onSubmit={(e) => {
                  e.preventDefault();
                  login();
                }}
              >
                <input
                  className="input"
                  name="username"
                  placeholder="Email или телефон"
                  type="text"
                  autoComplete="username"
                  value={loginIdentifier}
                  onChange={(e) => setLoginIdentifier(e.target.value)}
                />
                <input
                  className="input"
                  name="password"
                  placeholder="Пароль"
                  type="password"
                  autoComplete="current-password"
                  value={loginPassword}
                  onChange={(e) => setLoginPassword(e.target.value)}
                />
                <div className="toolbar auth-actions">
                  <button type="submit" className="btn btn-primary" disabled={busy}>
                    Войти
                  </button>
                  <button type="button" className="btn btn-secondary" onClick={goRegister}>
                    Зарегистрироваться
                  </button>
                </div>
                <p className="auth-reset-disclaimer">
                  Забыли пароль?{" "}
                  <button type="button" className="auth-reset-disclaimer__link" onClick={goForgot}>
                    Восстановить
                  </button>
                </p>
              </form>
            </div>
          )}

          {!pinSetupRequired && mode === "forgot" && (
            <div className="panel">
              <h2 className="section-title panel-heading-sm">Восстановление пароля</h2>
              {resetSentEmail ? (
                <div className="auth-reset-success">
                  <p className="auth-reset-success__title">Письмо отправлено</p>
                  <p className="auth-reset-success__text">
                    Если аккаунт с email <strong>{resetSentEmail}</strong> существует, мы отправили письмо с инструкцией
                    для восстановления пароля.
                  </p>
                  <p className="auth-reset-success__hint">Проверьте входящие и папку спама.</p>
                  <div className="toolbar auth-actions">
                    <button type="button" className="btn btn-primary" onClick={goLogin}>
                      Вернуться ко входу
                    </button>
                    <button type="button" className="btn btn-secondary" onClick={() => setResetSentEmail("")}>
                      Отправить ещё раз
                    </button>
                  </div>
                </div>
              ) : (
                <div className="form-stack form-stack--tight">
                  <input
                    className="input"
                    placeholder="Email"
                    type="email"
                    autoComplete="email"
                    value={resetEmail}
                    onChange={(e) => setResetEmail(e.target.value)}
                  />
                  <button
                    type="button"
                    className="btn btn-primary"
                    disabled={busy || !resetEmail.trim()}
                    onClick={startPasswordReset}
                  >
                    Отправить ссылку
                  </button>
                  <button type="button" className="btn btn-ghost" onClick={goLogin}>
                    Вернуться ко входу
                  </button>
                </div>
              )}
            </div>
          )}

          {!pinSetupRequired && mode === "register" && (
            <div className="panel">
              <h2 className="section-title panel-heading-sm">Регистрация</h2>
              <div className="form-stack form-stack--tight">
                <input
                  className="input"
                  placeholder="Email"
                  type="email"
                  value={regEmail}
                  onChange={(e) => setRegEmail(e.target.value)}
                />
                <input
                  className="input"
                  placeholder="Телефон"
                  value={regPhone}
                  onChange={(e) => setRegPhone(e.target.value)}
                />
                <input
                  className="input"
                  placeholder="Имя"
                  value={regName}
                  onChange={(e) => setRegName(e.target.value)}
                />
                {!codeSent ? (
                  <button type="button" className="btn btn-primary" disabled={busy} onClick={startRegister}>
                    Отправить код на email
                  </button>
                ) : (
                  <>
                    <input
                      className="input"
                      placeholder="Код подтверждения из письма"
                      value={regCode}
                      onChange={(e) => setRegCode(e.target.value)}
                    />
                    <button type="button" className="btn btn-primary" disabled={busy} onClick={verifyRegister}>
                      Подтвердить регистрацию
                    </button>
                  </>
                )}
                <button type="button" className="btn btn-ghost" onClick={goLogin}>
                  Уже есть аккаунт
                </button>
              </div>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
