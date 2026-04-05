import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter } from "next/router";

import HeaderProfileLink from "../../components/HeaderProfileLink";
import { clearToken, getStoredToken } from "../../lib/auth";
import { canCreateListings } from "../../lib/roles";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

export default function StaffNewListingPage() {
  const router = useRouter();
  const [token, setToken] = useState("");
  const [me, setMe] = useState(null);
  const [brands, setBrands] = useState([]);
  const [models, setModels] = useState([]);
  const [brandId, setBrandId] = useState("");
  const [modelId, setModelId] = useState("");
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
  const [files, setFiles] = useState([]);
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    const t = getStoredToken();
    if (!t) {
      router.push("/auth?next=/staff/new-listing");
      return;
    }
    setToken(t);
    (async () => {
      const res = await fetch(`${API_URL}/auth/me`, { headers: { Authorization: `Bearer ${t}` } });
      if (!res.ok) {
        clearToken();
        router.push("/auth?next=/staff/new-listing");
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
  }, []);

  useEffect(() => {
    if (!token || !brandId) {
      setModels([]);
      setModelId("");
      return;
    }
    (async () => {
      const r = await fetch(`${API_URL}/staff/catalog/models?brand_id=${brandId}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (r.ok) {
        const list = await r.json();
        setModels(list);
        setModelId(list[0]?.id ? String(list[0].id) : "");
      }
    })();
  }, [token, brandId]);

  async function submit(e) {
    e.preventDefault();
    setError("");
    setMessage("");
    if (!brandId || !modelId) {
      setError("Выберите марку и модель");
      return;
    }
    if (!files.length) {
      setError("Добавьте хотя бы одно фото");
      return;
    }
    const fd = new FormData();
    fd.append("brand_id", brandId);
    fd.append("model_id", modelId);
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

    setSubmitting(true);
    try {
      const res = await fetch(`${API_URL}/staff/cars`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        body: fd,
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        const d = body.detail;
        let msg = "Не удалось создать объявление";
        if (typeof d === "string") msg = d;
        else if (Array.isArray(d)) msg = d.map((x) => x.msg || JSON.stringify(x)).join("; ");
        setError(msg);
        return;
      }
      setMessage("Объявление опубликовано");
      router.push(`/cars/${body.id}`);
    } finally {
      setSubmitting(false);
    }
  }

  function logout() {
    clearToken();
    router.push("/");
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
        <div className="container" style={{ maxWidth: 640 }}>
          <h1 className="section-title">Новое объявление</h1>
          <p className="muted" style={{ marginTop: -8 }}>
            Доступно для администраторов, модераторов и дилеров. Фото сохраняются на сервере.
          </p>
          {message && <div className="alert alert--success">{message}</div>}
          {error && <div className="alert alert--danger">{error}</div>}
          {!me ? (
            <p className="muted">Загрузка...</p>
          ) : (
            <form className="panel" onSubmit={submit} style={{ display: "grid", gap: 12 }}>
              <label className="muted" style={{ display: "grid", gap: 4 }}>
                Марка
                <select
                  className="input"
                  value={brandId}
                  required
                  onChange={(e) => setBrandId(e.target.value)}
                >
                  <option value="">—</option>
                  {brands.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="muted" style={{ display: "grid", gap: 4 }}>
                Модель
                <select
                  className="input"
                  value={modelId}
                  required
                  disabled={!brandId}
                  onChange={(e) => setModelId(e.target.value)}
                >
                  <option value="">—</option>
                  {models.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name}
                    </option>
                  ))}
                </select>
              </label>
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
              <label className="muted" style={{ display: "grid", gap: 4 }}>
                Фотографии (до 15, до 10 МБ каждая)
                <input
                  className="input"
                  type="file"
                  accept="image/jpeg,image/png,image/webp,image/gif"
                  multiple
                  required
                  onChange={(e) => setFiles(Array.from(e.target.files || []))}
                />
              </label>
              <button type="submit" className="btn btn-primary" disabled={submitting}>
                {submitting ? "Публикация…" : "Опубликовать"}
              </button>
            </form>
          )}
        </div>
      </main>
    </div>
  );
}
