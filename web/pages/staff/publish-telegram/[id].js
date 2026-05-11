import Link from "next/link";
import { useRouter } from "next/router";
import { useCallback, useEffect, useMemo, useState } from "react";

import HeaderProfileLink from "../../../components/HeaderProfileLink";
import { clearToken, getStoredToken } from "../../../lib/auth";
import { mediaSrc } from "../../../lib/media";
import { isAdminRole } from "../../../lib/roles";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";
const MAX_TELEGRAM_PHOTOS = 10;
const DEFAULT_SELECTION = 5;

function escapeHtml(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Простой предпросмотр: переносы строк и ссылки http(s) */
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

export default function PublishTelegramPage() {
  const router = useRouter();
  const rawId = router.query.id;
  const carId = rawId == null ? "" : String(Array.isArray(rawId) ? rawId[0] : rawId).trim();

  const [token, setToken] = useState("");
  const [me, setMe] = useState(null);
  const [data, setData] = useState(null);
  const [loadError, setLoadError] = useState("");
  const [selected, setSelected] = useState(() => new Set());
  const [postText, setPostText] = useState("");
  const [styleHint, setStyleHint] = useState("");
  const [aiBusy, setAiBusy] = useState(false);
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
    const res = await fetch(`${API_URL}/admin/cars/${encodeURIComponent(carId)}/telegram-compose`, {
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
    const ids = (j.photos || []).map((p) => p.id);
    const first = ids.slice(0, Math.min(DEFAULT_SELECTION, ids.length, MAX_TELEGRAM_PHOTOS));
    setSelected(new Set(first));
  }, [token, carId]);

  useEffect(() => {
    if (!router.isReady) return;
    const t = getStoredToken();
    if (!t) {
      router.push(`/auth?next=${encodeURIComponent(`/staff/publish-telegram/${carId}`)}`);
      return;
    }
    setToken(t);
    (async () => {
      const res = await fetch(`${API_URL}/auth/me`, { headers: { Authorization: `Bearer ${t}` } });
      if (!res.ok) {
        clearToken();
        router.push(`/auth?next=${encodeURIComponent(`/staff/publish-telegram/${carId}`)}`);
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

  const photosSorted = useMemo(() => (data?.photos ? [...data.photos].sort((a, b) => a.sort_order - b.sort_order || a.id - b.id) : []), [data]);

  function togglePhoto(id) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else if (next.size < MAX_TELEGRAM_PHOTOS) next.add(id);
      else setMessage(`Не более ${MAX_TELEGRAM_PHOTOS} фото в одном посте Telegram`);
      return next;
    });
  }

  async function runAiDraft() {
    setError("");
    setMessage("");
    if (!token || !carId) return;
    setAiBusy(true);
    try {
      const res = await fetch(`${API_URL}/admin/cars/${encodeURIComponent(carId)}/telegram/ai-draft`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          style_hint: styleHint.trim() || null,
          selected_photo_ids: [...selected],
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok || !body.ok) {
        setError(body.detail || "Не удалось сгенерировать текст");
        return;
      }
      setPostText(body.text || "");
      setMessage("Текст сгенерирован — при необходимости отредактируйте перед публикацией.");
    } catch {
      setError("Сбой сети или таймаут");
    } finally {
      setAiBusy(false);
    }
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
      const res = await fetch(`${API_URL}/admin/cars/${encodeURIComponent(carId)}/telegram/publish`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ text, photo_ids }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok || !body.ok) {
        setError(body.detail || "Публикация не выполнена");
        return;
      }
      setMessage("Готово: пост отправлен в канал (через n8n).");
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
          <h1 className="section-title">Пост в Telegram</h1>
          <p className="muted" style={{ marginTop: "-0.5rem", marginBottom: "1.25rem" }}>
            Выберите фото, подготовьте текст и опубликуйте в канал. Генерация текста выполняется в n8n.
          </p>

          {!me ? (
            <p className="muted">Проверка доступа…</p>
          ) : loadError ? (
            <div className="alert alert--danger">{loadError}</div>
          ) : !data ? (
            <p className="muted">Загрузка объявления…</p>
          ) : (
            <>
              <div className="panel" style={{ marginBottom: "1rem" }}>
                <h2 className="panel-heading-sm">Объявление</h2>
                <p style={{ margin: "0.25rem 0", fontWeight: 600 }}>
                  {data.title}
                </p>
                <p className="muted" style={{ margin: "0 0 0.5rem", fontSize: "0.9rem" }}>
                  {data.brand} {data.model}
                  {data.generation ? ` · ${data.generation}` : ""} · {data.year}
                  {data.mileage_km != null ? ` · ${Number(data.mileage_km).toLocaleString("ru-RU")} км` : ""}
                  {data.location_city ? ` · ${data.location_city}` : ""}
                </p>
                <p style={{ margin: "0.25rem 0" }}>
                  Цена: <strong>{Number(data.price_cny).toLocaleString("ru-RU")} ¥</strong>
                  {data.rub_china != null ? (
                    <span className="muted"> · в Китае ~{Math.round(data.rub_china).toLocaleString("ru-RU")} ₽ (ЦБ)</span>
                  ) : null}
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
                <h2 className="panel-heading-sm">Фото в пост (до {MAX_TELEGRAM_PHOTOS})</h2>
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
                        border: selected.has(p.id) ? "2px solid var(--color-primary, #1976d2)" : "1px solid var(--color-border, #e2e8f0)",
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
                <h2 className="panel-heading-sm">Пожелания к ИИ (необязательно)</h2>
                <textarea
                  className="input"
                  rows={2}
                  value={styleHint}
                  onChange={(e) => setStyleHint(e.target.value)}
                  placeholder="Например: короче, акцент на цену, без эмодзи"
                />
              </div>

              <div className="panel" style={{ marginBottom: "1rem" }}>
                <h2 className="panel-heading-sm">Текст поста</h2>
                <textarea
                  className="input"
                  rows={12}
                  value={postText}
                  onChange={(e) => setPostText(e.target.value)}
                  placeholder="Текст для Telegram…"
                />
                <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 10 }}>
                  <button type="button" className="btn btn-secondary" disabled={aiBusy} onClick={runAiDraft}>
                    {aiBusy ? "Генерация…" : "Сгенерировать текст (ИИ)"}
                  </button>
                  <button type="button" className="btn btn-primary" disabled={publishBusy} onClick={publish}>
                    {publishBusy ? "Публикация…" : "Опубликовать в канал"}
                  </button>
                </div>
              </div>

              <div className="panel" style={{ marginBottom: "2rem" }}>
                <h2 className="panel-heading-sm">Предпросмотр</h2>
                <div
                  className="telegram-preview-box"
                  style={{
                    whiteSpace: "pre-wrap",
                    wordBreak: "break-word",
                    padding: "0.75rem 1rem",
                    background: "#f8fafc",
                    borderRadius: 8,
                    fontSize: "0.95rem",
                    lineHeight: 1.5,
                  }}
                  dangerouslySetInnerHTML={{ __html: previewHtml(postText) || "<span class='muted'>(пусто)</span>" }}
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
