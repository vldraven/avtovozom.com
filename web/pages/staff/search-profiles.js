import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/router";

import HeaderProfileLink from "../../components/HeaderProfileLink";
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

/** Короткая подпись из path: /china/aodi/aodiq3/... → aodi / aodiq3 */
function seriesUrlLabel(url) {
  const raw = String(url || "").trim();
  if (!raw) return "";
  try {
    const path = new URL(raw).pathname;
    const parts = path.split("/").filter(Boolean);
    if (parts[0] === "china" && parts.length >= 2) {
      return parts.slice(1, 3).join(" / ");
    }
    return parts.slice(-2).join(" / ") || raw;
  } catch {
    return raw.length > 48 ? `${raw.slice(0, 48)}…` : raw;
  }
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
  const [seriesUrls, setSeriesUrls] = useState([]);
  const [newUrl, setNewUrl] = useState("");
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
    const urls = Array.isArray(c.series_urls)
      ? c.series_urls.map((u) => String(u).trim()).filter(Boolean)
      : [];
    setSeriesUrls(urls);
    setNewUrl("");
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
      await load(t);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router]);

  function logout() {
    clearToken({ logout: true });
    router.push("/");
  }

  function updateUrlAt(index, value) {
    setSeriesUrls((prev) => prev.map((u, i) => (i === index ? value : u)));
  }

  function removeUrlAt(index) {
    setSeriesUrls((prev) => prev.filter((_, i) => i !== index));
  }

  function addUrl() {
    const u = newUrl.trim();
    if (!u) return;
    if (seriesUrls.some((x) => x.trim() === u)) {
      setError("Такой URL уже есть в списке");
      setOk("");
      return;
    }
    setError("");
    setSeriesUrls((prev) => [...prev, u]);
    setNewUrl("");
  }

  async function save() {
    if (!profileId) return;
    setBusy(true);
    setError("");
    setOk("");
    try {
      const cleaned = seriesUrls.map((u) => u.trim()).filter(Boolean);
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
      <SiteHeader authBarStyle={{display: "flex", gap: 12, alignItems: "center"}}>
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
            {" · "}
            <Link href="/staff/import-plan">План импорта</Link>
            {" · "}
            <Link href="/staff/import-candidates">Кандидаты</Link>
          </p>

          <h1 className="section-title">Профили отбора (che168)</h1>
          <p className="muted" style={{ marginTop: "-0.35rem", marginBottom: "1rem" }}>
            Series URL для sourcing-агента: редактируйте список, квоту и фильтры. Объявления собираются только
            по этим ссылкам.
          </p>

          {error ? <div className="alert alert--danger">{error}</div> : null}
          {ok ? <div className="alert alert--success">{ok}</div> : null}

          <div className="import-plan-toolbar">
            <label className="muted" style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
              Профиль
              <select
                className="input"
                style={{ minWidth: 220 }}
                value={profileId}
                onChange={(e) => {
                  const p = profiles.find((x) => String(x.id) === e.target.value);
                  applyProfile(p);
                }}
              >
                {profiles.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} (#{p.id})
                  </option>
                ))}
              </select>
            </label>
            <button
              type="button"
              className="btn btn-secondary"
              disabled={busy}
              onClick={() => load(token)}
            >
              Обновить
            </button>
            <button
              type="button"
              className="btn btn-primary"
              disabled={busy || !profileId}
              onClick={save}
            >
              {busy ? "Сохранение…" : "Сохранить"}
            </button>
          </div>

          <div className="panel" style={{ marginBottom: "1rem" }}>
            <h2 className="panel-heading-sm">Параметры профиля</h2>
            <div className="search-profiles-grid">
              <label className="muted">
                Название
                <input className="input" value={name} onChange={(e) => setName(e.target.value)} />
              </label>
              <label className="muted">
                Квота в день
                <input
                  className="input"
                  type="number"
                  min={1}
                  max={100}
                  value={maxSelect}
                  onChange={(e) => setMaxSelect(e.target.value)}
                />
              </label>
              <label className="muted search-profiles-check">
                <input
                  type="checkbox"
                  checked={enabled}
                  onChange={(e) => setEnabled(e.target.checked)}
                />
                Профиль включён
              </label>
            </div>
            <label className="muted" style={{ display: "block", marginTop: "0.85rem" }}>
              Brief для агента
              <textarea
                className="input"
                rows={4}
                value={brief}
                onChange={(e) => setBrief(e.target.value)}
              />
            </label>
            <div className="search-profiles-filters">
              <label className="muted">
                Пробег max, км
                <input
                  className="input"
                  type="number"
                  value={mileageMax}
                  onChange={(e) => setMileageMax(e.target.value)}
                />
              </label>
              <label className="muted">
                Возраст рег. min
                <input
                  className="input"
                  type="number"
                  step="0.5"
                  value={regAgeMin}
                  onChange={(e) => setRegAgeMin(e.target.value)}
                />
              </label>
              <label className="muted">
                Возраст рег. max
                <input
                  className="input"
                  type="number"
                  step="0.5"
                  value={regAgeMax}
                  onChange={(e) => setRegAgeMax(e.target.value)}
                />
              </label>
              <label className="muted">
                Ценовой сегмент
                <select
                  className="input"
                  value={priceBand}
                  onChange={(e) => setPriceBand(e.target.value)}
                >
                  <option value="mid_upper">mid_upper (без дешёвого терциля)</option>
                  <option value="">без фильтра</option>
                </select>
              </label>
            </div>
          </div>

          <div className="panel" style={{ marginBottom: "2rem" }}>
            <h2 className="panel-heading-sm">
              Series URL che168{" "}
              <span className="muted" style={{ fontWeight: 500 }}>
                ({seriesUrls.length})
              </span>
            </h2>
            <p className="muted" style={{ marginTop: 0, marginBottom: "0.75rem", fontSize: "0.85rem" }}>
              Одна ссылка на серию/фильтр. Агент ходит только по этому списку.
            </p>

            <div className="import-plan-table-wrap">
              <table className="import-plan-table search-profiles-table">
                <thead>
                  <tr>
                    <th style={{ width: 44 }}>#</th>
                    <th style={{ width: 160 }}>Серия</th>
                    <th>Ссылка</th>
                    <th style={{ width: 150 }}> </th>
                  </tr>
                </thead>
                <tbody>
                  {seriesUrls.length === 0 ? (
                    <tr>
                      <td colSpan={4} className="muted">
                        Список пуст — добавьте URL ниже.
                      </td>
                    </tr>
                  ) : (
                    seriesUrls.map((url, index) => (
                      <tr key={`url-${index}`}>
                        <td className="import-plan-table__mono">{index + 1}</td>
                        <td>
                          <span className="search-profiles-series" title={url}>
                            {seriesUrlLabel(url) || "—"}
                          </span>
                        </td>
                        <td>
                          <input
                            className="input import-plan-url"
                            value={url}
                            onChange={(e) => updateUrlAt(index, e.target.value)}
                            spellCheck={false}
                          />
                        </td>
                        <td>
                          <div className="search-profiles-row-actions">
                            {url.trim() ? (
                              <a
                                className="btn btn-ghost btn-sm"
                                href={url.trim()}
                                target="_blank"
                                rel="noreferrer"
                              >
                                Открыть
                              </a>
                            ) : null}
                            <button
                              type="button"
                              className="btn btn-ghost btn-sm"
                              onClick={() => removeUrlAt(index)}
                            >
                              Удалить
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>

            <div className="import-plan-toolbar" style={{ marginTop: "0.85rem", marginBottom: 0 }}>
              <input
                className="input"
                style={{ flex: "1 1 280px", minWidth: 0 }}
                value={newUrl}
                onChange={(e) => setNewUrl(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    addUrl();
                  }
                }}
                placeholder="https://www.che168.com/china/…"
                spellCheck={false}
              />
              <button
                type="button"
                className="btn btn-secondary"
                disabled={!newUrl.trim()}
                onClick={addUrl}
              >
                + URL
              </button>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
