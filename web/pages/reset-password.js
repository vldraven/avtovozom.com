import Link from "next/link";
import { useRouter } from "next/router";
import { useState } from "react";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

export default function ResetPasswordPage() {
  const router = useRouter();
  const token = typeof router.query.token === "string" ? router.query.token : "";
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setError("");
    setMessage("");
    setBusy(true);
    try {
      const res = await fetch(`${API_URL}/auth/password-reset/confirm`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, new_password: password }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(body.detail || "Ссылка недействительна или устарела");
        return;
      }
      setMessage(body.message || "Пароль обновлён.");
      setPassword("");
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
          <h1 className="section-title">Создать новый пароль</h1>
          {message ? <div className="alert alert--success">{message}</div> : null}
          {error ? <div className="alert alert--danger">{error}</div> : null}
          {!token ? (
            <div className="panel">
              <p className="muted">Ссылка восстановления некорректна или устарела.</p>
              <Link href="/auth?mode=forgot" className="btn btn-primary">
                Запросить новую ссылку
              </Link>
            </div>
          ) : (
            <form className="panel form-stack form-stack--tight" onSubmit={submit}>
              <input
                className="input"
                type="password"
                autoComplete="new-password"
                placeholder="Новый пароль, минимум 8 символов"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                minLength={8}
                required
              />
              <button type="submit" className="btn btn-primary" disabled={busy || password.length < 8}>
                {busy ? "Сохраняем…" : "Сохранить пароль"}
              </button>
              <Link href="/auth" className="btn btn-ghost">
                Вернуться ко входу
              </Link>
            </form>
          )}
        </div>
      </main>
    </div>
  );
}
