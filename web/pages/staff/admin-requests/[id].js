import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter } from "next/router";

import HeaderProfileLink from "../../../components/HeaderProfileLink";
import { clearToken, getStoredToken } from "../../../lib/auth";
import { mediaSrc } from "../../../lib/media";
import { isStaffRole } from "../../../lib/roles";

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
    clearToken();
    router.push("/");
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
      <header className="site-header">
        <div className="container site-header__inner">
          <Link href="/" className="site-logo">
            avtovozom
          </Link>
          <div className="auth-bar" style={{ display: "flex", gap: 12, alignItems: "center" }}>
            <HeaderProfileLink token={token} userRole={me?.role} variant="ghost" />
            <button type="button" className="btn btn-ghost btn-sm" onClick={logout}>
              Выйти
            </button>
          </div>
        </div>
      </header>
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
                    src={mediaSrc(req.car_thumb_url)}
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
                  {req.car_page_url ? (
                    <p style={{ margin: 0 }}>
                      <a href={req.car_page_url} target="_blank" rel="noopener noreferrer">
                        Открыть объявление в каталоге
                      </a>
                    </p>
                  ) : (
                    <p style={{ margin: 0 }}>
                      <Link href={`/cars/${req.car_id}`} className="btn btn-secondary btn-sm">
                        Объявление #{req.car_id}
                      </Link>
                    </p>
                  )}
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
