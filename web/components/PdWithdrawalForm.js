import { useState } from "react";

import { PD_CONSENT_VERSION } from "../lib/pdConsent";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

export default function PdWithdrawalForm() {
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [comment, setComment] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState("");

  async function onSubmit(e) {
    e.preventDefault();
    setError("");
    setDone("");
    setBusy(true);
    try {
      const res = await fetch(`${API_URL}/public/pd-consents/withdrawal`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: email.trim(),
          phone: phone.trim(),
          comment: comment.trim(),
          consent_version: PD_CONSENT_VERSION,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(typeof data.detail === "string" ? data.detail : "Не удалось отправить запрос.");
        return;
      }
      setDone(data.message || "Запрос принят.");
      setComment("");
    } catch {
      setError("Нет связи с сервером. Попробуйте ещё раз.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="legal-doc__section" id="withdraw">
      <h2>Отозвать согласие</h2>
      <p>
        Запрос нужен, чтобы найти ваши данные и остановить обработку, которая держится только на
        согласии. Email вы сообщаете для ответа на этот запрос.
      </p>
      {error ? <div className="alert alert--danger">{error}</div> : null}
      {done ? <div className="alert alert--success">{done}</div> : null}
      {done ? null : (
        <form className="form-stack" onSubmit={onSubmit}>
          <label className="muted form-label">
            Email *
            <input
              className="input ym-disable-keys"
              type="email"
              required
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </label>
          <label className="muted form-label">
            Телефон, если оставляли его в заявке
            <input
              className="input ym-disable-keys"
              type="tel"
              autoComplete="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
            />
          </label>
          <label className="muted form-label">
            Что прекратить
            <textarea
              className="input ym-disable-keys"
              rows={4}
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              placeholder="Например: удалить заявку и переписку, оставить только учётную запись"
            />
          </label>
          <button type="submit" className="btn btn-primary" disabled={busy}>
            {busy ? "Отправка…" : "Отправить запрос"}
          </button>
        </form>
      )}
    </section>
  );
}
