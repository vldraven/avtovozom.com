import { useState } from "react";

import { formatRuPhoneMask, normalizeRuPhoneDigits, phoneDigitsToApi } from "../lib/ruPhoneMask";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

const DEFAULT_COMMENT = "Нужна консультация по подбору и доставке автомобиля из Китая или Кореи.";

function parseApiDetail(body) {
  if (!body || typeof body !== "object") return null;
  const d = body.detail;
  if (typeof d === "string") return d;
  if (Array.isArray(d)) {
    return d
      .map((x) => (typeof x === "object" && x?.msg ? String(x.msg) : JSON.stringify(x)))
      .join(" ");
  }
  if (typeof d === "object") return JSON.stringify(d);
  return null;
}

/**
 * @param {{ title?: string, lead?: string, className?: string, id?: string }} props
 */
export default function LeadForm({
  title = "Оставить заявку",
  lead = "Опишите желаемый автомобиль — мы свяжемся и подготовим расчёт под ключ до РФ.",
  className = "",
  id = "lead-form",
}) {
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [phoneDigits, setPhoneDigits] = useState("7");
  const [comment, setComment] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  async function onSubmit(e) {
    e.preventDefault();
    setError("");
    setSuccess("");

    const name = fullName.trim();
    const mail = email.trim().toLowerCase();
    const phone = phoneDigitsToApi(phoneDigits).trim();
    const contactPhone = phone.replace(/\D/g, "").length >= 10;

    if (!name) {
      setError("Укажите имя.");
      return;
    }
    if (!mail && !contactPhone) {
      setError("Укажите email или телефон для связи.");
      return;
    }
    if (mail && !mail.includes("@")) {
      setError("Укажите корректный email.");
      return;
    }

    const bodyComment = (comment.trim() || DEFAULT_COMMENT).trim();
    const payload = {
      full_name: name,
      email: mail || `${phone.replace(/\D/g, "")}@contact.avtovozom.local`,
      phone: contactPhone ? phone : "",
      comment: bodyComment,
    };

    setBusy(true);
    try {
      const res = await fetch(`${API_URL}/requests/freeform-lead`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(parseApiDetail(data) || "Не удалось отправить заявку. Попробуйте позже.");
        return;
      }
      setSuccess(data.message || "Заявка отправлена. Мы свяжемся с вами в ближайшее время.");
      setFullName("");
      setEmail("");
      setPhoneDigits("7");
      setComment("");
    } catch {
      setError("Нет связи с сервером. Проверьте интернет и попробуйте снова.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className={`lead-form-section panel${className ? ` ${className}` : ""}`} id={id}>
      <h2 className="section-title section-title--flush-top">{title}</h2>
      {lead ? <p className="muted lead-form-section__lead">{lead}</p> : null}
      {error ? <div className="alert alert--danger">{error}</div> : null}
      {success ? <div className="alert alert--success">{success}</div> : null}
      {!success ? (
        <form className="form-stack lead-form-section__form" onSubmit={onSubmit} noValidate>
          <label className="muted form-label">
            Имя *
            <input
              className="input"
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              placeholder="Как к вам обращаться"
              autoComplete="name"
              required
            />
          </label>
          <label className="muted form-label">
            Телефон или Telegram
            <input
              className="input"
              type="tel"
              inputMode="tel"
              autoComplete="tel"
              value={formatRuPhoneMask(phoneDigits)}
              onChange={(e) => setPhoneDigits(normalizeRuPhoneDigits(e.target.value))}
              placeholder="+7 (999) 123-45-67 или @username"
            />
          </label>
          <label className="muted form-label">
            Email
            <input
              className="input"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="Для ответа на заявку"
              autoComplete="email"
            />
          </label>
          <p className="muted lead-form-section__hint">* Укажите телефон или email — так мы сможем связаться с вами.</p>
          <label className="muted form-label">
            Комментарий
            <textarea
              className="input"
              rows={4}
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              placeholder="Марка, модель, год, бюджет, сроки…"
            />
          </label>
          <button type="submit" className="btn btn-primary" disabled={busy}>
            {busy ? "Отправка…" : "Отправить заявку"}
          </button>
        </form>
      ) : null}
    </section>
  );
}
