import { useEffect, useState } from "react";

import { getStoredToken } from "../lib/auth";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

export default function ReviewModeToggle() {
  const [enabled, setEnabled] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const token = getStoredToken();
    if (!token) return undefined;
    let cancelled = false;
    (async () => {
      const res = await fetch(`${API_URL}/admin/site-mode`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json().catch(() => ({}));
      if (cancelled) return;
      if (!res.ok) {
        setError(typeof data.detail === "string" ? data.detail : "Не удалось прочитать режим сайта");
        return;
      }
      setEnabled(Boolean(data.review_mode));
      setReady(true);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  async function toggle() {
    const token = getStoredToken();
    if (!token || busy) return;
    setBusy(true);
    setError("");
    try {
      const res = await fetch(`${API_URL}/admin/site-mode`, {
        method: "PUT",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ review_mode: !enabled }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(typeof data.detail === "string" ? data.detail : "Не удалось переключить режим");
        return;
      }
      setEnabled(Boolean(data.review_mode));
      window.location.reload();
    } catch {
      setError("Нет связи с сервером");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="review-mode-toggle">
      <p className="muted">
        Обзорный режим оставляет каталог открытым и закрывает регистрацию, заявки, чаты и вход всех,
        кроме администратора.
      </p>
      <button type="button" className="btn btn-primary btn-inline" onClick={toggle} disabled={!ready || busy}>
        {busy ? "Сохраняем…" : enabled ? "Выключить обзорный режим" : "Включить обзорный режим"}
      </button>
      {enabled ? <p className="review-mode-toggle__state">Сейчас включён</p> : null}
      {error ? <p className="alert alert--danger">{error}</p> : null}
    </div>
  );
}
