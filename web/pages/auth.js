import Link from "next/link";
import { useRouter } from "next/router";
import { useState } from "react";

import { saveToken } from "../lib/auth";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

export default function AuthPage() {
  const router = useRouter();
  const nextUrl = typeof router.query.next === "string" ? router.query.next : "/";
  const [mode, setMode] = useState("choice");
  const [loginEmail, setLoginEmail] = useState("");
  const [loginPassword, setLoginPassword] = useState("");
  const [regEmail, setRegEmail] = useState("");
  const [regPhone, setRegPhone] = useState("");
  const [regName, setRegName] = useState("");
  const [regCode, setRegCode] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [codeSent, setCodeSent] = useState(false);
  const [busy, setBusy] = useState(false);

  async function login() {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const res = await fetch(`${API_URL}/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: loginEmail.trim().toLowerCase(), password: loginPassword }),
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
      setMode("login");
      setLoginEmail(regEmail.trim().toLowerCase());
      setCodeSent(false);
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

          {mode === "choice" && (
            <div className="panel">
              <p>
                Чтобы отправить заявку в один клик с страницы авто, войдите. Если аккаунта ещё нет — на странице
                объявления откройте форму «Заявка на расчёт»: мы сохраним заявку и зарегистрируем вас по email (код
                подтверждения придёт в письме).
              </p>
              <div className="toolbar">
                <button type="button" className="btn btn-primary" onClick={() => setMode("login")}>
                  Войти
                </button>
                <button type="button" className="btn btn-secondary" onClick={() => setMode("register")}>
                  Зарегистрироваться
                </button>
              </div>
            </div>
          )}

          {mode === "login" && (
            <div className="panel">
              <h2 className="section-title panel-heading-sm">Вход</h2>
              <div className="form-stack form-stack--tight">
                <input
                  className="input"
                  placeholder="Email"
                  type="email"
                  value={loginEmail}
                  onChange={(e) => setLoginEmail(e.target.value)}
                />
                <input
                  className="input"
                  placeholder="Пароль"
                  type="password"
                  value={loginPassword}
                  onChange={(e) => setLoginPassword(e.target.value)}
                />
                <div className="toolbar">
                  <button type="button" className="btn btn-primary" disabled={busy} onClick={login}>
                    Войти
                  </button>
                  <button type="button" className="btn btn-ghost" onClick={() => setMode("register")}>
                    Нет аккаунта?
                  </button>
                </div>
              </div>
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
                <button type="button" className="btn btn-ghost" onClick={() => setMode("login")}>
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
