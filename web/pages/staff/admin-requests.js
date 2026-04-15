import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter } from "next/router";

import HeaderProfileLink from "../../components/HeaderProfileLink";
import { clearToken, getStoredToken } from "../../lib/auth";
import { mediaSrc } from "../../lib/media";
import { isStaffRole } from "../../lib/roles";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

function formatDate(iso) {
  try {
    return new Date(iso).toLocaleString("ru-RU");
  } catch {
    return iso;
  }
}

function offersLabel(n) {
  const x = Number(n) || 0;
  if (x === 0) return "Нет предложений дилеров";
  const mod10 = x % 10;
  const mod100 = x % 100;
  if (mod10 === 1 && mod100 !== 11) return `${x} предложение дилера`;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return `${x} предложения дилеров`;
  return `${x} предложений дилеров`;
}

export default function AdminRequestsPage() {
  const router = useRouter();
  const [token, setToken] = useState("");
  const [me, setMe] = useState(null);
  const [requests, setRequests] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    const t = getStoredToken();
    if (!t) {
      router.push("/auth?next=/staff/admin-requests");
      return;
    }
    setToken(t);
    (async () => {
      const res = await fetch(`${API_URL}/auth/me`, { headers: { Authorization: `Bearer ${t}` } });
      if (!res.ok) {
        clearToken();
        router.push("/auth?next=/staff/admin-requests");
        return;
      }
      const data = await res.json();
      setMe(data);
      if (!isStaffRole(data.role)) {
        router.replace("/profile");
        return;
      }
      const rr = await fetch(`${API_URL}/admin/calculation-requests`, {
        headers: { Authorization: `Bearer ${t}` },
      });
      if (!rr.ok) {
        setError("Не удалось загрузить заявки");
        setLoading(false);
        return;
      }
      setRequests(await rr.json());
      setLoading(false);
    })();
  }, []);

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
          <h1 className="section-title">Заявки на расчёт</h1>
          {error && <div className="alert alert--danger">{error}</div>}
          {requests.length === 0 ? (
            <p className="muted">Заявок пока нет.</p>
          ) : (
            <ul className="profile-request-list">
              {requests.map((r) => (
                <li key={r.id} className="profile-request-card" style={{ listStyle: "none" }}>
                  <Link
                    href={`/staff/admin-requests/${r.id}`}
                    className="profile-request-card__header profile-request-card__header--expanded"
                    style={{ textDecoration: "none", color: "inherit" }}
                  >
                    {r.car_thumb_url ? (
                      <img
                        className="profile-request-card__thumb-img"
                        src={mediaSrc(r.car_thumb_url)}
                        alt=""
                        width={88}
                        height={66}
                      />
                    ) : (
                      <div className="profile-request-card__thumb-ph" aria-hidden />
                    )}
                    <div className="profile-request-card__body">
                      <div className="profile-request-card__title-line">
                        <span className="profile-request-card__title-text">
                          #{r.id} · {r.car_brand} {r.car_model}
                          {r.car_year != null ? ` · ${r.car_year}` : ""}
                        </span>
                        <span
                          className={`admin-requests-offers-pill${
                            (r.offers?.length ?? 0) === 0 ? " admin-requests-offers-pill--empty" : ""
                          }`}
                          title="Ответы дилеров по заявке"
                        >
                          {offersLabel(r.offers?.length ?? 0)}
                        </span>
                      </div>
                      <div className="muted profile-request-card__meta-tight">{r.car_title}</div>
                      <div className="muted profile-request-card__meta-loose">
                        {formatDate(r.created_at)} · {r.status}
                        {r.client_email ? ` · ${r.client_email}` : ""}
                      </div>
                    </div>
                    <span className="btn btn-ghost btn-sm profile-request-card__toggle">Подробнее →</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      </main>
    </div>
  );
}
