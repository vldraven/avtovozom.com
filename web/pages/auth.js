import Link from "next/link";
import { useRouter } from "next/router";
import { useEffect, useState } from "react";

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
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [codeSent, setCodeSent] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!router.isReady) return;
    if (router.query.mode === "register") setMode("register");
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
    const q = { ...router.query };
    delete q.mode;
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
        }),
      });
      if (!res.ok) {
        const txt = await res.text();
        setError(txt || "Ошибка входа");
        return;
      }
      const data = await res.json();
      saveToken(data.access_token);
      router.push(nextUrl);
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
      setMessage("Регистрация завершена. Временный пароль отправлен вам на email.");
      setLoginIdentifier(regEmail.trim().toLowerCase());
      setCodeSent(false);
      goLogin();
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

          {mode === "login" && (
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
                <div className="toolbar">
                  <button type="submit" className="btn btn-primary" disabled={busy}>
                    Войти
                  </button>
                  <button type="button" className="btn btn-secondary" onClick={goRegister}>
                    Зарегистрироваться
                  </button>
                </div>
              </form>
            </div>
          )}

          {mode === "register" && (
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
