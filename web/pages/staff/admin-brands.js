import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/router";

import HeaderProfileLink from "../../components/HeaderProfileLink";
import { clearToken, getStoredToken } from "../../lib/auth";
import { mediaSrc } from "../../lib/media";
import { isAdminRole } from "../../lib/roles";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

export default function AdminBrandsPage() {
  const router = useRouter();
  const [token, setToken] = useState("");
  const [me, setMe] = useState(null);
  const [brands, setBrands] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [newName, setNewName] = useState("");
  const [drafts, setDrafts] = useState({});

  const loadBrands = useCallback(async (t) => {
    const res = await fetch(`${API_URL}/admin/car-brands`, {
      headers: { Authorization: `Bearer ${t}` },
    });
    if (!res.ok) {
      setError("Не удалось загрузить марки");
      return;
    }
    const data = await res.json();
    setBrands(data);
    const d = {};
    for (const b of data) {
      d[b.id] = {
        name: b.name,
        quick_filter_rank: b.quick_filter_rank == null ? "" : String(b.quick_filter_rank),
      };
    }
    setDrafts(d);
  }, []);

  useEffect(() => {
    const t = getStoredToken();
    if (!t) {
      router.push("/auth?next=/staff/admin-brands");
      return;
    }
    setToken(t);
    (async () => {
      const res = await fetch(`${API_URL}/auth/me`, { headers: { Authorization: `Bearer ${t}` } });
      if (!res.ok) {
        clearToken();
        router.push("/auth?next=/staff/admin-brands");
        return;
      }
      const data = await res.json();
      setMe(data);
      if (!isAdminRole(data.role)) {
        router.replace("/profile");
        return;
      }
      await loadBrands(t);
      setLoading(false);
    })();
  }, [router, loadBrands]);

  function logout() {
    clearToken();
    router.push("/");
  }

  async function saveBrand(brandId) {
    setError("");
    setMessage("");
    const d = drafts[brandId];
    if (!d) return;
    const name = (d.name || "").trim();
    if (!name) {
      setError("Название марки не может быть пустым");
      return;
    }
    let rankPayload;
    const raw = (d.quick_filter_rank || "").trim();
    if (raw === "") {
      rankPayload = null;
    } else {
      const n = parseInt(raw, 10);
      if (Number.isNaN(n) || n < 0) {
        setError("Порядок в ряду — целое число ≥ 0 или пусто");
        return;
      }
      rankPayload = n;
    }
    const res = await fetch(`${API_URL}/admin/car-brands/${brandId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ name, quick_filter_rank: rankPayload }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      setError(typeof body.detail === "string" ? body.detail : "Ошибка сохранения");
      return;
    }
    setMessage("Сохранено");
    await loadBrands(token);
  }

  async function uploadLogo(brandId, fileList) {
    const f = fileList?.[0];
    if (!f) return;
    setError("");
    setMessage("");
    const fd = new FormData();
    fd.append("file", f);
    const res = await fetch(`${API_URL}/admin/car-brands/${brandId}/logo`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
      body: fd,
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      setError(typeof body.detail === "string" ? body.detail : "Ошибка загрузки");
      return;
    }
    setMessage("Логотип обновлён");
    await loadBrands(token);
  }

  async function removeLogo(brandId) {
    if (!window.confirm("Удалить логотип этой марки?")) return;
    setError("");
    setMessage("");
    const res = await fetch(`${API_URL}/admin/car-brands/${brandId}/logo`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}` },
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      setError(typeof body.detail === "string" ? body.detail : "Ошибка");
      return;
    }
    setMessage("Логотип удалён");
    await loadBrands(token);
  }

  async function createBrand(e) {
    e.preventDefault();
    setError("");
    setMessage("");
    const name = newName.trim();
    if (!name) {
      setError("Введите название марки");
      return;
    }
    const res = await fetch(`${API_URL}/admin/car-brands`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ name }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      setError(typeof body.detail === "string" ? body.detail : "Ошибка создания");
      return;
    }
    setMessage(`Марка «${body.name}» создана`);
    setNewName("");
    setCreateOpen(false);
    await loadBrands(token);
  }

  if (!me || loading) {
    return (
      <div className="layout">
        <main className="site-main">
          <div className="container">
            <p className="muted">Загрузка...</p>
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
        <div className="container" style={{ maxWidth: 960 }}>
          <p className="muted" style={{ marginBottom: "0.5rem" }}>
            <Link href="/profile">← Профиль</Link>
          </p>
          <h1 className="section-title">Справочник марок</h1>
          <p className="muted section-title--flush-top" style={{ marginBottom: "1rem", maxWidth: "52rem" }}>
            Названия, логотипы и порядок в будущем ряду быстрых фильтров (меньшее число — левее). Пустой «Порядок» —
            марка не в ряду логотипов. На существующей БД один раз выполните SQL из{" "}
            <code className="text-muted">backend/migrations/002_car_brand_logo_quick_filter.sql</code>.
          </p>
          {message ? <div className="alert alert--success">{message}</div> : null}
          {error ? <div className="alert alert--danger">{error}</div> : null}

          <div style={{ marginBottom: "1rem" }}>
            <button type="button" className="btn btn-secondary" onClick={() => setCreateOpen((v) => !v)}>
              {createOpen ? "Отменить" : "Добавить марку"}
            </button>
          </div>

          {createOpen ? (
            <form className="panel" onSubmit={createBrand} style={{ display: "grid", gap: 12, marginBottom: "1.5rem" }}>
              <h2 className="section-title panel-heading-sm">Новая марка</h2>
              <label className="muted" style={{ display: "grid", gap: 4 }}>
                Название
                <input
                  className="input"
                  required
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  placeholder="Например, Changan"
                />
              </label>
              <button type="submit" className="btn btn-primary">
                Создать
              </button>
            </form>
          ) : null}

          <div className="panel" style={{ overflowX: "auto" }}>
            <table
              className="admin-brands-table"
              style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.875rem" }}
            >
              <thead>
                <tr style={{ textAlign: "left", borderBottom: "1px solid var(--color-border)" }}>
                  <th style={{ padding: "0.5rem" }}>ID</th>
                  <th style={{ padding: "0.5rem" }}>Лого</th>
                  <th style={{ padding: "0.5rem" }}>Название</th>
                  <th style={{ padding: "0.5rem" }}>Порядок</th>
                  <th style={{ padding: "0.5rem" }}>Действия</th>
                </tr>
              </thead>
              <tbody>
                {brands.map((b) => (
                  <tr key={b.id} style={{ borderBottom: "1px solid var(--color-border)" }}>
                    <td style={{ padding: "0.5rem", verticalAlign: "top" }}>{b.id}</td>
                    <td style={{ padding: "0.5rem", verticalAlign: "top" }}>
                      {b.logo_storage_url ? (
                        <img
                          src={mediaSrc(b.logo_storage_url)}
                          alt=""
                          style={{
                            width: 48,
                            height: 48,
                            objectFit: "contain",
                            background: "#f1f5f9",
                            borderRadius: 8,
                          }}
                        />
                      ) : (
                        <span className="muted">—</span>
                      )}
                    </td>
                    <td style={{ padding: "0.5rem", verticalAlign: "top" }}>
                      <input
                        className="input"
                        style={{ minWidth: 140 }}
                        value={drafts[b.id]?.name ?? b.name}
                        onChange={(e) =>
                          setDrafts((prev) => ({
                            ...prev,
                            [b.id]: { ...prev[b.id], name: e.target.value },
                          }))
                        }
                      />
                    </td>
                    <td style={{ padding: "0.5rem", verticalAlign: "top" }}>
                      <input
                        className="input"
                        style={{ width: 72 }}
                        inputMode="numeric"
                        placeholder="—"
                        value={drafts[b.id]?.quick_filter_rank ?? ""}
                        onChange={(e) =>
                          setDrafts((prev) => ({
                            ...prev,
                            [b.id]: { ...prev[b.id], quick_filter_rank: e.target.value },
                          }))
                        }
                      />
                    </td>
                    <td style={{ padding: "0.5rem", verticalAlign: "top" }}>
                      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
                        <button type="button" className="btn btn-primary btn-sm" onClick={() => saveBrand(b.id)}>
                          Сохранить
                        </button>
                        <label className="btn btn-secondary btn-sm" style={{ cursor: "pointer", margin: 0 }}>
                          Загрузить лого
                          <input
                            type="file"
                            accept="image/jpeg,image/png,image/webp,image/gif"
                            style={{ display: "none" }}
                            onChange={(e) => {
                              uploadLogo(b.id, e.target.files);
                              e.target.value = "";
                            }}
                          />
                        </label>
                        {b.logo_storage_url ? (
                          <button type="button" className="btn btn-ghost btn-sm" onClick={() => removeLogo(b.id)}>
                            Убрать лого
                          </button>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </main>
    </div>
  );
}
