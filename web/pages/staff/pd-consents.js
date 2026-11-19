import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter } from "next/router";

import HeaderProfileLink from "../../components/HeaderProfileLink";
import { clearToken, ensureFreshAccessToken, getStoredToken } from "../../lib/auth";
import { isAdminRole } from "../../lib/roles";
import SiteHeader from "../../components/SiteHeader";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

const FILTERS = [
  ["", "Все"],
  ["withdrawal", "Отзывы"],
  ["register", "Регистрация"],
  ["lead", "Заявка с авто"],
  ["freeform", "Заявка"],
  ["guest_chat", "Чат гостя"],
  ["blog_distribution", "Публикация"],
  ["cookies", "Cookies"],
];

export default function PdConsentsPage() {
  const router = useRouter();
  const [token, setToken] = useState("");
  const [rows, setRows] = useState([]);
  const [filter, setFilter] = useState("withdrawal");
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const access = await ensureFreshAccessToken();
      if (!access) {
        router.replace("/auth?next=/staff/pd-consents");
        return;
      }
      const meRes = await fetch(`${API_URL}/auth/me`, {
        headers: { Authorization: `Bearer ${access}` },
      });
      if (!meRes.ok) {
        clearToken();
        router.replace("/auth?next=/staff/pd-consents");
        return;
      }
      const me = await meRes.json();
      if (!isAdminRole(me.role)) {
        router.replace("/profile");
        return;
      }
      if (!cancelled) setToken(access);
    })();
    return () => {
      cancelled = true;
    };
  }, [router]);

  useEffect(() => {
    if (!token) return undefined;
    let cancelled = false;
    (async () => {
      const query = filter ? `?form_code=${encodeURIComponent(filter)}` : "";
      const res = await fetch(`${API_URL}/admin/pd-consents${query}`, {
        headers: { Authorization: `Bearer ${getStoredToken() || token}` },
      });
      const data = await res.json().catch(() => []);
      if (cancelled) return;
      if (!res.ok) {
        setError(typeof data.detail === "string" ? data.detail : "Не удалось загрузить журнал");
        setRows([]);
        return;
      }
      setError("");
      setRows(Array.isArray(data) ? data : []);
    })();
    return () => {
      cancelled = true;
    };
  }, [token, filter]);

  return (
    <div className="layout">
      <SiteHeader>
        <HeaderProfileLink />
      </SiteHeader>
      <main className="container" style={{ padding: "1.5rem 0 3rem" }}>
        <p className="muted">
          <Link href="/profile">Профиль</Link>
        </p>
        <h1 className="section-title">Журнал согласий</h1>
        <p className="muted">
          Запросы на отзыв смотрите в первую очередь. Запись фиксирует редакцию, время и форму, а не
          заменяет ответ человеку.
        </p>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", margin: "1rem 0" }}>
          {FILTERS.map(([code, label]) => (
            <button
              key={code || "all"}
              type="button"
              className={`btn btn-sm ${filter === code ? "btn-primary" : "btn-secondary"}`}
              onClick={() => setFilter(code)}
            >
              {label}
            </button>
          ))}
        </div>
        {error ? <div className="alert alert--danger">{error}</div> : null}
        <div style={{ overflowX: "auto" }}>
          <table className="admin-users-table" style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.875rem" }}>
            <thead>
              <tr>
                <th>Когда</th>
                <th>Форма</th>
                <th>Email</th>
                <th>Телефон</th>
                <th>Заметка</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id}>
                  <td>{row.created_at ? new Date(row.created_at).toLocaleString("ru-RU") : ""}</td>
                  <td>{row.form_code}</td>
                  <td>{row.subject_email || ""}</td>
                  <td>{row.subject_phone || ""}</td>
                  <td>{row.note || (row.accepted ? "согласие" : "отказ или отзыв")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {rows.length === 0 && !error ? <p className="muted">Записей нет.</p> : null}
      </main>
    </div>
  );
}
