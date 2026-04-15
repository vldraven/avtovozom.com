import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter } from "next/router";

import HeaderProfileLink from "../../components/HeaderProfileLink";
import { clearToken, getStoredToken } from "../../lib/auth";
import { isAdminRole } from "../../lib/roles";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

const ROLES = ["user", "dealer", "moderator", "admin"];

export default function AdminUsersPage() {
  const router = useRouter();
  const [token, setToken] = useState("");
  const [me, setMe] = useState(null);
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [editingId, setEditingId] = useState(null);
  const [draft, setDraft] = useState({});
  const [createOpen, setCreateOpen] = useState(false);
  const [createForm, setCreateForm] = useState({
    email: "",
    password: "",
    full_name: "",
    phone: "",
    role: "user",
  });

  useEffect(() => {
    const t = getStoredToken();
    if (!t) {
      router.push("/auth?next=/staff/admin-users");
      return;
    }
    setToken(t);
    (async () => {
      const res = await fetch(`${API_URL}/auth/me`, { headers: { Authorization: `Bearer ${t}` } });
      if (!res.ok) {
        clearToken();
        router.push("/auth?next=/staff/admin-users");
        return;
      }
      const data = await res.json();
      setMe(data);
      if (!isAdminRole(data.role)) {
        router.replace("/profile");
        return;
      }
      await loadUsers(t);
      setLoading(false);
    })();
  }, []);

  async function loadUsers(t) {
    const res = await fetch(`${API_URL}/admin/users`, { headers: { Authorization: `Bearer ${t}` } });
    if (!res.ok) {
      setError("Не удалось загрузить пользователей");
      return;
    }
    setUsers(await res.json());
  }

  function startEdit(u) {
    setEditingId(u.id);
    setDraft({
      email: u.email,
      phone: u.phone || "",
      full_name: u.full_name || "",
      display_name: u.display_name || "",
      company_name: u.company_name || "",
      role: u.role,
      is_active: u.is_active,
    });
    setError("");
    setMessage("");
  }

  async function saveEdit() {
    setError("");
    setMessage("");
    const res = await fetch(`${API_URL}/admin/users/${editingId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        email: draft.email,
        phone: draft.phone || null,
        full_name: draft.full_name,
        display_name: draft.display_name,
        company_name: draft.company_name || null,
        role: draft.role,
        is_active: draft.is_active,
      }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      setError(typeof body.detail === "string" ? body.detail : "Ошибка сохранения");
      return;
    }
    setMessage("Сохранено");
    setEditingId(null);
    await loadUsers(token);
  }

  async function resetPassword(userId) {
    if (!window.confirm("Сгенерировать новый пароль? Скопируйте его из сообщения — повторно не покажем.")) {
      return;
    }
    setError("");
    setMessage("");
    const res = await fetch(`${API_URL}/admin/users/${userId}/reset-password`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      setError(typeof body.detail === "string" ? body.detail : "Ошибка сброса");
      return;
    }
    setMessage(`Новый пароль для пользователя #${userId}: ${body.new_password}`);
  }

  async function createUser(e) {
    e.preventDefault();
    setError("");
    setMessage("");
    const res = await fetch(`${API_URL}/admin/users`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        email: createForm.email.trim(),
        password: createForm.password.trim() || null,
        full_name: createForm.full_name.trim(),
        phone: createForm.phone.trim() || null,
        role: createForm.role,
      }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      setError(typeof body.detail === "string" ? body.detail : "Ошибка создания");
      return;
    }
    if (body.generated_password) {
      setMessage(`Пользователь создан. Временный пароль: ${body.generated_password}`);
    } else {
      setMessage("Пользователь создан");
    }
    setCreateOpen(false);
    setCreateForm({ email: "", password: "", full_name: "", phone: "", role: "user" });
    await loadUsers(token);
  }

  function logout() {
    clearToken();
    router.push("/");
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
          <h1 className="section-title">Управление учётными записями</h1>
          {message && <div className="alert alert--success">{message}</div>}
          {error && <div className="alert alert--danger">{error}</div>}

          <div style={{ marginBottom: "1rem" }}>
            <button type="button" className="btn btn-secondary" onClick={() => setCreateOpen((v) => !v)}>
              {createOpen ? "Отменить" : "Создать пользователя"}
            </button>
          </div>

          {createOpen ? (
            <form className="panel" onSubmit={createUser} style={{ display: "grid", gap: 12, marginBottom: "1.5rem" }}>
              <h2 className="section-title panel-heading-sm">Новый пользователь</h2>
              <label className="muted" style={{ display: "grid", gap: 4 }}>
                Email
                <input
                  className="input"
                  type="email"
                  required
                  value={createForm.email}
                  onChange={(e) => setCreateForm((p) => ({ ...p, email: e.target.value }))}
                />
              </label>
              <label className="muted" style={{ display: "grid", gap: 4 }}>
                Пароль (необязательно — будет сгенерирован)
                <input
                  className="input"
                  type="text"
                  autoComplete="new-password"
                  value={createForm.password}
                  onChange={(e) => setCreateForm((p) => ({ ...p, password: e.target.value }))}
                />
              </label>
              <label className="muted" style={{ display: "grid", gap: 4 }}>
                Имя
                <input
                  className="input"
                  value={createForm.full_name}
                  onChange={(e) => setCreateForm((p) => ({ ...p, full_name: e.target.value }))}
                />
              </label>
              <label className="muted" style={{ display: "grid", gap: 4 }}>
                Телефон
                <input
                  className="input"
                  value={createForm.phone}
                  onChange={(e) => setCreateForm((p) => ({ ...p, phone: e.target.value }))}
                />
              </label>
              <label className="muted" style={{ display: "grid", gap: 4 }}>
                Роль
                <select
                  className="input"
                  value={createForm.role}
                  onChange={(e) => setCreateForm((p) => ({ ...p, role: e.target.value }))}
                >
                  {ROLES.map((r) => (
                    <option key={r} value={r}>
                      {r}
                    </option>
                  ))}
                </select>
              </label>
              <button type="submit" className="btn btn-primary">
                Создать
              </button>
            </form>
          ) : null}

          <div className="panel" style={{ overflowX: "auto" }}>
            <table className="admin-users-table" style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.875rem" }}>
              <thead>
                <tr style={{ textAlign: "left", borderBottom: "1px solid var(--color-border)" }}>
                  <th style={{ padding: "0.5rem" }}>ID</th>
                  <th style={{ padding: "0.5rem" }}>Email</th>
                  <th style={{ padding: "0.5rem" }}>Роль</th>
                  <th style={{ padding: "0.5rem" }}>Активен</th>
                  <th style={{ padding: "0.5rem" }} />
                </tr>
              </thead>
              <tbody>
                {users.map((u) => (
                  <tr key={u.id} style={{ borderBottom: "1px solid var(--color-border)" }}>
                    <td style={{ padding: "0.5rem" }}>{u.id}</td>
                    <td style={{ padding: "0.5rem" }}>{u.email}</td>
                    <td style={{ padding: "0.5rem" }}>{u.role}</td>
                    <td style={{ padding: "0.5rem" }}>{u.is_active ? "да" : "нет"}</td>
                    <td style={{ padding: "0.5rem", whiteSpace: "nowrap" }}>
                      <button type="button" className="btn btn-secondary btn-sm" onClick={() => startEdit(u)}>
                        Править
                      </button>{" "}
                      <button type="button" className="btn btn-ghost btn-sm" onClick={() => resetPassword(u.id)}>
                        Сброс пароля
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {editingId != null ? (
            <div className="panel" style={{ marginTop: "1.5rem", display: "grid", gap: 12 }}>
              <h2 className="section-title panel-heading-sm">Редактирование #{editingId}</h2>
              <label className="muted" style={{ display: "grid", gap: 4 }}>
                Email
                <input
                  className="input"
                  type="email"
                  value={draft.email}
                  onChange={(e) => setDraft((p) => ({ ...p, email: e.target.value }))}
                />
              </label>
              <label className="muted" style={{ display: "grid", gap: 4 }}>
                Телефон
                <input
                  className="input"
                  value={draft.phone}
                  onChange={(e) => setDraft((p) => ({ ...p, phone: e.target.value }))}
                />
              </label>
              <label className="muted" style={{ display: "grid", gap: 4 }}>
                Имя (ФИО)
                <input
                  className="input"
                  value={draft.full_name}
                  onChange={(e) => setDraft((p) => ({ ...p, full_name: e.target.value }))}
                />
              </label>
              <label className="muted" style={{ display: "grid", gap: 4 }}>
                Имя в чатах
                <input
                  className="input"
                  value={draft.display_name}
                  onChange={(e) => setDraft((p) => ({ ...p, display_name: e.target.value }))}
                />
              </label>
              <label className="muted" style={{ display: "grid", gap: 4 }}>
                Компания
                <input
                  className="input"
                  value={draft.company_name}
                  onChange={(e) => setDraft((p) => ({ ...p, company_name: e.target.value }))}
                />
              </label>
              <label className="muted" style={{ display: "grid", gap: 4 }}>
                Роль
                <select
                  className="input"
                  value={draft.role}
                  onChange={(e) => setDraft((p) => ({ ...p, role: e.target.value }))}
                >
                  {ROLES.map((r) => (
                    <option key={r} value={r}>
                      {r}
                    </option>
                  ))}
                </select>
              </label>
              <label className="muted" style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <input
                  type="checkbox"
                  checked={!!draft.is_active}
                  onChange={(e) => setDraft((p) => ({ ...p, is_active: e.target.checked }))}
                />
                Активен
              </label>
              <div style={{ display: "flex", gap: 8 }}>
                <button type="button" className="btn btn-primary" onClick={saveEdit}>
                  Сохранить
                </button>
                <button type="button" className="btn btn-ghost" onClick={() => setEditingId(null)}>
                  Отмена
                </button>
              </div>
            </div>
          ) : null}
        </div>
      </main>
    </div>
  );
}
