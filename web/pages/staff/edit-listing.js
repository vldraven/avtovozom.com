import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter } from "next/router";

import HeaderProfileLink from "../../components/HeaderProfileLink";
import SiteSelectDropdown from "../../components/SiteSelectDropdown";
import { clearToken, getStoredToken } from "../../lib/auth";
import { publicCarHref } from "../../lib/carRoutes";
import { mediaSrc } from "../../lib/media";
import { canCreateListings, isAdminRole } from "../../lib/roles";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

function IconTrash() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M9 3h6M4 7h16M6 7v12a2 2 0 002 2h8a2 2 0 002-2V7M10 11v6M14 11v6"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function IconUndo() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M9 14L4 9l5-5M4 9h10.5a4.5 4.5 0 010 9H11"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export default function StaffEditListingPage() {
  const router = useRouter();
  const rawId = router.query.id;
  const carId =
    rawId == null ? "" : String(Array.isArray(rawId) ? rawId[0] : rawId).trim();

  const [token, setToken] = useState("");
  const [me, setMe] = useState(null);
  const [loadError, setLoadError] = useState("");
  const [brands, setBrands] = useState([]);
  const [models, setModels] = useState([]);
  const [brandId, setBrandId] = useState("");
  const [modelId, setModelId] = useState("");
  const [generations, setGenerations] = useState([]);
  const [generationId, setGenerationId] = useState("");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [year, setYear] = useState("");
  const [mileageKm, setMileageKm] = useState("");
  const [engineCc, setEngineCc] = useState("");
  const [horsepower, setHorsepower] = useState("");
  const [fuelType, setFuelType] = useState("");
  const [transmission, setTransmission] = useState("");
  const [city, setCity] = useState("");
  const [priceCny, setPriceCny] = useState("");
  const [registrationDate, setRegistrationDate] = useState("");
  const [productionDate, setProductionDate] = useState("");
  const [existingPhotos, setExistingPhotos] = useState([]);
  const [photoIdsToRemove, setPhotoIdsToRemove] = useState(() => new Set());
  const [files, setFiles] = useState([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [cardPublicHref, setCardPublicHref] = useState("");

  useEffect(() => {
    if (!router.isReady) return;
    const t = getStoredToken();
    if (!t) {
      router.push(`/auth?next=${encodeURIComponent(`/staff/edit-listing?id=${carId}`)}`);
      return;
    }
    setToken(t);
    (async () => {
      const res = await fetch(`${API_URL}/auth/me`, { headers: { Authorization: `Bearer ${t}` } });
      if (!res.ok) {
        clearToken();
        router.push(`/auth?next=${encodeURIComponent(`/staff/edit-listing?id=${carId}`)}`);
        return;
      }
      const data = await res.json();
      setMe(data);
      if (!canCreateListings(data.role)) {
        router.replace("/profile");
        return;
      }
      const b = await fetch(`${API_URL}/staff/catalog/brands`, {
        headers: { Authorization: `Bearer ${t}` },
      });
      if (b.ok) setBrands(await b.json());
    })();
  }, [router.isReady, carId, router]);

  useEffect(() => {
    if (!router.isReady || !token || !carId || !me || !canCreateListings(me.role)) return;
    const url = isAdminRole(me.role)
      ? `${API_URL}/admin/cars/${carId}`
      : `${API_URL}/staff/cars/${carId}`;
    (async () => {
      setLoadError("");
      const res = await fetch(url, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        setLoadError(
          res.status === 404
            ? "Объявление не найдено или у вас нет прав на его редактирование."
            : "Не удалось загрузить объявление."
        );
        return;
      }
      const c = await res.json();
      setCardPublicHref(publicCarHref(c));
      setBrandId(String(c.brand_id));
      setModelId(String(c.model_id));
      setGenerationId(c.generation_id != null ? String(c.generation_id) : "");
      setTitle(c.title || "");
      setDescription(c.description || "");
      setYear(String(c.year ?? ""));
      setMileageKm(c.mileage_km != null ? String(c.mileage_km) : "");
      setEngineCc(String(c.engine_volume_cc ?? ""));
      setHorsepower(String(c.horsepower ?? ""));
      setFuelType(c.fuel_type || "");
      setTransmission(c.transmission || "");
      setCity(c.location_city || "");
      setPriceCny(String(c.price_cny ?? ""));
      setRegistrationDate(c.registration_date || "");
      setProductionDate(c.production_date || "");
      const ph = [...(c.photos || [])].sort((a, b) => a.sort_order - b.sort_order);
      setExistingPhotos(ph);
      setPhotoIdsToRemove(new Set());
    })();
  }, [router.isReady, token, carId, me?.role, me?.id]);

  useEffect(() => {
    if (!token || !brandId) {
      setModels([]);
      return;
    }
    (async () => {
      const r = await fetch(`${API_URL}/staff/catalog/models?brand_id=${brandId}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (r.ok) {
        const list = await r.json();
        setModels(list);
      }
    })();
  }, [token, brandId]);

  useEffect(() => {
    if (!token || !modelId) {
      setGenerations([]);
      return;
    }
    (async () => {
      const r = await fetch(`${API_URL}/staff/catalog/generations?model_id=${modelId}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (r.ok) setGenerations(await r.json());
    })();
  }, [token, modelId]);

  async function submit(e) {
    e.preventDefault();
    setError("");
    if (!brandId || !modelId) {
      setError("Выберите марку и модель");
      return;
    }
    if (files.length > 15) {
      setError("Не более 15 фотографий");
      return;
    }
    const fd = new FormData();
    fd.append("brand_id", brandId);
    fd.append("model_id", modelId);
    fd.append("generation_id", generationId || "");
    fd.append("title", title.trim() || "Автомобиль");
    fd.append("description", description);
    fd.append("year", year);
    fd.append("mileage_km", mileageKm);
    fd.append("engine_volume_cc", engineCc);
    fd.append("horsepower", horsepower);
    fd.append("fuel_type", fuelType);
    fd.append("transmission", transmission);
    fd.append("location_city", city);
    fd.append("price_cny", priceCny);
    fd.append("registration_date", registrationDate);
    fd.append("production_date", productionDate);
    for (const f of files) fd.append("photos", f);
    if (photoIdsToRemove.size > 0) {
      fd.append("remove_photo_ids", [...photoIdsToRemove].join(","));
    }

    setSubmitting(true);
    try {
      const saveUrl = isAdminRole(me.role)
        ? `${API_URL}/admin/cars/${carId}`
        : `${API_URL}/staff/cars/${carId}`;
      const res = await fetch(saveUrl, {
        method: "PUT",
        headers: { Authorization: `Bearer ${token}` },
        body: fd,
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        const d = body.detail;
        let msg = "Не удалось сохранить";
        if (typeof d === "string") msg = d;
        else if (Array.isArray(d)) msg = d.map((x) => x.msg || JSON.stringify(x)).join("; ");
        setError(msg);
        return;
      }
      router.push(publicCarHref(body));
    } finally {
      setSubmitting(false);
    }
  }

  function logout() {
    clearToken();
    router.push("/");
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
            <Link
              href={cardPublicHref || `/cars/${carId}`}
              className="btn btn-ghost btn-sm"
            >
              К карточке
            </Link>
            <HeaderProfileLink token={token} userRole={me?.role} variant="ghost" />
            <button type="button" className="btn btn-ghost btn-sm" onClick={logout}>
              Выйти
            </button>
          </div>
        </div>
      </header>
      <main className="site-main">
        <div className="container" style={{ maxWidth: 640 }}>
          <h1 className="section-title">Редактирование объявления</h1>
          {error && <div className="alert alert--danger">{error}</div>}
          {loadError && <div className="alert alert--danger">{loadError}</div>}
          {!me ? (
            <p className="muted">Загрузка...</p>
          ) : loadError ? null : (
            <form className="panel" onSubmit={submit} style={{ display: "grid", gap: 12 }}>
              <SiteSelectDropdown
                className="site-dropdown--block"
                label="Марка"
                placeholder="—"
                searchable
                value={brandId}
                onChange={(v) => {
                  setBrandId(v);
                  setGenerationId("");
                }}
                options={[
                  { value: "", label: "—" },
                  ...brands.map((b) => ({ value: String(b.id), label: b.name })),
                ]}
              />
              <SiteSelectDropdown
                className="site-dropdown--block"
                label="Модель"
                placeholder="—"
                searchable
                value={modelId}
                disabled={!brandId}
                onChange={(v) => {
                  setModelId(v);
                  setGenerationId("");
                }}
                options={[
                  { value: "", label: "—" },
                  ...models.map((m) => ({ value: String(m.id), label: m.name })),
                ]}
              />
              {generations.length > 0 ? (
                <SiteSelectDropdown
                  className="site-dropdown--block"
                  label="Поколение (необязательно)"
                  placeholder="— не выбрано —"
                  searchable
                  value={generationId}
                  onChange={setGenerationId}
                  options={[
                    { value: "", label: "— не выбрано —" },
                    ...generations.map((g) => ({ value: String(g.id), label: g.name })),
                  ]}
                />
              ) : modelId ? (
                <p className="muted" style={{ margin: 0 }}>
                  Поколение в справочнике для этой модели не задано — объявление будет без привязки к поколению.
                </p>
              ) : null}
              <label className="muted" style={{ display: "grid", gap: 4 }}>
                Заголовок
                <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} />
              </label>
              <label className="muted" style={{ display: "grid", gap: 4 }}>
                Описание
                <textarea
                  className="input"
                  rows={4}
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                />
              </label>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                <label className="muted" style={{ display: "grid", gap: 4 }}>
                  Год
                  <input
                    className="input"
                    type="number"
                    required
                    value={year}
                    onChange={(e) => setYear(e.target.value)}
                  />
                </label>
                <label className="muted" style={{ display: "grid", gap: 4 }}>
                  Пробег, км
                  <input
                    className="input"
                    type="number"
                    value={mileageKm}
                    onChange={(e) => setMileageKm(e.target.value)}
                  />
                </label>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                <label className="muted" style={{ display: "grid", gap: 4 }}>
                  Объём двигателя, см³
                  <input
                    className="input"
                    type="number"
                    required
                    value={engineCc}
                    onChange={(e) => setEngineCc(e.target.value)}
                  />
                </label>
                <label className="muted" style={{ display: "grid", gap: 4 }}>
                  Л.с.
                  <input
                    className="input"
                    type="number"
                    required
                    value={horsepower}
                    onChange={(e) => setHorsepower(e.target.value)}
                  />
                </label>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                <label className="muted" style={{ display: "grid", gap: 4 }}>
                  Топливо
                  <input
                    className="input"
                    placeholder="бензин / дизель / гибрид"
                    value={fuelType}
                    onChange={(e) => setFuelType(e.target.value)}
                  />
                </label>
                <label className="muted" style={{ display: "grid", gap: 4 }}>
                  КПП
                  <input
                    className="input"
                    placeholder="AT / MT"
                    value={transmission}
                    onChange={(e) => setTransmission(e.target.value)}
                  />
                </label>
              </div>
              <label className="muted" style={{ display: "grid", gap: 4 }}>
                Город
                <input className="input" value={city} onChange={(e) => setCity(e.target.value)} />
              </label>
              <label className="muted" style={{ display: "grid", gap: 4 }}>
                Цена, CNY
                <input
                  className="input"
                  type="number"
                  step="0.01"
                  required
                  value={priceCny}
                  onChange={(e) => setPriceCny(e.target.value)}
                />
              </label>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                <label className="muted" style={{ display: "grid", gap: 4 }}>
                  Дата регистрации (текст)
                  <input
                    className="input"
                    placeholder="например 2021-03"
                    value={registrationDate}
                    onChange={(e) => setRegistrationDate(e.target.value)}
                  />
                </label>
                <label className="muted" style={{ display: "grid", gap: 4 }}>
                  Дата производства (текст)
                  <input
                    className="input"
                    placeholder="например 2021-01"
                    value={productionDate}
                    onChange={(e) => setProductionDate(e.target.value)}
                  />
                </label>
              </div>
              {existingPhotos.length > 0 && (
                <div>
                  <span className="muted" style={{ fontWeight: 600, display: "block", marginBottom: 8 }}>
                    Текущие фото ({existingPhotos.length}
                    {photoIdsToRemove.size > 0 ? `, к удалению: ${photoIdsToRemove.size}` : ""})
                  </span>
                  <div className="staff-edit-photos">
                    {existingPhotos.map((p) => {
                      const mark = photoIdsToRemove.has(p.id);
                      return (
                        <div
                          key={p.id}
                          className={`staff-edit-photo-tile${mark ? " staff-edit-photo-tile--marked" : ""}`}
                        >
                          <div className="staff-edit-photo-wrap">
                            <img
                              src={mediaSrc(p.storage_url)}
                              alt=""
                              width={96}
                              height={72}
                              style={{ objectFit: "cover", borderRadius: 6 }}
                            />
                            <button
                              type="button"
                              className={`staff-edit-photo-icon-btn${mark ? " staff-edit-photo-icon-btn--undo" : ""}`}
                              title={mark ? "Вернуть фото" : "Удалить фото"}
                              aria-label={mark ? "Вернуть фото в объявление" : "Удалить фото из объявления"}
                              onClick={() =>
                                setPhotoIdsToRemove((prev) => {
                                  const next = new Set(prev);
                                  if (next.has(p.id)) next.delete(p.id);
                                  else next.add(p.id);
                                  return next;
                                })
                              }
                            >
                              {mark ? <IconUndo /> : <IconTrash />}
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
              <label className="muted" style={{ display: "grid", gap: 4 }}>
                Новые фотографии (необязательно; до 15, до 10 МБ каждая — заменят все текущие)
                <input
                  className="input"
                  type="file"
                  accept="image/jpeg,image/png,image/webp,image/gif"
                  multiple
                  onChange={(e) => setFiles(Array.from(e.target.files || []))}
                />
              </label>
              <button type="submit" className="btn btn-primary" disabled={submitting}>
                {submitting ? "Сохранение…" : "Сохранить"}
              </button>
            </form>
          )}
        </div>
      </main>
    </div>
  );
}
