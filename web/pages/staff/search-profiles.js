import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/router";

import HeaderProfileLink from "../../components/HeaderProfileLink";
import SiteSelectDropdown from "../../components/SiteSelectDropdown";
import { clearToken, getStoredToken } from "../../lib/auth";
import { isStaffRole } from "../../lib/roles";
import SiteHeader from "../../components/SiteHeader";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

function authHeaders(token) {
  return {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
  };
}

function formatApiErrorDetail(body) {
  if (!body || body.detail == null) return null;
  const d = body.detail;
  if (typeof d === "string") return d;
  if (Array.isArray(d)) {
    return d
      .map((x) =>
        x && typeof x === "object" && "msg" in x ? String(x.msg) : JSON.stringify(x)
      )
      .join(" ");
  }
  if (typeof d === "object") return JSON.stringify(d);
  return String(d);
}

function parseSeriesRow(item) {
  if (item && typeof item === "object" && !Array.isArray(item)) {
    return {
      url: String(item.url || item.series_url || "").trim(),
      brandId: item.brand_id != null && item.brand_id !== "" ? String(item.brand_id) : "",
      modelId: item.model_id != null && item.model_id !== "" ? String(item.model_id) : "",
    };
  }
  return { url: String(item || "").trim(), brandId: "", modelId: "" };
}

export default function StaffSearchProfilesPage() {
  const router = useRouter();
  const [token, setToken] = useState("");
  const [me, setMe] = useState(null);
  const [profiles, setProfiles] = useState([]);
  const [profileId, setProfileId] = useState("");
  const [name, setName] = useState("");
  const [enabled, setEnabled] = useState(true);
  const [brief, setBrief] = useState("");
  const [maxSelect, setMaxSelect] = useState(20);
  const [seriesRows, setSeriesRows] = useState([]);
  const [brands, setBrands] = useState([]);
  const [modelsByBrand, setModelsByBrand] = useState({});
  const [mileageMax, setMileageMax] = useState(50000);
  const [regAgeMin, setRegAgeMin] = useState(3);
  const [regAgeMax, setRegAgeMax] = useState(5);
  const [priceBand, setPriceBand] = useState("mid_upper");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [ok, setOk] = useState("");

  const applyProfile = useCallback((p) => {
    if (!p) return;
    setProfileId(String(p.id));
    setName(p.name || "");
    setEnabled(Boolean(p.enabled));
    setBrief(p.brief || "");
    setMaxSelect(Number(p.max_select) || 20);
    const c = p.criteria || {};
    const urls = Array.isArray(c.series_urls) ? c.series_urls : [];
    setSeriesRows(urls.map(parseSeriesRow).filter((row) => row.url));
    setMileageMax(c.mileage_max != null ? Number(c.mileage_max) : 50000);
    setRegAgeMin(c.reg_age_years_min != null ? Number(c.reg_age_years_min) : 3);
    setRegAgeMax(c.reg_age_years_max != null ? Number(c.reg_age_years_max) : 5);
    setPriceBand(c.price_band || "mid_upper");
  }, []);

  const load = useCallback(
    async (t) => {
      setBusy(true);
      setError("");
      try {
        const res = await fetch(`${API_URL}/admin/search-profiles`, {
          headers: authHeaders(t),
        });
        if (res.status === 401) {
          clearToken();
          router.push("/auth?next=/staff/search-profiles");
          return;
        }
        if (!res.ok) {
          setError("Не удалось загрузить профили");
          return;
        }
        const list = await res.json();
        setProfiles(list);
        const current =
          list.find((p) => String(p.id) === String(profileId)) || list[0] || null;
        applyProfile(current);
      } finally {
        setBusy(false);
      }
    },
    [router, applyProfile, profileId]
  );

  useEffect(() => {
    const t = getStoredToken();
    if (!t) {
      router.push("/auth?next=/staff/search-profiles");
      return;
    }
    setToken(t);
    (async () => {
      const meRes = await fetch(`${API_URL}/auth/me`, { headers: authHeaders(t) });
      if (!meRes.ok) {
        clearToken();
        router.push("/auth?next=/staff/search-profiles");
        return;
      }
      const meJson = await meRes.json();
      if (!isStaffRole(meJson.role)) {
        router.push("/profile");
        return;
      }
      setMe(meJson);
      const brandsRes = await fetch(`${API_URL}/staff/catalog/brands`, {
        headers: authHeaders(t),
      });
      if (brandsRes.ok) setBrands(await brandsRes.json());
      await load(t);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router]);

  function logout() {
    clearToken({ logout: true });
    router.push("/");
  }

  const brandOptions = useMemo(
    () => [
      { value: "", label: "— марка —" },
      ...brands.map((b) => ({ value: String(b.id), label: b.name })),
    ],
    [brands]
  );

  const profileOptions = useMemo(
    () =>
      profiles.map((p) => ({
        value: String(p.id),
        label: `${p.name} (#${p.id})`,
      })),
    [profiles]
  );

  const ensureModels = useCallback(
    async (brandId) => {
      if (!token || !brandId || modelsByBrand[brandId]) return;
      const r = await fetch(`${API_URL}/staff/catalog/models?brand_id=${brandId}`, {
        headers: authHeaders(token),
      });
      if (r.ok) {
        const list = await r.json();
        setModelsByBrand((prev) => ({ ...prev, [brandId]: list }));
      }
    },
    [token, modelsByBrand]
  );

  useEffect(() => {
    const ids = new Set(seriesRows.map((row) => row.brandId).filter(Boolean));
    ids.forEach((id) => {
      ensureModels(id);
    });
  }, [seriesRows, ensureModels]);

  function patchRow(index, patch) {
    setSeriesRows((prev) => prev.map((row, i) => (i === index ? { ...row, ...patch } : row)));
  }

  function removeUrlAt(index) {
    setSeriesRows((prev) => prev.filter((_, i) => i !== index));
  }

  function addRow() {
    setError("");
    setOk("");
    setSeriesRows((prev) => [...prev, { url: "", brandId: "", modelId: "" }]);
  }

  async function save() {
    if (!profileId) return;
    setBusy(true);
    setError("");
    setOk("");
    try {
      const cleaned = seriesRows
        .map((row) => ({
          url: row.url.trim(),
          brand_id: row.brandId ? Number(row.brandId) : null,
          model_id: row.modelId ? Number(row.modelId) : null,
        }))
        .filter((row) => row.url);
      const res = await fetch(`${API_URL}/admin/search-profiles/${profileId}`, {
        method: "PATCH",
        headers: authHeaders(token),
        body: JSON.stringify({
          name,
          enabled,
          brief,
          max_select: Number(maxSelect),
          series_urls: cleaned,
          mileage_max: Number(mileageMax),
          reg_age_years_min: Number(regAgeMin),
          reg_age_years_max: Number(regAgeMax),
          price_band: priceBand,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(formatApiErrorDetail(body) || "Не удалось сохранить");
        return;
      }
      const updated = await res.json();
      setOk("Сохранено");
      setProfiles((prev) => prev.map((p) => (p.id === updated.id ? updated : p)));
      applyProfile(updated);
    } finally {
      setBusy(false);
    }
  }

  if (!me) {
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
      <SiteHeader authBarStyle={{ display: "flex", gap: 12, alignItems: "center" }}>
          <HeaderProfileLink token={token} userRole={me?.role} variant="ghost" />
          <button type="button" className="btn btn-ghost btn-sm" onClick={logout}>
            Выйти
          </button>
        </SiteHeader>

      <main className="site-main">
        <div className="container import-plan-page">
          <p className="muted" style={{ marginBottom: "0.5rem" }}>
            <Link href="/">← Главная</Link>
            {" · "}
            <Link href="/profile">Профиль</Link>
          </p>
          <h1 className="section-title">Профили отбора</h1>
          <p className="muted" style={{ marginTop: "-0.35rem", marginBottom: "1rem" }}>
            Страницы серий che168 с маркой и моделью. Отдельные объявления — в{" "}
            <Link href="/staff/import-plan">плане импорта</Link>
            {" · "}
            <Link href="/staff/import-candidates">кандидаты</Link>.
          </p>

          {error ? <div className="alert alert--danger">{error}</div> : null}
          {ok ? <div className="alert alert--success">{ok}</div> : null}

          <div className="import-plan-toolbar search-profiles-toolbar">
            <label className="search-profiles-field search-profiles-toolbar-profile">
              <span className="search-profiles-field__label">Профиль</span>
              <SiteSelectDropdown
                className="site-dropdown--block"
                portal
                searchable
                value={profileId}
                placeholder="Выберите профиль"
                onChange={(v) => {
                  const p = profiles.find((x) => String(x.id) === String(v));
                  applyProfile(p);
                }}
                options={profileOptions}
              />
            </label>
            <div className="search-profiles-toolbar-actions">
              <button
                type="button"
                className="btn btn-primary"
                disabled={busy || !profileId}
                onClick={save}
              >
                {busy ? "Сохранение…" : "Сохранить"}
              </button>
              <button
                type="button"
                className="btn btn-secondary"
                disabled={busy}
                onClick={() => load(token)}
              >
                Обновить
              </button>
              <button type="button" className="btn btn-ghost" disabled={busy} onClick={addRow}>
                + Строка
              </button>
              <label className="search-profiles-check">
                <input
                  type="checkbox"
                  checked={enabled}
                  onChange={(e) => setEnabled(e.target.checked)}
                />
                Профиль включён
              </label>
            </div>
          </div>

          <div className="search-profiles-meta">
            <label className="search-profiles-field">
              <span className="search-profiles-field__label">Название</span>
              <input
                className="input"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Ежедневный отбор"
              />
            </label>
            <label className="search-profiles-field">
              <span className="search-profiles-field__label">Квота в день</span>
              <input
                className="input"
                type="number"
                min={1}
                max={100}
                value={maxSelect}
                onChange={(e) => setMaxSelect(e.target.value)}
              />
            </label>
            <label className="search-profiles-field">
              <span className="search-profiles-field__label">Пробег max, км</span>
              <input
                className="input"
                type="number"
                value={mileageMax}
                onChange={(e) => setMileageMax(e.target.value)}
              />
            </label>
            <label className="search-profiles-field">
              <span className="search-profiles-field__label">Возраст рег. min</span>
              <input
                className="input"
                type="number"
                step="0.5"
                value={regAgeMin}
                onChange={(e) => setRegAgeMin(e.target.value)}
              />
            </label>
            <label className="search-profiles-field">
              <span className="search-profiles-field__label">Возраст рег. max</span>
              <input
                className="input"
                type="number"
                step="0.5"
                value={regAgeMax}
                onChange={(e) => setRegAgeMax(e.target.value)}
              />
            </label>
            <label className="search-profiles-field">
              <span className="search-profiles-field__label">Ценовой сегмент</span>
              <SiteSelectDropdown
                className="site-dropdown--block"
                portal
                value={priceBand}
                placeholder="Выберите сегмент"
                onChange={(v) => setPriceBand(v || "")}
                options={[
                  { value: "mid_upper", label: "mid_upper (без дешёвого терциля)" },
                  { value: "", label: "без фильтра" },
                ]}
              />
            </label>
          </div>
          <label className="search-profiles-field search-profiles-brief-wrap">
            <span className="search-profiles-field__label">Brief для агента</span>
            <textarea
              className="input search-profiles-brief"
              rows={3}
              value={brief}
              onChange={(e) => setBrief(e.target.value)}
              placeholder="Коротко: что искать и какие приоритеты"
            />
          </label>

          <div className="import-plan-table-wrap">
            <table className="import-plan-table">
              <thead>
                <tr>
                  <th style={{ width: 36 }}> </th>
                  <th>Марка</th>
                  <th>Модель</th>
                  <th>Страница серии</th>
                  <th style={{ width: 56 }}> </th>
                </tr>
              </thead>
              <tbody>
                {seriesRows.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="muted">
                      Список пуст — нажмите «+ Строка».
                    </td>
                  </tr>
                ) : (
                  seriesRows.map((row, index) => {
                    const models = row.brandId ? modelsByBrand[row.brandId] || [] : [];
                    return (
                      <tr key={`url-${index}`}>
                        <td className="import-plan-table__mono">{index + 1}</td>
                        <td>
                          <SiteSelectDropdown
                            className="site-dropdown--block"
                            portal
                            searchable
                            value={row.brandId}
                            placeholder="— марка —"
                            onChange={(v) => {
                              patchRow(index, {
                                brandId: v || "",
                                modelId: "",
                              });
                              if (v) ensureModels(v);
                            }}
                            options={brandOptions}
                          />
                        </td>
                        <td>
                          <SiteSelectDropdown
                            className="site-dropdown--block"
                            portal
                            searchable
                            value={row.modelId}
                            disabled={!row.brandId}
                            placeholder={row.brandId ? "— модель —" : "Сначала марка"}
                            onChange={(v) => patchRow(index, { modelId: v || "" })}
                            options={[
                              {
                                value: "",
                                label: row.brandId ? "— модель —" : "Сначала марка",
                              },
                              ...models.map((m) => ({
                                value: String(m.id),
                                label: m.name,
                              })),
                            ]}
                          />
                        </td>
                        <td>
                          <input
                            className="input import-plan-url"
                            type="url"
                            value={row.url}
                            onChange={(e) => patchRow(index, { url: e.target.value })}
                            placeholder="https://www.che168.com/china/…"
                            spellCheck={false}
                          />
                        </td>
                        <td>
                          <button
                            type="button"
                            className="btn btn-ghost btn-sm"
                            title="Удалить строку"
                            onClick={() => removeUrlAt(index)}
                          >
                            ×
                          </button>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      </main>
    </div>
  );
}
