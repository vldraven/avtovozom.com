import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/router";

import HeaderProfileLink from "../../components/HeaderProfileLink";
import SiteHeader from "../../components/SiteHeader";
import { clearToken, getStoredToken } from "../../lib/auth";
import { PROMO_PLACEMENTS } from "../../lib/promo";
import { isAdminRole } from "../../lib/roles";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

function emptyCampaign() {
  return {
    slug: "",
    name: "",
    is_enabled: false,
    starts_at: "",
    ends_at: "",
    promo_code: "",
    accent_color: "#d9f43a",
    eyebrow: "",
    title_accent: "",
    title_rest: "",
    subtitle: "",
    cta_label: "Оставить заявку",
    cta_path: "/request-quote",
    hero_image_url: "",
    placements: PROMO_PLACEMENTS.map((p) => ({
      placement: p.key,
      is_enabled: true,
      image_url: "",
      badge: "",
      title: "",
      subtitle: "",
      kicker: "",
      cta_label: "",
    })),
  };
}

function toLocalInput(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function fromLocalInput(value) {
  if (!value) return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString();
}

function draftFromCampaign(c) {
  const byKey = Object.fromEntries((c.placements || []).map((p) => [p.placement, p]));
  return {
    slug: c.slug || "",
    name: c.name || "",
    is_enabled: Boolean(c.is_enabled),
    starts_at: toLocalInput(c.starts_at),
    ends_at: toLocalInput(c.ends_at),
    promo_code: c.promo_code || "",
    accent_color: c.accent_color || "#d9f43a",
    eyebrow: c.eyebrow || "",
    title_accent: c.title_accent || "",
    title_rest: c.title_rest || "",
    subtitle: c.subtitle || "",
    cta_label: c.cta_label || "",
    cta_path: c.cta_path || "/request-quote",
    hero_image_url: c.hero_image_url || "",
    placements: PROMO_PLACEMENTS.map((meta) => {
      const row = byKey[meta.key] || {};
      return {
        placement: meta.key,
        is_enabled: row.is_enabled !== false,
        image_url: row.image_url || "",
        badge: row.badge || "",
        title: row.title || "",
        subtitle: row.subtitle || "",
        kicker: row.kicker || "",
        cta_label: row.cta_label || "",
      };
    }),
  };
}

function payloadFromDraft(draft) {
  return {
    ...draft,
    starts_at: fromLocalInput(draft.starts_at),
    ends_at: fromLocalInput(draft.ends_at),
  };
}

export default function AdminPromoPage() {
  const router = useRouter();
  const [token, setToken] = useState("");
  const [me, setMe] = useState(null);
  const [items, setItems] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [draft, setDraft] = useState(emptyCampaign);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const routerRef = useRef(router);
  routerRef.current = router;

  const load = useCallback(async (t) => {
    const res = await fetch(`${API_URL}/admin/promo/campaigns`, {
      headers: { Authorization: `Bearer ${t}` },
      cache: "no-store",
    });
    if (!res.ok) {
      setError("Не удалось загрузить акции");
      return [];
    }
    const data = await res.json();
    setItems(Array.isArray(data) ? data : []);
    return Array.isArray(data) ? data : [];
  }, []);

  useEffect(() => {
    let cancelled = false;
    const t = getStoredToken();
    if (!t) {
      routerRef.current.push("/auth?next=/staff/admin-promo");
      return undefined;
    }
    setToken(t);
    (async () => {
      const meRes = await fetch(`${API_URL}/auth/me`, {
        headers: { Authorization: `Bearer ${t}` },
        cache: "no-store",
      });
      if (cancelled) return;
      if (!meRes.ok) {
        clearToken({ logout: true });
        routerRef.current.push("/auth?next=/staff/admin-promo");
        return;
      }
      const user = await meRes.json();
      if (!isAdminRole(user.role)) {
        routerRef.current.push("/profile");
        return;
      }
      setMe(user);
      const list = await load(t);
      if (cancelled) return;
      if (list[0]) {
        setSelectedId(list[0].id);
        setDraft(draftFromCampaign(list[0]));
      }
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [load]);

  function selectCampaign(c) {
    setSelectedId(c.id);
    setDraft(draftFromCampaign(c));
    setMessage("");
    setError("");
  }

  function newCampaign() {
    setSelectedId(null);
    setDraft(emptyCampaign());
    setMessage("");
    setError("");
  }

  function patchDraft(patch) {
    setDraft((prev) => ({ ...prev, ...patch }));
  }

  function patchPlacement(key, patch) {
    setDraft((prev) => ({
      ...prev,
      placements: prev.placements.map((p) => (p.placement === key ? { ...p, ...patch } : p)),
    }));
  }

  async function save() {
    if (!token) return;
    setSaving(true);
    setError("");
    setMessage("");
    try {
      const body = payloadFromDraft(draft);
      const url = selectedId
        ? `${API_URL}/admin/promo/campaigns/${selectedId}`
        : `${API_URL}/admin/promo/campaigns`;
      const res = await fetch(url, {
        method: selectedId ? "PUT" : "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(typeof data.detail === "string" ? data.detail : "Не удалось сохранить");
        return;
      }
      const list = await load(token);
      const saved = list.find((c) => c.id === data.id) || data;
      setSelectedId(saved.id);
      setDraft(draftFromCampaign(saved));
      setMessage("Сохранено");
    } finally {
      setSaving(false);
    }
  }

  async function toggleEnabled(enable) {
    if (!token || !selectedId) return;
    setSaving(true);
    setError("");
    try {
      const res = await fetch(
        `${API_URL}/admin/promo/campaigns/${selectedId}/${enable ? "enable" : "disable"}`,
        { method: "POST", headers: { Authorization: `Bearer ${token}` } }
      );
      if (!res.ok) {
        setError("Не удалось переключить акцию");
        return;
      }
      const list = await load(token);
      const saved = list.find((c) => c.id === selectedId);
      if (saved) setDraft(draftFromCampaign(saved));
      setMessage(enable ? "Акция включена (остальные выключены)" : "Акция выключена");
    } finally {
      setSaving(false);
    }
  }

  async function uploadImage(field, placementKey) {
    if (!token || !selectedId) {
      setError("Сначала сохраните акцию, потом загружайте картинки");
      return;
    }
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/*";
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return;
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch(`${API_URL}/admin/promo/campaigns/${selectedId}/upload`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        body: fd,
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(typeof data.detail === "string" ? data.detail : "Ошибка загрузки");
        return;
      }
      if (placementKey) patchPlacement(placementKey, { image_url: data.url });
      else patchDraft({ [field]: data.url });
      setMessage("Картинка загружена — не забудьте сохранить");
    };
    input.click();
  }

  async function removeCampaign() {
    if (!token || !selectedId) return;
    if (!confirm("Удалить эту акцию?")) return;
    const res = await fetch(`${API_URL}/admin/promo/campaigns/${selectedId}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) {
      setError("Не удалось удалить");
      return;
    }
    const list = await load(token);
    if (list[0]) selectCampaign(list[0]);
    else newCampaign();
    setMessage("Удалено");
  }

  if (loading) {
    return (
      <div className="layout">
        <SiteHeader />
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
      <SiteHeader authBarStyle={{ display: "flex", gap: 12, alignItems: "center" }}>
        <HeaderProfileLink token={token} userRole={me?.role} variant="ghost" />
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => clearToken({ logout: true })}>
          Выйти
        </button>
      </SiteHeader>
      <main className="site-main">
        <div className="container admin-promo">
          <p className="muted">
            <Link href="/profile">← Профиль</Link>
          </p>
          <div className="admin-promo__head">
            <h1 className="section-title">Промоакции и баннеры</h1>
            <button type="button" className="btn btn-secondary" onClick={newCampaign}>
              Новая акция
            </button>
          </div>
          <p className="muted admin-promo__hint">
            Одновременно активна только одна включённая акция в своих датах. После 30 ноября выключите акцию
            здесь — сайт вернётся к обычному виду без деплоя.
          </p>
          {error ? <div className="alert alert--danger">{error}</div> : null}
          {message ? <div className="alert alert--success">{message}</div> : null}

          <div className="admin-promo__layout">
            <aside className="admin-promo__list panel">
              <h2>Акции</h2>
              {items.length === 0 ? <p className="muted">Пока нет</p> : null}
              <ul>
                {items.map((c) => (
                  <li key={c.id}>
                    <button
                      type="button"
                      className={selectedId === c.id ? "is-active" : ""}
                      onClick={() => selectCampaign(c)}
                    >
                      <strong>{c.name || c.slug}</strong>
                      <span>
                        {c.is_currently_active ? "сейчас на сайте" : c.is_enabled ? "включена (вне дат)" : "выкл"}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </aside>

            <section className="panel admin-promo__editor">
              <label>
                Название (админка)
                <input className="input" value={draft.name} onChange={(e) => patchDraft({ name: e.target.value })} />
              </label>
              <label>
                Slug
                <input
                  className="input"
                  value={draft.slug}
                  onChange={(e) => patchDraft({ slug: e.target.value })}
                  placeholder="tg-30-nov-2026"
                />
              </label>
              <label>
                Код ?promo=
                <input
                  className="input"
                  value={draft.promo_code}
                  onChange={(e) => patchDraft({ promo_code: e.target.value })}
                  placeholder="tg-30"
                />
              </label>
              <div className="admin-promo__row">
                <label>
                  Старт
                  <input
                    className="input"
                    type="datetime-local"
                    value={draft.starts_at}
                    onChange={(e) => patchDraft({ starts_at: e.target.value })}
                  />
                </label>
                <label>
                  Конец
                  <input
                    className="input"
                    type="datetime-local"
                    value={draft.ends_at}
                    onChange={(e) => patchDraft({ ends_at: e.target.value })}
                  />
                </label>
              </div>
              <label>
                Акцент
                <input
                  className="input"
                  value={draft.accent_color}
                  onChange={(e) => patchDraft({ accent_color: e.target.value })}
                />
              </label>
              <label>
                Eyebrow
                <input className="input" value={draft.eyebrow} onChange={(e) => patchDraft({ eyebrow: e.target.value })} />
              </label>
              <label>
                Акцент в заголовке (−30%)
                <input
                  className="input"
                  value={draft.title_accent}
                  onChange={(e) => patchDraft({ title_accent: e.target.value })}
                />
              </label>
              <label>
                Остальной заголовок (можно с переносом строки)
                <textarea
                  className="input"
                  rows={2}
                  value={draft.title_rest}
                  onChange={(e) => patchDraft({ title_rest: e.target.value })}
                />
              </label>
              <label>
                Подзаголовок
                <textarea
                  className="input"
                  rows={3}
                  value={draft.subtitle}
                  onChange={(e) => patchDraft({ subtitle: e.target.value })}
                />
              </label>
              <div className="admin-promo__row">
                <label>
                  Текст CTA
                  <input
                    className="input"
                    value={draft.cta_label}
                    onChange={(e) => patchDraft({ cta_label: e.target.value })}
                  />
                </label>
                <label>
                  Путь CTA
                  <input
                    className="input"
                    value={draft.cta_path}
                    onChange={(e) => patchDraft({ cta_path: e.target.value })}
                  />
                </label>
              </div>
              <label>
                Фото hero (URL)
                <div className="admin-promo__row">
                  <input
                    className="input"
                    value={draft.hero_image_url}
                    onChange={(e) => patchDraft({ hero_image_url: e.target.value })}
                  />
                  <button type="button" className="btn btn-secondary" onClick={() => uploadImage("hero_image_url")}>
                    Загрузить
                  </button>
                </div>
              </label>

              <h2>Места показа</h2>
              {draft.placements.map((p) => {
                const meta = PROMO_PLACEMENTS.find((x) => x.key === p.placement);
                return (
                  <div key={p.placement} className="admin-promo__placement">
                    <label className="admin-promo__check">
                      <input
                        type="checkbox"
                        checked={p.is_enabled}
                        onChange={(e) => patchPlacement(p.placement, { is_enabled: e.target.checked })}
                      />
                      {meta?.label || p.placement}
                    </label>
                    {p.placement !== "home_hero" ? (
                      <>
                        <label>
                          Картинка
                          <div className="admin-promo__row">
                            <input
                              className="input"
                              value={p.image_url}
                              onChange={(e) => patchPlacement(p.placement, { image_url: e.target.value })}
                            />
                            <button
                              type="button"
                              className="btn btn-secondary"
                              onClick={() => uploadImage(null, p.placement)}
                            >
                              Файл
                            </button>
                          </div>
                        </label>
                        <div className="admin-promo__row">
                          <label>
                            Badge
                            <input
                              className="input"
                              value={p.badge}
                              onChange={(e) => patchPlacement(p.placement, { badge: e.target.value })}
                            />
                          </label>
                          <label>
                            Kicker
                            <input
                              className="input"
                              value={p.kicker}
                              onChange={(e) => patchPlacement(p.placement, { kicker: e.target.value })}
                            />
                          </label>
                        </div>
                        <label>
                          Заголовок баннера
                          <input
                            className="input"
                            value={p.title}
                            onChange={(e) => patchPlacement(p.placement, { title: e.target.value })}
                          />
                        </label>
                        <label>
                          CTA баннера
                          <input
                            className="input"
                            value={p.cta_label}
                            onChange={(e) => patchPlacement(p.placement, { cta_label: e.target.value })}
                          />
                        </label>
                      </>
                    ) : (
                      <p className="muted">Hero берёт тексты и фото из полей акции выше.</p>
                    )}
                  </div>
                );
              })}

              <div className="admin-promo__actions">
                <button type="button" className="btn btn-primary" disabled={saving} onClick={save}>
                  {saving ? "Сохранение…" : "Сохранить"}
                </button>
                {selectedId ? (
                  <>
                    <button type="button" className="btn btn-secondary" disabled={saving} onClick={() => toggleEnabled(true)}>
                      Включить на сайте
                    </button>
                    <button type="button" className="btn btn-ghost" disabled={saving} onClick={() => toggleEnabled(false)}>
                      Выключить
                    </button>
                    <button type="button" className="btn btn-ghost" onClick={removeCampaign}>
                      Удалить
                    </button>
                  </>
                ) : null}
              </div>
            </section>
          </div>
        </div>
      </main>
    </div>
  );
}
