import Link from "next/link";
import { useRouter } from "next/router";
import { useCallback, useEffect, useMemo, useState } from "react";

import HeaderProfileLink from "../../../components/HeaderProfileLink";
import { clearToken, getStoredToken } from "../../../lib/auth";
import { mediaSrc } from "../../../lib/media";
import { isAdminRole } from "../../../lib/roles";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";
const MAX_AVITO_PHOTOS = 20;
const DEFAULT_SELECTION = 8;

export default function PublishAvitoPage() {
  const router = useRouter();
  const rawId = router.query.id;
  const carId = rawId == null ? "" : String(Array.isArray(rawId) ? rawId[0] : rawId).trim();

  const [token, setToken] = useState("");
  const [me, setMe] = useState(null);
  const [data, setData] = useState(null);
  const [loadError, setLoadError] = useState("");
  const [selected, setSelected] = useState(() => new Set());
  const [description, setDescription] = useState("");
  const [region, setRegion] = useState("");
  const [carType, setCarType] = useState("");
  const [bodyType, setBodyType] = useState("");
  const [driveType, setDriveType] = useState("");
  const [contactPhone, setContactPhone] = useState("");
  const [make, setMake] = useState("");
  const [model, setModel] = useState("");
  const [priceRub, setPriceRub] = useState("");
  const [publishBusy, setPublishBusy] = useState(false);
  const [statusBusy, setStatusBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const logout = () => {
    clearToken();
    router.push("/");
  };

  const applyCompose = useCallback((j) => {
    setData(j);
    setDescription(j.description || "");
    setRegion(j.defaults?.region || "");
    setCarType(j.defaults?.car_type || "");
    setBodyType(j.defaults?.body_type || "Седан");
    setDriveType(j.defaults?.drive_type || "Передний");
    setContactPhone(j.defaults?.contact_phone || "");
    setMake(j.mapped?.make || j.brand || "");
    setModel(j.mapped?.model || j.model || "");
    if (j.estimated_total_rub != null) {
      setPriceRub(String(Math.round(j.estimated_total_rub)));
    }
    const ids = (j.photos || []).map((p) => p.id);
    const first = ids.slice(0, Math.min(DEFAULT_SELECTION, ids.length, MAX_AVITO_PHOTOS));
    setSelected(new Set(first));
  }, []);

  const loadCompose = useCallback(async () => {
    if (!token || !carId) return;
    setLoadError("");
    const res = await fetch(`${API_URL}/admin/cars/${encodeURIComponent(carId)}/avito-compose`, {
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
    applyCompose(j);
  }, [token, carId, applyCompose]);

  useEffect(() => {
    if (!router.isReady) return;
    const t = getStoredToken();
    if (!t) {
      router.push(`/auth?next=${encodeURIComponent(`/staff/publish-avito/${carId}`)}`);
      return;
    }
    setToken(t);
    (async () => {
      const res = await fetch(`${API_URL}/auth/me`, { headers: { Authorization: `Bearer ${t}` } });
      if (!res.ok) {
        clearToken();
        router.push(`/auth?next=${encodeURIComponent(`/staff/publish-avito/${carId}`)}`);
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

  function togglePhoto(id) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else if (next.size < MAX_AVITO_PHOTOS) next.add(id);
      else setMessage(`Не более ${MAX_AVITO_PHOTOS} фото для Avito`);
      return next;
    });
  }

  async function refreshStatus() {
    setError("");
    setMessage("");
    if (!token || !carId) return;
    setStatusBusy(true);
    try {
      const res = await fetch(`${API_URL}/admin/cars/${encodeURIComponent(carId)}/avito/status`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok || !body.ok) {
        setError(body.detail || "Не удалось обновить статус");
        return;
      }
      setMessage(
        body.avito_url
          ? `Статус: ${body.publication_status}. Объявление на Avito: ${body.avito_url}`
          : `Статус: ${body.publication_status || "неизвестен"}`
      );
      await loadCompose();
    } catch {
      setError("Сбой сети при обновлении статуса");
    } finally {
      setStatusBusy(false);
    }
  }

  async function publish() {
    setError("");
    setMessage("");
    if (!description.trim()) {
      setError("Введите описание");
      return;
    }
    if (!selected.size) {
      setError("Выберите хотя бы одно фото");
      return;
    }
    if (!token || !carId) return;
    setPublishBusy(true);
    try {
      const photo_ids = photosSorted.filter((p) => selected.has(p.id)).map((p) => p.id);
      const res = await fetch(`${API_URL}/admin/cars/${encodeURIComponent(carId)}/avito/publish`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          description: description.trim(),
          region: region.trim(),
          car_type: carType.trim(),
          body_type: bodyType.trim(),
          drive_type: driveType.trim(),
          contact_phone: contactPhone.trim(),
          make: make.trim(),
          model: model.trim(),
          photo_ids,
          price_rub: priceRub.trim() ? Number(priceRub) : null,
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok || !body.ok) {
        setError(body.detail || "Публикация на Avito не выполнена");
        return;
      }
      setMessage(body.detail || "Загрузка на Avito запущена. Через 1–2 минуты нажмите «Обновить статус».");
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
          <h1 className="section-title">Публикация на Avito</h1>
          <p className="muted" style={{ marginTop: "-0.5rem", marginBottom: "1.25rem" }}>
            Подготовьте XML-фид и запустите автозагрузку Avito. Ссылка на сайт добавится в описание автоматически.
          </p>

          {!me ? (
            <p className="muted">Проверка доступа…</p>
          ) : loadError ? (
            <div className="alert alert--danger">{loadError}</div>
          ) : !data ? (
            <p className="muted">Загрузка объявления…</p>
          ) : (
            <>
              {!data.avito_configured ? (
                <div className="alert alert--danger" style={{ marginBottom: "1rem" }}>
                  Avito API не настроен: задайте AVITO_CLIENT_ID и AVITO_CLIENT_SECRET на сервере.
                </div>
              ) : null}

              {data.publication ? (
                <div className="panel" style={{ marginBottom: "1rem" }}>
                  <h2 className="panel-heading-sm">Статус на Avito</h2>
                  <p style={{ margin: "0.25rem 0" }}>
                    <strong>{data.publication.status}</strong>
                    {data.publication.avito_url ? (
                      <>
                        {" "}
                        ·{" "}
                        <a href={data.publication.avito_url} target="_blank" rel="noopener noreferrer">
                          Открыть на Avito
                        </a>
                      </>
                    ) : null}
                  </p>
                  {data.publication.last_error ? (
                    <p className="muted" style={{ color: "var(--color-danger, #c62828)" }}>
                      {data.publication.last_error}
                    </p>
                  ) : null}
                  <button type="button" className="btn btn-secondary btn-sm" disabled={statusBusy} onClick={refreshStatus}>
                    {statusBusy ? "Обновление…" : "Обновить статус"}
                  </button>
                </div>
              ) : null}

              {data.warnings?.length ? (
                <div className="alert" style={{ marginBottom: "1rem", background: "#fff8e1" }}>
                  <strong>Проверьте перед публикацией:</strong>
                  <ul style={{ margin: "0.5rem 0 0", paddingLeft: "1.2rem" }}>
                    {data.warnings.map((w) => (
                      <li key={w}>{w}</li>
                    ))}
                  </ul>
                </div>
              ) : null}

              <div className="panel" style={{ marginBottom: "1rem" }}>
                <h2 className="panel-heading-sm">Объявление</h2>
                <p style={{ margin: "0.25rem 0", fontWeight: 600 }}>{data.title}</p>
                <p className="muted" style={{ margin: "0 0 0.5rem", fontSize: "0.9rem" }}>
                  {data.brand} {data.model}
                  {data.generation ? ` · ${data.generation}` : ""} · {data.year}
                  {data.mileage_km != null ? ` · ${Number(data.mileage_km).toLocaleString("ru-RU")} км` : ""}
                </p>
                {data.estimated_total_rub != null ? (
                  <p style={{ margin: "0.25rem 0" }}>
                    Оценка «под ключ»: <strong>{Math.round(data.estimated_total_rub).toLocaleString("ru-RU")} ₽</strong>
                  </p>
                ) : null}
                <p style={{ margin: "0.5rem 0 0" }}>
                  <a href={data.canonical_web_url} target="_blank" rel="noopener noreferrer">
                    Карточка на сайте
                  </a>
                </p>
              </div>

              <div className="panel" style={{ marginBottom: "1rem" }}>
                <h2 className="panel-heading-sm">Параметры Avito</h2>
                <div style={{ display: "grid", gap: 10 }}>
                  <label>
                    <span className="muted" style={{ display: "block", fontSize: "0.85rem" }}>
                      Марка (Make)
                    </span>
                    <input className="input" value={make} onChange={(e) => setMake(e.target.value)} />
                  </label>
                  <label>
                    <span className="muted" style={{ display: "block", fontSize: "0.85rem" }}>
                      Модель (Model)
                    </span>
                    <input className="input" value={model} onChange={(e) => setModel(e.target.value)} />
                  </label>
                  <label>
                    <span className="muted" style={{ display: "block", fontSize: "0.85rem" }}>
                      Цена в ₽ (Price)
                    </span>
                    <input className="input" type="number" min="0" value={priceRub} onChange={(e) => setPriceRub(e.target.value)} />
                  </label>
                  <label>
                    <span className="muted" style={{ display: "block", fontSize: "0.85rem" }}>
                      Регион
                    </span>
                    <select className="input" value={region} onChange={(e) => setRegion(e.target.value)}>
                      {(data.options?.regions || [region]).map((r) => (
                        <option key={r} value={r}>
                          {r}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    <span className="muted" style={{ display: "block", fontSize: "0.85rem" }}>
                      Тип авто (CarType)
                    </span>
                    <select className="input" value={carType} onChange={(e) => setCarType(e.target.value)}>
                      {(data.options?.car_types || [carType]).map((r) => (
                        <option key={r} value={r}>
                          {r}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    <span className="muted" style={{ display: "block", fontSize: "0.85rem" }}>
                      Кузов (BodyType)
                    </span>
                    <select className="input" value={bodyType} onChange={(e) => setBodyType(e.target.value)}>
                      {(data.options?.body_types || [bodyType]).map((r) => (
                        <option key={r} value={r}>
                          {r}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    <span className="muted" style={{ display: "block", fontSize: "0.85rem" }}>
                      Привод (DriveType)
                    </span>
                    <select className="input" value={driveType} onChange={(e) => setDriveType(e.target.value)}>
                      {(data.options?.drive_types || [driveType]).map((r) => (
                        <option key={r} value={r}>
                          {r}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    <span className="muted" style={{ display: "block", fontSize: "0.85rem" }}>
                      Телефон (ContactPhone)
                    </span>
                    <input className="input" value={contactPhone} onChange={(e) => setContactPhone(e.target.value)} />
                  </label>
                </div>
              </div>

              <div className="panel" style={{ marginBottom: "1rem" }}>
                <h2 className="panel-heading-sm">Фото (до {MAX_AVITO_PHOTOS})</h2>
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
                <h2 className="panel-heading-sm">Описание</h2>
                <textarea
                  className="input"
                  rows={12}
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Описание для Avito…"
                />
                <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 10 }}>
                  <button type="button" className="btn btn-primary" disabled={publishBusy} onClick={publish}>
                    {publishBusy ? "Публикация…" : "Опубликовать на Avito"}
                  </button>
                </div>
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
