import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter } from "next/router";

import DealerOpenRequests from "../../components/DealerOpenRequests";
import HeaderProfileLink from "../../components/HeaderProfileLink";
import { clearToken, getStoredToken } from "../../lib/auth";
import { isAdminRole, isStaffRole } from "../../lib/roles";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

/**
 * Рабочая страница открытых заявок для ответа (раньше длинный список в профиле админа).
 */
export default function StaffOpenRequestsPage() {
  const router = useRouter();
  const [token, setToken] = useState("");
  const [me, setMe] = useState(null);

  useEffect(() => {
    const t = getStoredToken();
    if (!t) {
      router.push("/auth?next=/staff/open-requests");
      return;
    }
    setToken(t);
    (async () => {
      const res = await fetch(`${API_URL}/auth/me`, { headers: { Authorization: `Bearer ${t}` } });
      if (!res.ok) {
        clearToken();
        router.push("/auth?next=/staff/open-requests");
        return;
      }
      const data = await res.json();
      setMe(data);
      if (!(isAdminRole(data.role) || data.role === "dealer" || isStaffRole(data.role))) {
        router.replace("/profile");
      }
    })();
  }, [router]);

  function logout() {
    clearToken({ logout: true });
    router.push("/");
  }

  if (!me) {
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
            {" · "}
            <Link href="/staff/admin-requests">Все заявки</Link>
          </p>
          <h1 className="section-title">Открытые заявки — подготовка расчёта</h1>
          <p className="muted" style={{ marginTop: "-0.35rem", marginBottom: "1rem" }}>
            Здесь можно ответить на заявку клиента: сумма, срок и условия.
          </p>
          <DealerOpenRequests
            token={token}
            onOpenChat={(chatId) =>
              router.push(`/messages?chat=${encodeURIComponent(String(chatId))}`)
            }
            onChatsUpdated={() => {}}
          />
        </div>
      </main>
    </div>
  );
}
