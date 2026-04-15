import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/router";

import AdminParserPanel from "../components/AdminParserPanel";
import DealerOpenRequests from "../components/DealerOpenRequests";
import HeaderMessagesLink from "../components/HeaderMessagesLink";
import { clearToken, getStoredToken } from "../lib/auth";
import { publicCarHref } from "../lib/carRoutes";
import { mediaSrc } from "../lib/media";
import { canCreateListings, isAdminRole, isStaffRole } from "../lib/roles";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

function formatRequestDate(iso) {
  try {
    return new Date(iso).toLocaleString("ru-RU");
  } catch {
    return iso;
  }
}

function requestStatusLabel(status) {
  if (status === "open") return "Открыта — ждём предложения дилеров";
  if (status === "in_progress") return "В работе — дилер выбран";
  return status;
}

function offerStatusLabel(status) {
  if (status === "sent") return "На рассмотрении";
  if (status === "selected") return "Выбрано";
  if (status === "rejected") return "Отклонено";
  return status;
}

export default function ProfilePage() {
  const router = useRouter();
  const [token, setToken] = useState("");
  const [me, setMe] = useState(null);
  const [requests, setRequests] = useState([]);
  const [adminJobs, setAdminJobs] = useState([]);
  const [staffCars, setStaffCars] = useState([]);
  const [name, setName] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [companyName, setCompanyName] = useState("");
  const [phone, setPhone] = useState("");
  const [oldPassword, setOldPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [removingCarId, setRemovingCarId] = useState(null);
  const [expandedRequestId, setExpandedRequestId] = useState(null);
  const [openingChatOfferId, setOpeningChatOfferId] = useState(null);

  const unreadOffersOnProfile = useMemo(
    () => requests.reduce((s, r) => s + (Number(r.unread_offers_count) || 0), 0),
    [requests]
  );

  useEffect(() => {
    const t = getStoredToken();
    if (!t) {
      router.push("/auth?next=/profile");
      return;
    }
    setToken(t);
    loadMe(t);
  }, []);

  async function loadMe(t) {
    const res = await fetch(`${API_URL}/auth/me`, { headers: { Authorization: `Bearer ${t}` } });
    if (!res.ok) {
      clearToken();
      router.push("/auth?next=/profile");
      return;
    }
    const data = await res.json();
    setMe(data);
    setName(data.full_name || "");
    setDisplayName(data.display_name || "");
    setCompanyName(data.company_name || "");
    setPhone(data.phone || "");
    await loadRoleData(t, data.role);
  }

  async function reloadParserJobsWithToken(t) {
    const j = await fetch(`${API_URL}/admin/parser/jobs`, { headers: { Authorization: `Bearer ${t}` } });
    if (j.ok) setAdminJobs(await j.json());
  }

  async function loadMyRequestsOnly(t) {
    const rr = await fetch(`${API_URL}/requests/my`, { headers: { Authorization: `Bearer ${t}` } });
    if (rr.ok) setRequests(await rr.json());
    if (typeof window !== "undefined") {
      window.dispatchEvent(new Event("avt-requests-updated"));
    }
  }

  async function toggleRequestExpanded(r) {
    const expanded = expandedRequestId === r.id;
    if (expanded) {
      setExpandedRequestId(null);
      return;
    }
    if ((Number(r.unread_offers_count) || 0) > 0 && token) {
      await fetch(`${API_URL}/requests/${r.id}/mark-offers-seen`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      });
      await loadMyRequestsOnly(token);
    }
    setExpandedRequestId(r.id);
  }

  async function loadRoleData(t, role) {
    if (role !== "dealer") {
      await loadMyRequestsOnly(t);
    }
    if (isStaffRole(role)) {
      await reloadParserJobsWithToken(t);
    }
    if (canCreateListings(role)) {
      const sc = await fetch(`${API_URL}/staff/my-cars`, { headers: { Authorization: `Bearer ${t}` } });
      if (sc.ok) setStaffCars(await sc.json());
    }
  }

  async function removeOwnListing(carId) {
    if (
      !window.confirm(
        "Снять объявление с публикации? Оно пропадёт из каталога, фото на сервере будут удалены."
      )
    ) {
      return;
    }
    setError("");
    setMessage("");
    setRemovingCarId(carId);
    try {
      const res = await fetch(`${API_URL}/staff/cars/${carId}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(typeof body.detail === "string" ? body.detail : "Не удалось снять объявление");
        return;
      }
      setStaffCars((prev) => prev.filter((c) => c.id !== carId));
      setMessage("Объявление снято с публикации");
    } finally {
      setRemovingCarId(null);
    }
  }

  async function saveProfile() {
    setError("");
    setMessage("");
    const body = {
      full_name: name,
      phone,
      display_name: displayName,
    };
    if (me?.role === "dealer") {
      body.company_name = companyName;
    }
    const res = await fetch(`${API_URL}/profile`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      setError("Не удалось обновить профиль");
      return;
    }
    setMessage("Профиль обновлен");
    const data = await res.json();
    setMe(data);
  }

  async function changePassword() {
    setError("");
    setMessage("");
    const res = await fetch(`${API_URL}/profile/password`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ old_password: oldPassword, new_password: newPassword }),
    });
    if (!res.ok) {
      setError("Не удалось сменить пароль");
      return;
    }
    setOldPassword("");
    setNewPassword("");
    setMessage("Пароль изменен");
    loadMe(token);
  }

  function logout() {
    clearToken();
    router.push("/");
  }

  async function selectClientOffer(offerId) {
    setError("");
    setMessage("");
    const res = await fetch(`${API_URL}/offers/${offerId}/select`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      setError(typeof body.detail === "string" ? body.detail : "Не удалось выбрать предложение");
      return;
    }
    setMessage("Дилер выбран. Переписка — в разделе «Сообщения» в шапке сайта.");
    await loadMyRequestsOnly(token);
  }

  async function openClientOfferChat(offerId) {
    setError("");
    setMessage("");
    setOpeningChatOfferId(offerId);
    try {
      const res = await fetch(`${API_URL}/offers/${offerId}/open-chat`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(typeof body.detail === "string" ? body.detail : "Не удалось открыть чат");
        return;
      }
      await loadMyRequestsOnly(token);
      const cid = body.chat_id;
      if (cid != null) {
        router.push(`/messages?chat=${encodeURIComponent(String(cid))}`);
      }
    } finally {
      setOpeningChatOfferId(null);
    }
  }

  return (
    <div className="layout">
      <header className="site-header">
        <div className="container site-header__inner">
          <Link href="/" className="site-logo">
            avtovozom
          </Link>
          <div className="auth-bar">
            <HeaderMessagesLink token={token} />
            <button type="button" className="btn btn-ghost btn-sm" onClick={logout}>
              Выйти
            </button>
          </div>
        </div>
      </header>
      <main className="site-main">
        <div className="container">
          <h1 className="section-title">Профиль</h1>
          {message && <div className="alert alert--success">{message}</div>}
          {error && <div className="alert alert--danger">{error}</div>}
          {!me ? (
            <p className="muted">Загрузка...</p>
          ) : (
            <>
              <section className="panel">
                <h2 className="section-title panel-heading-sm">Данные пользователя</h2>
                <p className="muted">
                  Email: <b>{me.email}</b> · Роль: <b>{me.role}</b>
                </p>
                {me.must_change_password && (
                  <div className="alert alert--warn">Вам нужно сменить временный пароль.</div>
                )}
                <div className="profile-field-grid">
                  <input className="input" placeholder="Имя (ФИО)" value={name} onChange={(e) => setName(e.target.value)} />
                  <label className="muted form-label">
                    Имя в чатах
                    <input
                      className="input"
                      placeholder="Как вас видят клиенты и дилеры"
                      value={displayName}
                      onChange={(e) => setDisplayName(e.target.value)}
                    />
                  </label>
                  {me.role === "dealer" ? (
                    <label className="muted form-label">
                      Название компании
                      <input
                        className="input"
                        placeholder="Для публичного профиля и чатов"
                        value={companyName}
                        onChange={(e) => setCompanyName(e.target.value)}
                      />
                    </label>
                  ) : null}
                  <input className="input" placeholder="Телефон" value={phone} onChange={(e) => setPhone(e.target.value)} />
                  <button type="button" className="btn btn-primary" onClick={saveProfile}>
                    Сохранить профиль
                  </button>
                </div>
              </section>

              {isStaffRole(me.role) && (
                <section className="panel">
                  <h2 className="section-title panel-heading-sm">Заявки на расчёт</h2>
                  <p className="muted section-title--flush-top">
                    Все заявки клиентов и ответы дилеров — в отдельном разделе.
                  </p>
                  <Link href="/staff/admin-requests" className="btn btn-primary btn-inline">
                    Открыть раздел «Заявки»
                  </Link>
                </section>
              )}

              {isAdminRole(me.role) && (
                <section className="panel" id="admin-settings">
                  <h2 className="section-title panel-heading-sm">Управление учётными записями</h2>
                  <p className="muted section-title--flush-top">
                    Список пользователей, создание, редактирование и сброс пароля.
                  </p>
                  <Link href="/staff/admin-users" className="btn btn-primary btn-inline">
                    Открыть управление УЗ
                  </Link>
                  <div style={{ marginTop: "0.65rem" }}>
                    <Link href="/staff/admin-customs-calculator" className="btn btn-secondary btn-inline">
                      Редактировать коэффициенты
                    </Link>
                  </div>
                </section>
              )}

              <section className="panel">
                <h2 className="section-title panel-heading-sm">Смена пароля</h2>
                <div className="profile-field-grid">
                  <input
                    className="input"
                    type="password"
                    placeholder="Старый пароль"
                    value={oldPassword}
                    onChange={(e) => setOldPassword(e.target.value)}
                  />
                  <input
                    className="input"
                    type="password"
                    placeholder="Новый пароль (минимум 8 символов)"
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                  />
                  <button type="button" className="btn btn-secondary" onClick={changePassword}>
                    Сменить пароль
                  </button>
                </div>
              </section>

              {me.role === "user" && (
                <section className="panel">
                  <h2 className="section-title panel-heading-sm section-title--inline">
                    Мои заявки на расчёт
                    {unreadOffersOnProfile > 0 ? (
                      <span
                        className="home-my-requests__new-indicator"
                        title="Появились новые расчёты от дилеров"
                        aria-label={`Новых расчётов: ${unreadOffersOnProfile}`}
                      >
                        <span className="home-my-requests__new-dot" aria-hidden />
                        <span className="home-my-requests__new-label">
                          {unreadOffersOnProfile === 1 ? "Новый расчёт" : `${unreadOffersOnProfile} новых`}
                        </span>
                      </span>
                    ) : null}
                  </h2>
                  <p className="muted section-title--flush-top">
                    Список заявок и расчётов дилеров только здесь. Разверните заявку, чтобы открыть объявление, комментарий
                    и предложения.
                  </p>
                  {requests.length === 0 ? (
                    <p className="muted">Заявок пока нет — выберите авто в каталоге и нажмите «Заказать расчёт».</p>
                  ) : (
                    <div className="profile-request-list">
                      {requests.map((r) => {
                        const expanded = expandedRequestId === r.id;
                        return (
                          <article key={r.id} className="profile-request-card">
                            <div
                              className={`profile-request-card__header${expanded ? " profile-request-card__header--expanded" : ""}`}
                              role="button"
                              tabIndex={0}
                              onClick={() => toggleRequestExpanded(r)}
                              onKeyDown={(e) => {
                                if (e.key === "Enter" || e.key === " ") {
                                  e.preventDefault();
                                  toggleRequestExpanded(r);
                                }
                              }}
                            >
                              {r.car_thumb_url ? (
                                <img
                                  className="profile-request-card__thumb-img"
                                  src={mediaSrc(r.car_thumb_url)}
                                  alt=""
                                  width={88}
                                  height={66}
                                />
                              ) : (
                                <div className="profile-request-card__thumb-ph" aria-hidden />
                              )}
                              <div className="profile-request-card__body">
                                <div className="profile-request-card__title-line">
                                  <span className="profile-request-card__title-text">
                                    {r.car_brand} {r.car_model}
                                    {r.car_year != null ? ` · ${r.car_year}` : ""}
                                  </span>
                                  {(Number(r.unread_offers_count) || 0) > 0 ? (
                                    <span className="home-my-requests__pill">Новый расчёт</span>
                                  ) : null}
                                </div>
                                <div className="muted profile-request-card__meta-tight">{r.car_title}</div>
                                <div className="muted profile-request-card__meta-loose">
                                  {formatRequestDate(r.created_at)} · {requestStatusLabel(r.status)}
                                  {r.offers?.length ? ` · ${r.offers.length} предлож.` : ""}
                                </div>
                              </div>
                              <span className="btn btn-ghost btn-sm profile-request-card__toggle">
                                {expanded ? "Свернуть" : "Подробнее"}
                              </span>
                            </div>
                            {expanded ? (
                              <div className="profile-request-card__expanded">
                                <div className="profile-offer-card__actions">
                                  <Link href={`/cars/${r.car_id}`} className="btn btn-secondary btn-sm">
                                    Открыть объявление
                                  </Link>
                                </div>
                                {r.comment ? (
                                  <div className="profile-comment-block">
                                    <div className="muted profile-comment-block__label">Ваш запрос</div>
                                    <p className="profile-comment-block__text">{r.comment}</p>
                                  </div>
                                ) : null}
                                <div>
                                  <div className="profile-offers-heading">Предложения дилеров</div>
                                  {!r.offers?.length ? (
                                    <p className="muted profile-offers-empty">
                                      Пока нет откликов. Как только дилер ответит, предложение появится здесь.
                                    </p>
                                  ) : (
                                    <ul className="profile-offers-list">
                                      {r.offers.map((o) => (
                                        <li key={o.id} className="profile-offer-card">
                                          <div className="profile-offer-card__title">
                                            {Math.round(o.total_price).toLocaleString("ru-RU")} {o.currency} · срок ~{" "}
                                            {o.eta_days} дн. · {offerStatusLabel(o.status)}
                                          </div>
                                          {o.terms_text ? (
                                            <p className="profile-offer-card__terms">{o.terms_text}</p>
                                          ) : null}
                                          <div className="profile-offer-card__actions">
                                            {o.chat_id ? (
                                              <Link
                                                href={`/messages?chat=${encodeURIComponent(String(o.chat_id))}`}
                                                className="btn btn-secondary btn-sm"
                                              >
                                                Перейти в чат
                                              </Link>
                                            ) : (
                                              <button
                                                type="button"
                                                className="btn btn-secondary btn-sm"
                                                disabled={openingChatOfferId === o.id}
                                                onClick={() => openClientOfferChat(o.id)}
                                              >
                                                {openingChatOfferId === o.id ? "Открываем…" : "Открыть чат"}
                                              </button>
                                            )}
                                            {r.status === "open" && o.status === "sent" ? (
                                              <button
                                                type="button"
                                                className="btn btn-primary btn-sm"
                                                onClick={() => selectClientOffer(o.id)}
                                              >
                                                Выбрать это предложение
                                              </button>
                                            ) : null}
                                          </div>
                                        </li>
                                      ))}
                                    </ul>
                                  )}
                                </div>
                              </div>
                            ) : null}
                          </article>
                        );
                      })}
                    </div>
                  )}
                </section>
              )}

              {canCreateListings(me.role) && (
                <section className="panel">
                  <h2 className="section-title panel-heading-sm">Объявления (ручная публикация)</h2>
                  <p className="muted section-title--flush-top">
                    Размещение авто с фото и характеристиками — для администраторов, модераторов и дилеров.
                  </p>
                  <Link href="/staff/new-listing" className="btn btn-primary btn-inline">
                    Добавить объявление
                  </Link>
                  {staffCars.length === 0 ? (
                    <p className="muted profile-staff-list__empty">
                      У вас пока нет опубликованных объявлений, созданных вручную.
                    </p>
                  ) : (
                    <ul className="profile-staff-list">
                      {staffCars.map((c) => {
                        const ph = [...(c.photos || [])].sort((a, b) => a.sort_order - b.sort_order)[0];
                        return (
                          <li key={c.id} className="profile-staff-list__item">
                            {ph && (
                              <img
                                className="profile-staff-list__thumb"
                                src={mediaSrc(ph.storage_url)}
                                alt=""
                                width={72}
                                height={54}
                              />
                            )}
                            <div className="profile-staff-list__body">
                              <Link href={publicCarHref(c)}>
                                #{c.id} · {c.brand} {c.model} · {c.year}
                              </Link>
                              <div className="muted profile-staff-list__meta">{c.title}</div>
                            </div>
                            <div className="profile-staff-list__actions">
                              <Link href={`/staff/edit-listing?id=${c.id}`} className="btn btn-secondary btn-sm">
                                Править
                              </Link>
                              <button
                                type="button"
                                className="btn btn-ghost btn-sm"
                                disabled={removingCarId === c.id}
                                onClick={() => removeOwnListing(c.id)}
                              >
                                {removingCarId === c.id ? "…" : "Снять"}
                              </button>
                            </div>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </section>
              )}

              {me.role === "dealer" && (
                <DealerOpenRequests
                  token={token}
                  onOpenChat={(chatId) =>
                    router.push(`/messages?chat=${encodeURIComponent(String(chatId))}`)
                  }
                  onChatsUpdated={() => {}}
                />
              )}

              {isStaffRole(me.role) && (
                <AdminParserPanel
                  token={token}
                  jobs={adminJobs}
                  onReload={() => reloadParserJobsWithToken(token)}
                />
              )}
            </>
          )}
        </div>
      </main>
    </div>
  );
}
