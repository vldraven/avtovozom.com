import Link from "next/link";
import { useRouter } from "next/router";
import { useCallback, useEffect, useMemo, useState } from "react";

import HeaderProfileLink from "../../../components/HeaderProfileLink";
import { clearToken, getStoredToken } from "../../../lib/auth";
import { mediaSrc } from "../../../lib/media";
import { isAdminRole } from "../../../lib/roles";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";
const MAX_VK_PHOTOS = 10;
const DEFAULT_SELECTION = 5;

function escapeHtml(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function previewHtml(text) {
  const escaped = escapeHtml(text);
  const withBreaks = escaped.replace(/\r\n/g, "\n").split("\n");
  return withBreaks
    .map((line) =>
      line.replace(/(https?:\/\/[^\s<]+)/gi, (url) => {
        const safe = escapeHtml(url);
        return `<a href="${safe}" target="_blank" rel="noopener noreferrer">${safe}</a>`;
      })
    )
    .join("<br />");
}

export default function PublishVkPage() {
  const router = useRouter();
  const rawId = router.query.id;
  const carId = rawId == null ? "" : String(Array.isArray(rawId) ? rawId[0] : rawId).trim();

  const [token, setToken] = useState("");
  const [me, setMe] = useState(null);
  const [data, setData] = useState(null);
  const [loadError, setLoadError] = useState("");
  const [selected, setSelected] = useState(() => new Set());
  const [postText, setPostText] = useState("");
  const [attachLink, setAttachLink] = useState(true);
  const [publishBusy, setPublishBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const logout = () => {
    clearToken();
    router.push("/");
  };

  const loadCompose = useCallback(async () => {
    if (!token || !carId) return;
    setLoadError("");
    const res = await fetch(`${API_URL}/admin/cars/${encodeURIComponent(carId)}/vk-compose`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      const d = body.detail;
      setLoadError(typeof d === "string" ? d : "Не удалось загрузить объявление");
      setData(null);
      return;
    }
    const j = await res.json();
    setData(j);
    setPostText(j.default_text || "");
    const ids = (j.photos || []).map((p) => p.id);
    const max = Math.min(DEFAULT_SELECTION, ids.length, j.max_photos || MAX_VK_PHOTOS);
    setSelected(new Set(ids.slice(0, max)));
  }, [token, carId]);

  useEffect(() => {
    if (!router.isReady) return;
    const t = getStoredToken();
    if (!t) {
      router.push(`/auth?next=${encodeURIComponent(`/staff/publish-vk/${carId}`)}`);
      return;
    }
    setToken(t);
    (async () => {
      const res = await fetch(`${API_URL}/auth/me`, { headers: { Authorization: `Bearer ${t}` } });
      if (!res.ok) {
        clearToken();
        router.push(`/auth?next=${encodeURIComponent(`/staff/publish-vk/${carId}`)}`);
        return;
      }
      const u = await res.json();
      setMe(u);
      if (!isAdminRole(u.role)) {
        router.replace("/");
      }
    })();
  }, [router, carId]);

  useEffect(() => {
    if (!token || !carId || !me || !isAdminRole(me.role)) return;
    loadCompose();
  }, [token, carId, me, loadCompose]);

  const photosSorted = useMemo(
    () => (data?.photos ? [...data.photos].sort((a, b) => a.sort_order - b.sort_order || a.id - b.id) : []),
    [data]
  );
  const maxPhotos = data?.max_photos || MAX_VK_PHOTOS;

  function togglePhoto(id) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else if (next.size < maxPhotos) next.add(id);
      else setMessage(`Не более ${maxPhotos} фото в одном посте VK`);
      return next;
    });
  }

  async function publish() {
    setError("");
    setMessage("");
    const text = postText.trim();
    if (!text) {
      setError("Введите текст поста");
      return;
    }
    if (!token || !carId) return;
    setPublishBusy(true);
    try {
      const photo_ids = photosSorted.filter((p) => selected.has(p.id)).map((p) => p.id);
      const res = await fetch(`${API_URL}/admin/cars/${encodeURIComponent(carId)}/vk/publish`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          text,
          photo_ids,
          attach_listing_link: attachLink,
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok || !body.ok) {
        setError(body.detail || "Публикация не выполнена");
        return;
      }
      const url = body.vk_url ? ` ${body.vk_url}` : "";
      setMessage(`Готово: пост опубликован в группу VK.${url}`);
      await loadCompose();
    } catch {
      setError("Сбой сети или таймаут");
    } finally {
      setPublishBusy(false);
    }
  }

  if (!router.isReady || !carId) {
    return (
      <div className="layout">
        <main className="site-main">
          <div className="container">
            <p className="muted">Загрузка…</p>
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
        <div className="container" style={{ maxWidth: 840 }}>
          <p style={{ marginBottom: "0.5rem" }}>
            <Link href="/">&larr; На главную</Link>
          </p>
          <h1 className="section-title">Пост в VK</h1>
          <p className="muted" style={{ marginTop: "-0.5rem", marginBottom: "1.25rem" }}>
            Выберите фото и текст — публикация на стену группы от имени сообщества (VK API).
          </p>

          {!me ? (
            <p className="muted">Проверка доступа…</p>
          ) : loadError ? (
            <div className="alert alert--danger">{loadError}</div>
          ) : !data ? (
            <p className="muted">Загрузка объявления…</p>
          ) : (
            <>
              {!data.vk_configured ? (
                <div className="alert alert--danger" style={{ marginBottom: "1rem" }}>
                  VK не настроен на сервере. Задайте <code>VK_GROUP_ID</code> и{" "}
                  <code>VK_USER_ACCESS_TOKEN</code> (user token со scopes photos, wall, offline).
                </div>
              ) : null}

              {data.publication?.vk_url ? (
                <div className="alert alert--success" style={{ marginBottom: "1rem" }}>
                  Уже публиковалось:{" "}
                  <a href={data.publication.vk_url} target="_blank" rel="noopener noreferrer">
                    {data.publication.vk_url}
                  </a>
                  {data.publication.status ? (
                    <span className="muted"> · статус {data.publication.status}</span>
                  ) : null}
                </div>
              ) : null}

              <div className="panel" style={{ marginBottom: "1rem" }}>
                <h2 className="panel-heading-sm">Объявление</h2>
                <p style={{ margin: "0.25rem 0", fontWeight: 600 }}>{data.title}</p>
                <p className="muted" style={{ margin: "0 0 0.5rem", fontSize: "0.9rem" }}>
                  {data.brand} {data.model}
                  {data.generation ? ` · ${data.generation}` : ""} · {data.year}
                  {data.mileage_km != null
                    ? ` · ${Number(data.mileage_km).toLocaleString("ru-RU")} км`
                    : ""}
                </p>
                <p style={{ margin: "0.25rem 0" }}>
                  Цена: <strong>{Number(data.price_cny).toLocaleString("ru-RU")} ¥</strong>
                  {data.estimated_total_rub != null ? (
                    <span>
                      {" "}
                      · <strong>~{Math.round(data.estimated_total_rub).toLocaleString("ru-RU")} ₽</strong>
                      <span className="muted"> в РФ (оценка)</span>
                    </span>
                  ) : null}
                </p>
                <p style={{ margin: "0.5rem 0 0" }}>
                  <a href={data.canonical_web_url} target="_blank" rel="noopener noreferrer">
                    Карточка на сайте
                  </a>
                </p>
              </div>

              <div className="panel" style={{ marginBottom: "1rem" }}>
                <h2 className="panel-heading-sm">Фото в пост (до {maxPhotos})</h2>
                <p className="muted" style={{ fontSize: "0.85rem", marginTop: 0 }}>
                  Отмечено: {selected.size}
                </p>
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "repeat(auto-fill, minmax(120px, 1fr))",
                    gap: 10,
                  }}
                >
                  {photosSorted.map((p) => (
                    <label
                      key={p.id}
                      style={{
                        cursor: "pointer",
                        border: selected.has(p.id)
                          ? "2px solid var(--color-primary, #1976d2)"
                          : "1px solid var(--color-border, #e2e8f0)",
                        borderRadius: 8,
                        overflow: "hidden",
                        display: "block",
                      }}
                    >
                      <input
                        type="checkbox"
                        checked={selected.has(p.id)}
                        onChange={() => togglePhoto(p.id)}
                        style={{ position: "absolute", opacity: 0, width: 0 }}
                      />
                      <img
                        src={mediaSrc(p.storage_url)}
                        alt=""
                        style={{ width: "100%", aspectRatio: "4/3", objectFit: "cover", display: "block" }}
                      />
                    </label>
                  ))}
                </div>
              </div>

              <div className="panel" style={{ marginBottom: "1rem" }}>
                <h2 className="panel-heading-sm">Текст поста</h2>
                <textarea
                  className="input"
                  rows={12}
                  value={postText}
                  onChange={(e) => setPostText(e.target.value)}
                  placeholder="Текст для стены группы VK…"
                />
                <label
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    marginTop: 10,
                    fontSize: "0.9rem",
                  }}
                >
                  <input
                    type="checkbox"
                    checked={attachLink}
                    onChange={(e) => setAttachLink(e.target.checked)}
                  />
                  Прикрепить ссылку на карточку сайта
                </label>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 10 }}>
                  <button
                    type="button"
                    className="btn btn-secondary"
                    onClick={() => setPostText(data.default_text || "")}
                  >
                    Сбросить к шаблону
                  </button>
                  <button
                    type="button"
                    className="btn btn-primary"
                    disabled={publishBusy || !data.vk_configured}
                    onClick={publish}
                  >
                    {publishBusy ? "Публикация…" : "Опубликовать в группу"}
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
