import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter } from "next/router";

import HeaderProfileLink from "../../../components/HeaderProfileLink";
import { clearToken, getStoredToken } from "../../../lib/auth";
import { MEDIA_WIDTH, mediaSrc } from "../../../lib/media";
import { isStaffRole } from "../../../lib/roles";
import SiteHeader from "../../../components/SiteHeader";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

function formatDate(iso) {
  try {
    return new Date(iso).toLocaleString("ru-RU");
  } catch {
    return iso;
  }
}

function offerStatusLabel(status) {
  if (status === "sent") return "На рассмотрении";
  if (status === "selected") return "Выбрано";
  if (status === "rejected") return "Отклонено";
  return status;
}

export default function AdminRequestDetailPage() {
  const router = useRouter();
  const rawId = router.query.id;
  const requestId = rawId == null ? "" : String(Array.isArray(rawId) ? rawId[0] : rawId).trim();

  const [token, setToken] = useState("");
  const [me, setMe] = useState(null);
  const [req, setReq] = useState(null);
  const [loadError, setLoadError] = useState("");
  const [chatErr, setChatErr] = useState("");
  const [openingChat, setOpeningChat] = useState(false);

  useEffect(() => {
    const t = getStoredToken();
    if (!t) {
      router.push(`/auth?next=/staff/admin-requests/${requestId || ""}`);
      return;
    }
    setToken(t);
    (async () => {
      const res = await fetch(`${API_URL}/auth/me`, { headers: { Authorization: `Bearer ${t}` } });
      if (!res.ok) {
        clearToken();
        router.push(`/auth?next=/staff/admin-requests/${requestId || ""}`);
        return;
      }
      const data = await res.json();
      setMe(data);
      if (!isStaffRole(data.role)) {
        router.replace("/profile");
      }
    })();
  }, []);

  useEffect(() => {
    if (!router.isReady || !requestId || !token) return;
    (async () => {
      setLoadError("");
      const res = await fetch(`${API_URL}/admin/calculation-requests/${requestId}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        setLoadError(res.status === 404 ? "Заявка не найдена" : "Не удалось загрузить заявку");
        setReq(null);
        return;
      }
      setReq(await res.json());
    })();
  }, [router.isReady, requestId, token]);

  function logout() {
    clearToken({ logout: true });
    router.push("/");
  }

  async function openClientChat() {
    if (!token || !requestId || openingChat) return;
    setChatErr("");
    setOpeningChat(true);
    try {
      if (req?.platform_chat_id != null) {
        router.push(`/messages?chat=${encodeURIComponent(String(req.platform_chat_id))}`);
        return;
      }
      const res = await fetch(
        `${API_URL}/admin/calculation-requests/${encodeURIComponent(requestId)}/open-platform-chat`,
        {
          method: "POST",
          headers: { Authorization: `Bearer ${token}` },
        }
      );
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setChatErr(
          typeof body.detail === "string"
            ? body.detail
            : "Не удалось открыть чат с клиентом"
        );
        return;
      }
      const chatId = body.chat_id;
      if (chatId == null) {
        setChatErr("Не удалось открыть чат с клиентом");
        return;
      }
      router.push(`/messages?chat=${encodeURIComponent(String(chatId))}`);
    } catch {
      setChatErr("Сбой связи с API");
    } finally {
      setOpeningChat(false);
    }
  }

  if (!me) {
    return (
      <div className="layout">
        <main className="site-main">
          <div className="container">
            <p className="muted">Загрузка...</p>
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className="layout">
      <SiteHeader authBarStyle={{display: "flex", gap: 12, alignItems: "center"}}>
          <HeaderProfileLink token={token} userRole={me?.role} variant="ghost" />
          <button type="button" className="btn btn-ghost btn-sm" onClick={logout}>
            Выйти
          </button>
        </SiteHeader>
      <main className="site-main">
        <div className="container" style={{ maxWidth: 720 }}>
          <p className="muted" style={{ marginBottom: "0.5rem" }}>
            <Link href="/staff/admin-requests">← Все заявки</Link>
          </p>
          <h1 className="section-title">Заявка #{requestId || "…"}</h1>
          {loadError && <div className="alert alert--danger">{loadError}</div>}
          {!req && !loadError ? (
            <p className="muted">Загрузка...</p>
          ) : req ? (
            <article className="panel">
              <div style={{ display: "flex", gap: 16, flexWrap: "wrap", alignItems: "flex-start" }}>
                {req.car_thumb_url ? (
                  <img
                    src={mediaSrc(req.car_thumb_url, MEDIA_WIDTH.thumb)}
                    alt=""
                    width={160}
                    style={{ borderRadius: 8, objectFit: "cover" }}
                  />
                ) : null}
                <div>
                  <p className="muted" style={{ margin: "0 0 0.5rem" }}>
                    {formatDate(req.created_at)} · статус: <b>{req.status}</b>
                  </p>
                  <p style={{ margin: "0 0 0.5rem" }}>
                    <b>
                      {req.car_brand} {req.car_model}
                      {req.car_year != null ? ` · ${req.car_year}` : ""}
                    </b>
                  </p>
                  <p className="muted" style={{ margin: "0 0 0.5rem" }}>
                    {req.car_title}
                  </p>
                  <p style={{ margin: "0 0 0.5rem" }}>
                    Клиент: <b>{req.user_name}</b> · {req.user_contact}
                    {req.client_email ? (
                      <>
                        {" "}
                        · <a href={`mailto:${req.client_email}`}>{req.client_email}</a>
                      </>
                    ) : null}
                    {req.client_user_id != null ? (
                      <span className="muted"> · user_id {req.client_user_id}</span>
                    ) : null}
                  </p>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center", marginBottom: "0.5rem" }}>
                    <button
                      type="button"
                      className="btn btn-primary btn-sm"
                      disabled={openingChat}
                      onClick={openClientChat}
                    >
                      {openingChat ? "Открываем…" : "Открыть чат с клиентом"}
                    </button>
                    {req.client_user_id == null && !req.platform_chat_id ? (
                      <span className="muted" style={{ fontSize: "0.85rem" }}>
                        Если клиент ещё не зарегистрирован — чат недоступен
                      </span>
                    ) : null}
                  </div>
                  {chatErr ? <div className="alert alert--danger">{chatErr}</div> : null}
                  {req.car_page_url ? (
                    <p style={{ margin: 0 }}>
                      <a href={req.car_page_url} target="_blank" rel="noopener noreferrer">
                        Открыть объявление в каталоге
                      </a>
                    </p>
                  ) : req.car_id != null ? (
                    <p style={{ margin: 0 }}>
                      <Link href={`/cars/${req.car_id}`} className="btn btn-secondary btn-sm">
                        Объявление #{req.car_id}
                      </Link>
                    </p>
                  ) : null}
                </div>
              </div>
              {req.comment ? (
                <div className="profile-comment-block" style={{ marginTop: "1rem" }}>
                  <div className="muted profile-comment-block__label">Комментарий клиента</div>
                  <p className="profile-comment-block__text">{req.comment}</p>
                </div>
              ) : null}
              <div style={{ marginTop: "1.25rem" }}>
                <div className="profile-offers-heading">Предложения дилеров</div>
                {!req.offers?.length ? (
                  <p className="muted profile-offers-empty">Пока нет предложений.</p>
                ) : (
                  <ul className="profile-offers-list">
                    {req.offers.map((o) => (
                      <li key={o.id} className="profile-offer-card">
                        <div className="profile-offer-card__title">
                          Дилер (user #{o.dealer_user_id}):{" "}
                          {Math.round(o.total_price).toLocaleString("ru-RU")} {o.currency} · срок ~ {o.eta_days} дн. ·{" "}
                          {offerStatusLabel(o.status)}
                        </div>
                        {o.terms_text ? <p className="profile-offer-card__terms">{o.terms_text}</p> : null}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </article>
          ) : null}
        </div>
      </main>
    </div>
  );
}
