import Link from "next/link";
import { useRouter } from "next/router";
import { useCallback, useEffect, useMemo, useState } from "react";

import HeaderProfileLink from "../../components/HeaderProfileLink";
import { clearToken, getStoredToken } from "../../lib/auth";
import { mediaSrc } from "../../lib/media";
import { isAdminRole } from "../../lib/roles";
import SiteHeader from "../../components/SiteHeader";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

function todayMskIso() {
  try {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: "Europe/Moscow",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date());
  } catch {
    return new Date().toISOString().slice(0, 10);
  }
}

function daysAgoMskIso(days) {
  const base = todayMskIso();
  const d = new Date(`${base}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}

function escapeHtml(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function previewHtml(text) {
  const escaped = escapeHtml(text);
  return escaped
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((line) =>
      line.replace(/(https?:\/\/[^\s<]+)/gi, (url) => {
        const safe = escapeHtml(url);
        return `<a href="${safe}" target="_blank" rel="noopener noreferrer">${safe}</a>`;
      })
    )
    .join("<br />");
}

function buildSkeletonFromItems(items, periodLabel) {
  if (!items?.length) return "";
  const lines = [
    `🆕 Новые поступления на avtovozom.com (${periodLabel})`,
    "",
    "Подборка свежих авто из Китая под ключ — с растаможкой и доставкой до Москвы.",
    "",
  ];
  for (const it of items) {
    lines.push(`🚗 ${it.title} — ${it.price_label}`, "");
    if (it.specs_line) lines.push(it.specs_line, "");
    const brand = it.brand || "модель";
    lines.push(
      `Компактный обзор: ${brand} в нашей витрине — подробности комплектации и расчёт доставки до вашего города на сайте.`,
      "",
      it.listing_web_url || "",
      ""
    );
  }
  lines.push(
    "Смотрите весь каталог на сайте или напишите нам: @avtovozombot — подберём авто под бюджет."
  );
  return lines.join("\n").trim();
}

export default function PublishDigestPage() {
  const router = useRouter();
  const [token, setToken] = useState("");
  const [me, setMe] = useState(null);
  const [dateFrom, setDateFrom] = useState(() => daysAgoMskIso(6));
  const [dateTo, setDateTo] = useState(() => todayMskIso());
  const [compose, setCompose] = useState(null);
  const [selected, setSelected] = useState(() => new Set());
  const [postText, setPostText] = useState("");
  const [revision, setRevision] = useState("");
  const [channelTg, setChannelTg] = useState(true);
  const [channelMax, setChannelMax] = useState(true);
  const [loadBusy, setLoadBusy] = useState(false);
  const [aiBusy, setAiBusy] = useState(false);
  const [publishBusy, setPublishBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const logout = () => {
    clearToken({ logout: true });
    router.push("/");
  };

  useEffect(() => {
    if (!router.isReady) return;
    const t = getStoredToken();
    if (!t) {
      router.push(`/auth?next=${encodeURIComponent("/staff/publish-digest")}`);
      return;
    }
    setToken(t);
    (async () => {
      const res = await fetch(`${API_URL}/auth/me`, { headers: { Authorization: `Bearer ${t}` } });
      if (!res.ok) {
        clearToken();
        router.push(`/auth?next=${encodeURIComponent("/staff/publish-digest")}`);
        return;
      }
      const u = await res.json();
      setMe(u);
      if (!isAdminRole(u.role)) router.replace("/");
    })();
  }, [router]);

  const loadCompose = useCallback(async () => {
    if (!token) return;
    setLoadBusy(true);
    setError("");
    setMessage("");
    try {
      const qs = new URLSearchParams({
        date_from: dateFrom,
        date_to: dateTo,
      });
      const res = await fetch(`${API_URL}/admin/social/digest/compose?${qs}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(typeof body.detail === "string" ? body.detail : "Не удалось загрузить подборку");
        setCompose(null);
        return;
      }
      setCompose(body);
      setSelected(new Set());
      setPostText("");
      setMessage(
        body.count
          ? `Найдено ${body.count} авто за ${body.period_label} — отметьте нужные для поста (до ${body.max_cars || 10})`
          : `За ${body.period_label} новых объявлений нет`
      );
    } catch {
      setError("Сбой сети");
    } finally {
      setLoadBusy(false);
    }
  }, [token, dateFrom, dateTo]);

  useEffect(() => {
    if (!token || !me || !isAdminRole(me.role)) return;
    loadCompose();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- initial load
  }, [token, me]);

  const selectedItems = useMemo(() => {
    if (!compose?.items) return [];
    return compose.items.filter((it) => selected.has(it.car_id));
  }, [compose, selected]);

  const maxPublish = compose?.max_cars || 10;

  function refreshSkeletonFromSelection(nextSelected) {
    if (!compose?.items?.length) {
      setPostText("");
      return;
    }
    const items = compose.items.filter((it) => nextSelected.has(it.car_id));
    setPostText(buildSkeletonFromItems(items, compose.period_label || ""));
  }

  function toggleCar(id) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else if (next.size < maxPublish) next.add(id);
      else {
        setMessage(`Не более ${maxPublish} авто в одном дайджесте (лимит альбома TG)`);
        return prev;
      }
      refreshSkeletonFromSelection(next);
      return next;
    });
  }

  async function runAiDraft() {
    if (!token) return;
    if (!selectedItems.length) {
      setError("Выберите хотя бы одно авто");
      return;
    }
    setAiBusy(true);
    setError("");
    setMessage("");
    try {
      const res = await fetch(`${API_URL}/admin/social/digest/ai-draft`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          date_from: dateFrom,
          date_to: dateTo,
          car_ids: selectedItems.map((it) => it.car_id),
          revision: revision.trim() || null,
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok || !body.ok) {
        if (body.text) setPostText(body.text);
        setError(body.detail || "Не удалось сгенерировать текст ИИ — оставлен каркас");
        return;
      }
      setPostText(body.text || "");
      setMessage("Текст дайджеста сгенерирован — отредактируйте при необходимости.");
    } catch {
      setError("Сбой сети или таймаут ИИ");
    } finally {
      setAiBusy(false);
    }
  }

  async function publish() {
    const text = postText.trim();
    if (!text) {
      setError("Введите текст дайджеста");
      return;
    }
    if (!channelTg && !channelMax) {
      setError("Выберите Telegram и/или MAX");
      return;
    }
    if (!selectedItems.length) {
      setError("Выберите авто для обложек");
      return;
    }
    setPublishBusy(true);
    setError("");
    setMessage("");
    try {
      const res = await fetch(`${API_URL}/admin/social/digest/publish`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          text,
          car_ids: selectedItems.map((it) => it.car_id),
          channel_tg: channelTg,
          channel_max: channelMax,
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok || !body.ok) {
        setError(body.detail || "Ошибка публикации");
        return;
      }
      setMessage(body.detail || "Опубликовано");
    } catch {
      setError("Сбой сети или таймаут");
    } finally {
      setPublishBusy(false);
    }
  }

  return (
    <div className="layout">
      <SiteHeader authBarStyle={{ display: "flex", gap: 12, alignItems: "center" }}>
        <HeaderProfileLink token={token} userRole={me?.role} variant="ghost" />
        <button type="button" className="btn btn-ghost btn-sm" onClick={logout}>
          Выйти
        </button>
      </SiteHeader>

      <main className="site-main">
        <div className="container" style={{ maxWidth: 840 }}>
          <p style={{ marginBottom: "0.5rem" }}>
            <Link href="/">&larr; На главную</Link>
            {" · "}
            <Link href="/profile">Профиль</Link>
          </p>
          <h1 className="section-title">Дайджест новых поступлений</h1>
          <p className="muted" style={{ marginTop: "-0.5rem", marginBottom: "1.25rem" }}>
            Все авто за период → отметьте нужные вручную → текст (каркас или ИИ) → публикация в
            Telegram и/или MAX с обложками.
          </p>

          {!me ? (
            <p className="muted">Проверка доступа…</p>
          ) : (
            <>
              <div className="panel" style={{ marginBottom: "1rem" }}>
                <h2 className="panel-heading-sm">Период (МСК)</h2>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 12, alignItems: "end" }}>
                  <label style={{ display: "grid", gap: 4 }}>
                    <span className="muted" style={{ fontSize: "0.85rem" }}>
                      С
                    </span>
                    <input
                      className="input"
                      type="date"
                      value={dateFrom}
                      onChange={(e) => setDateFrom(e.target.value)}
                    />
                  </label>
                  <label style={{ display: "grid", gap: 4 }}>
                    <span className="muted" style={{ fontSize: "0.85rem" }}>
                      По
                    </span>
                    <input
                      className="input"
                      type="date"
                      value={dateTo}
                      onChange={(e) => setDateTo(e.target.value)}
                    />
                  </label>
                  <button type="button" className="btn btn-secondary" disabled={loadBusy} onClick={loadCompose}>
                    {loadBusy ? "Загрузка…" : "Показать авто"}
                  </button>
                </div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 10 }}>
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    onClick={() => {
                      setDateFrom(todayMskIso());
                      setDateTo(todayMskIso());
                    }}
                  >
                    Сегодня
                  </button>
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    onClick={() => {
                      setDateFrom(daysAgoMskIso(6));
                      setDateTo(todayMskIso());
                    }}
                  >
                    7 дней
                  </button>
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    onClick={() => {
                      setDateFrom(daysAgoMskIso(13));
                      setDateTo(todayMskIso());
                    }}
                  >
                    14 дней
                  </button>
                </div>
              </div>

              <div className="panel" style={{ marginBottom: "1rem" }}>
                <h2 className="panel-heading-sm">Каналы</h2>
                <label style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 8 }}>
                  <input type="checkbox" checked={channelTg} onChange={(e) => setChannelTg(e.target.checked)} />
                  Telegram-канал
                </label>
                <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
                  <input type="checkbox" checked={channelMax} onChange={(e) => setChannelMax(e.target.checked)} />
                  MAX-канал
                </label>
              </div>

              {compose ? (
                <div className="panel" style={{ marginBottom: "1rem" }}>
                  <h2 className="panel-heading-sm">
                    Авто за период ({selected.size} выбрано / {compose.count}
                    {compose.max_cars ? `, до ${compose.max_cars} в пост` : ""})
                  </h2>
                  {!compose.items?.length ? (
                    <p className="muted">Пусто — смените период.</p>
                  ) : (
                    <>
                      <p className="muted" style={{ marginTop: 0, fontSize: "0.9rem" }}>
                        Отметьте объявления для публикации вручную.
                      </p>
                    <div style={{ display: "grid", gap: 10 }}>
                      {compose.items.map((it) => (
                        <label
                          key={it.car_id}
                          style={{
                            display: "grid",
                            gridTemplateColumns: "28px 96px 1fr",
                            gap: 12,
                            alignItems: "center",
                            border: selected.has(it.car_id)
                              ? "2px solid var(--color-primary, #1976d2)"
                              : "1px solid var(--color-border, #e2e8f0)",
                            borderRadius: 8,
                            padding: 8,
                            cursor: "pointer",
                          }}
                        >
                          <input
                            type="checkbox"
                            checked={selected.has(it.car_id)}
                            onChange={() => toggleCar(it.car_id)}
                          />
                          {it.cover_absolute_url || it.cover_storage_url ? (
                            <img
                              src={it.cover_absolute_url || mediaSrc(it.cover_storage_url)}
                              alt=""
                              style={{
                                width: 96,
                                height: 72,
                                objectFit: "cover",
                                borderRadius: 6,
                                display: "block",
                              }}
                            />
                          ) : (
                            <div
                              className="muted"
                              style={{
                                width: 96,
                                height: 72,
                                display: "grid",
                                placeItems: "center",
                                background: "#f1f5f9",
                                borderRadius: 6,
                                fontSize: "0.75rem",
                              }}
                            >
                              нет фото
                            </div>
                          )}
                          <div>
                            <div style={{ fontWeight: 600 }}>{it.title}</div>
                            <div className="muted" style={{ fontSize: "0.85rem" }}>
                              {it.price_label}
                              {it.specs_line ? ` · ${it.specs_line}` : ""}
                              {it.created_at_msk ? ` · добавлено ${it.created_at_msk}` : ""}
                            </div>
                            <a href={it.listing_web_url} target="_blank" rel="noopener noreferrer">
                              На сайте
                            </a>
                          </div>
                        </label>
                      ))}
                    </div>
                    </>
                  )}
                </div>
              ) : null}

              <div className="panel" style={{ marginBottom: "1rem" }}>
                <h2 className="panel-heading-sm">Пожелания для ИИ (необязательно)</h2>
                <textarea
                  className="input"
                  rows={3}
                  value={revision}
                  onChange={(e) => setRevision(e.target.value)}
                  placeholder="Например: короче вступление, без эмодзи, акцент на льготный УС"
                />
              </div>

              <div className="panel" style={{ marginBottom: "1rem" }}>
                <h2 className="panel-heading-sm">Текст дайджеста</h2>
                <textarea
                  className="input"
                  rows={16}
                  value={postText}
                  onChange={(e) => setPostText(e.target.value)}
                  placeholder="Текст подборки…"
                />
                <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 10 }}>
                  <button type="button" className="btn btn-secondary" disabled={aiBusy} onClick={runAiDraft}>
                    {aiBusy ? "Генерация…" : "Сгенерировать текст (ИИ)"}
                  </button>
                  <button type="button" className="btn btn-primary" disabled={publishBusy} onClick={publish}>
                    {publishBusy ? "Публикация…" : "Опубликовать"}
                  </button>
                </div>
              </div>

              <div className="panel" style={{ marginBottom: "2rem" }}>
                <h2 className="panel-heading-sm">Предпросмотр</h2>
                <div
                  style={{
                    whiteSpace: "pre-wrap",
                    wordBreak: "break-word",
                    padding: "0.75rem 1rem",
                    background: "#f8fafc",
                    borderRadius: 8,
                    fontSize: "0.95rem",
                    lineHeight: 1.5,
                  }}
                  dangerouslySetInnerHTML={{
                    __html: previewHtml(postText) || "<span class='muted'>(пусто)</span>",
                  }}
                />
              </div>

              {message ? <div className="alert alert--success">{message}</div> : null}
              {error ? <div className="alert alert--danger">{error}</div> : null}
            </>
          )}
        </div>
      </main>
    </div>
  );
}
