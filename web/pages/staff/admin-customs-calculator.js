import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/router";

import AdminUtilCoeffEditor from "../../components/AdminUtilCoeffEditor";
import HeaderProfileLink from "../../components/HeaderProfileLink";
import { clearToken, getStoredToken } from "../../lib/auth";
import { isAdminRole } from "../../lib/roles";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

function parseApiError(body) {
  if (!body || typeof body !== "object") return "";
  if (typeof body.detail === "string") return body.detail;
  return "";
}

export default function AdminCustomsCalculatorPage() {
  const router = useRouter();
  const [token, setToken] = useState("");
  const [me, setMe] = useState(null);
  const [configYaml, setConfigYaml] = useState("");
  const [utilIndividual, setUtilIndividual] = useState("");
  const [utilCompany, setUtilCompany] = useState("");
  const [updatedAt, setUpdatedAt] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  /** @type {'tks' | 'util'} */
  const [section, setSection] = useState("util");
  /** @type {'individual' | 'company'} */
  const [utilAudience, setUtilAudience] = useState("individual");

  useEffect(() => {
    const t = getStoredToken();
    if (!t) {
      router.push("/auth?next=/staff/admin-customs-calculator");
      return;
    }
    setToken(t);
    (async () => {
      const meRes = await fetch(`${API_URL}/auth/me`, { headers: { Authorization: `Bearer ${t}` } });
      if (!meRes.ok) {
        clearToken();
        router.push("/auth?next=/staff/admin-customs-calculator");
        return;
      }
      const meData = await meRes.json();
      setMe(meData);
      if (!isAdminRole(meData.role)) {
        router.replace("/profile");
        return;
      }
      await loadConfig(t);
    })();
  }, []);

  const loadConfig = useCallback(async (t) => {
    setError("");
    const res = await fetch(`${API_URL}/admin/customs-calculator/config`, {
      headers: { Authorization: `Bearer ${t}` },
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      setError(parseApiError(body) || "Не удалось загрузить конфиг.");
      return;
    }
    setConfigYaml(body.config_yaml || "");
    setUtilIndividual(body.util_coefficients_individual || "");
    setUtilCompany(body.util_coefficients_company || "");
    setUpdatedAt(body.updated_at || "");
  }, []);

  async function loadUtilDefaults(audience) {
    setError("");
    setMessage("");
    try {
      const res = await fetch(`${API_URL}/admin/customs-calculator/util-defaults`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(parseApiError(body) || "Не удалось загрузить таблицы по умолчанию.");
        return;
      }
      if (audience === "individual") {
        setUtilIndividual(body.individual || "");
      } else {
        setUtilCompany(body.company || "");
      }
      setMessage("Подставлены встроенные коэффициенты. Сохраните, чтобы записать в БД.");
    } catch {
      setError("Сеть: не удалось загрузить таблицы по умолчанию.");
    }
  }

  function loadBuiltInForCurrentUtil() {
    loadUtilDefaults(utilAudience);
  }

  async function saveConfig() {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const res = await fetch(`${API_URL}/admin/customs-calculator/config`, {
        method: "PUT",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          config_yaml: configYaml,
          util_coefficients_individual: utilIndividual || null,
          util_coefficients_company: utilCompany || null,
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(parseApiError(body) || "Не удалось сохранить конфиг.");
        return;
      }
      setMessage("Сохранено.");
      setUpdatedAt(body.updated_at || "");
      setConfigYaml(body.config_yaml || configYaml);
      setUtilIndividual(body.util_coefficients_individual || "");
      setUtilCompany(body.util_coefficients_company || "");
    } finally {
      setBusy(false);
    }
  }

  function logout() {
    clearToken();
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
        <div className="container" style={{ maxWidth: 900 }}>
          <p className="muted" style={{ marginBottom: "0.5rem" }}>
            <Link href="/profile#admin-settings">← В профиль</Link>
            <span aria-hidden> · </span>
            <button
              type="button"
              onClick={() => router.back()}
              className="admin-calc-back"
            >
              Назад
            </button>
          </p>
          <div style={{ display: "flex", flexWrap: "wrap", alignItems: "baseline", justifyContent: "space-between", gap: "0.75rem" }}>
            <h1 className="section-title" style={{ marginBottom: 0 }}>
              Калькулятор растаможки
            </h1>
            {updatedAt ? (
              <span className="muted" style={{ fontSize: "0.9rem" }}>
                Обновлено {new Date(updatedAt).toLocaleString("ru-RU")}
              </span>
            ) : null}
          </div>

          <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center", marginTop: "1rem", marginBottom: "0.75rem" }}>
            <button type="button" className="btn btn-primary" onClick={saveConfig} disabled={busy}>
              {busy ? "Сохранение…" : "Сохранить"}
            </button>
            <button type="button" className="btn btn-secondary" onClick={() => loadConfig(token)} disabled={busy}>
              Загрузить из БД
            </button>
          </div>

          {message ? <div className="alert alert--success">{message}</div> : null}
          {error ? <div className="alert alert--danger">{error}</div> : null}

          <div className="admin-calc-segment" role="tablist" aria-label="Раздел настроек">
            <button
              type="button"
              role="tab"
              aria-selected={section === "util"}
              className={section === "util" ? "is-active" : ""}
              onClick={() => setSection("util")}
            >
              Утилизационный сбор
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={section === "tks"}
              className={section === "tks" ? "is-active" : ""}
              onClick={() => setSection("tks")}
            >
              Конфиг TKS (YAML)
            </button>
          </div>

          {section === "util" ? (
            <div className="panel" style={{ padding: "1rem 1.25rem" }}>
              <div className="admin-calc-segment" role="tablist" aria-label="Для кого таблицы">
                <button
                  type="button"
                  className={utilAudience === "individual" ? "is-active" : ""}
                  onClick={() => setUtilAudience("individual")}
                >
                  Физлица
                </button>
                <button
                  type="button"
                  className={utilAudience === "company" ? "is-active" : ""}
                  onClick={() => setUtilAudience("company")}
                >
                  Юрлица
                </button>
              </div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: "1rem" }}>
                <button type="button" className="btn btn-secondary btn-sm" onClick={loadBuiltInForCurrentUtil}>
                  Подставить встроенные ({utilAudience === "individual" ? "физлица" : "юрлица"})
                </button>
              </div>
              {utilAudience === "individual" ? (
                <AdminUtilCoeffEditor value={utilIndividual} onChange={setUtilIndividual} mode="individual" />
              ) : (
                <AdminUtilCoeffEditor value={utilCompany} onChange={setUtilCompany} mode="company" />
              )}
            </div>
          ) : null}

          {section === "tks" ? (
            <div className="panel" style={{ padding: "1rem 1.25rem" }}>
              <label className="form-label">
                Конфигурация (YAML)
                <textarea
                  className="input"
                  value={configYaml}
                  onChange={(e) => setConfigYaml(e.target.value)}
                  rows={28}
                  style={{ fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace", fontSize: "0.88rem" }}
                />
              </label>
            </div>
          ) : null}
        </div>
      </main>
    </div>
  );
}
