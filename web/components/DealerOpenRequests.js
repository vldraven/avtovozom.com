import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import { mediaSrc } from "../lib/media";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

function formatDealerRequestDate(iso) {
  try {
    return new Date(iso).toLocaleString("ru-RU", {
      day: "numeric",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

export default function DealerOpenRequests({ token, onOpenChat, onChatsUpdated }) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [expandedId, setExpandedId] = useState(null);
  const [sendingId, setSendingId] = useState(null);
  const [forms, setForms] = useState({});

  const load = useCallback(async () => {
    if (!token) return;
    setError("");
    const res = await fetch(`${API_URL}/dealer/requests`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) {
      setError("Не удалось загрузить заявки.");
      setRows([]);
      setLoading(false);
      return;
    }
    const data = await res.json();
    setRows(data || []);
    setLoading(false);
  }, [token]);

  useEffect(() => {
    if (!token) {
      setRows([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    load();
  }, [token, load]);

  function ensureForm(requestId) {
    if (forms[requestId]) return forms[requestId];
    return {
      total_price: "",
      currency: "RUB",
      eta_days: "30",
      terms_text: "",
    };
  }

  function patchForm(requestId, patch) {
    setForms((prev) => ({
      ...prev,
      [requestId]: { ...ensureForm(requestId), ...patch },
    }));
  }

  async function submitOffer(req) {
    if (!token) return;
    const f = ensureForm(req.id);
    const total_price = Number(String(f.total_price).replace(/\s/g, "").replace(",", "."));
    if (!total_price || total_price <= 0) {
      setError("Укажите корректную сумму.");
      return;
    }
    const terms_text = (f.terms_text || "").trim();
    if (terms_text.length < 8) {
      setError("Опишите расчёт и вопросы клиенту (не короче нескольких слов).");
      return;
    }
    setError("");
    setSendingId(req.id);
    try {
      const res = await fetch(`${API_URL}/requests/${req.id}/offers`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          total_price,
          currency: f.currency || "RUB",
          eta_days: Math.max(1, parseInt(f.eta_days, 10) || 30),
          terms_text,
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        const msg =
          typeof body.detail === "string"
            ? body.detail
            : "Не удалось отправить расчёт.";
        setError(msg);
        return;
      }
      setExpandedId(null);
      setForms((prev) => {
        const next = { ...prev };
        delete next[req.id];
        return next;
      });
      await load();
      if (typeof onChatsUpdated === "function") await onChatsUpdated();
    } finally {
      setSendingId(null);
    }
  }

  if (!token) return null;

  return (
    <section className="panel dealer-open-requests">
      <h2 className="section-title dealer-open-requests__title">Заявки на расчёт</h2>
      <p className="muted dealer-open-requests__intro">
        Заполните предварительный расчёт и комментарий. Клиент увидит предложение в заявке и сам откроет чат,
        если заинтересуется — так дилеры не получают доступ к переписке без согласия клиента. Первое сообщение
        в чате будет содержать ссылку на карточку авто и ваш расчёт.
      </p>
      {error ? (
        <div className="alert alert--danger alert--mb-sm">
          {error}
        </div>
      ) : null}
      {loading ? (
        <p className="muted">Загрузка…</p>
      ) : rows.length === 0 ? (
        <p className="muted">Сейчас нет открытых заявок.</p>
      ) : (
        <div className="dealer-open-requests__list">
          {rows.map((r) => {
            const expanded = expandedId === r.id;
            const hasResponse = !!r.my_offer;
            const f = ensureForm(r.id);
            return (
              <article key={r.id} className="dealer-request-card">
                <div className="dealer-request-card__main">
                  <Link href={`/cars/${r.car_id}`} className="dealer-request-card__thumb">
                    {r.car_thumb_url ? (
                      <img src={mediaSrc(r.car_thumb_url)} alt="" width={120} height={90} />
                    ) : (
                      <span className="dealer-request-card__thumb-placeholder">Нет фото</span>
                    )}
                  </Link>
                  <div className="dealer-request-card__body">
                    <div className="dealer-request-card__title-row">
                      <span className="dealer-request-card__badge">№{r.id}</span>
                      <h3 className="dealer-request-card__title">
                        {r.car_brand} {r.car_model}
                        {r.car_year != null ? ` · ${r.car_year}` : ""}
                      </h3>
                    </div>
                    <p className="dealer-request-card__subtitle muted">{r.car_title}</p>
                    <p className="dealer-request-card__comment">
                      <span className="muted">Запрос клиента:</span> {r.comment || "—"}
                    </p>
                    <p className="dealer-request-card__meta muted">
                      {formatDealerRequestDate(r.created_at)} · {r.user_name}
                      {r.user_contact ? ` · ${r.user_contact}` : ""}
                    </p>
                    {hasResponse ? (
                      <div className="dealer-request-card__status dealer-request-card__status--done">
                        Расчёт отправлен
                        {r.my_offer ? (
                          <>
                            {" "}
                            · {Math.round(Number(r.my_offer.total_price)).toLocaleString("ru-RU")}{" "}
                            {r.my_offer.currency}
                          </>
                        ) : null}
                        {r.chat_id ? (
                          <>
                            {" "}
                            ·{" "}
                            <button
                              type="button"
                              className="btn btn-secondary btn-sm"
                              onClick={() => onOpenChat && onOpenChat(r.chat_id)}
                            >
                              Открыть чат
                            </button>
                          </>
                        ) : r.client_has_account === false ? (
                          <span className="muted dealer-request-card__status-note">
                            {" "}
                            · чат на платформе недоступен (клиент подал заявку без входа в аккаунт)
                          </span>
                        ) : (
                          <span className="muted dealer-request-card__status-note">
                            {" "}
                            · клиент ещё не открыл с вами чат
                          </span>
                        )}
                      </div>
                    ) : null}
                  </div>
                </div>
                {!hasResponse ? (
                  <div className="dealer-request-card__actions">
                    {expanded ? (
                      <div className="dealer-request-card__form">
                        <div className="dealer-request-card__form-grid">
                          <label className="muted">
                            Сумма (предварительно)
                            <input
                              type="text"
                              className="input"
                              inputMode="decimal"
                              placeholder="например 2 450 000"
                              value={f.total_price}
                              onChange={(e) => patchForm(r.id, { total_price: e.target.value })}
                            />
                          </label>
                          <label className="muted">
                            Валюта
                            <select
                              className="input"
                              value={f.currency}
                              onChange={(e) => patchForm(r.id, { currency: e.target.value })}
                            >
                              <option value="RUB">RUB</option>
                              <option value="USD">USD</option>
                              <option value="EUR">EUR</option>
                              <option value="CNY">CNY</option>
                            </select>
                          </label>
                          <label className="muted">
                            Срок, дней
                            <input
                              type="number"
                              className="input"
                              min={1}
                              value={f.eta_days}
                              onChange={(e) => patchForm(r.id, { eta_days: e.target.value })}
                            />
                          </label>
                        </div>
                        <label className="muted dealer-request-card__textarea-label">
                          Расчёт, условия и вопросы клиенту
                          <textarea
                            className="input"
                            rows={6}
                            placeholder="Разбивка по статьям, доставка, таможня, что нужно уточнить у клиента…"
                            value={f.terms_text}
                            onChange={(e) => patchForm(r.id, { terms_text: e.target.value })}
                          />
                        </label>
                        <div className="dealer-request-card__form-actions">
                          <button
                            type="button"
                            className="btn btn-primary"
                            disabled={sendingId === r.id}
                            onClick={() => submitOffer(r)}
                          >
                            {sendingId === r.id ? "Отправка…" : "Отправить расчёт"}
                          </button>
                          <button
                            type="button"
                            className="btn btn-ghost"
                            disabled={sendingId === r.id}
                            onClick={() => setExpandedId(null)}
                          >
                            Отмена
                          </button>
                        </div>
                      </div>
                    ) : (
                      <button
                        type="button"
                        className="btn btn-primary btn-sm"
                        onClick={() => {
                          setExpandedId(r.id);
                          setError("");
                        }}
                      >
                        Подготовить расчёт
                      </button>
                    )}
                  </div>
                ) : (
                  <div className="dealer-request-card__actions">
                    <Link href={`/cars/${r.car_id}`} className="btn btn-ghost btn-sm">
                      Карточка авто
                    </Link>
                  </div>
                )}
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}
