import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/router";

import HeaderProfileLink from "../../components/HeaderProfileLink";
import { clearToken, getStoredToken } from "../../lib/auth";
import { isStaffRole } from "../../lib/roles";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

function authHeaders(token) {
  return { Authorization: `Bearer ${token}` };
}

export default function StaffImportCandidatesPage() {
  const router = useRouter();
  const [token, setToken] = useState("");
  const [me, setMe] = useState(null);
  const [profiles, setProfiles] = useState([]);
  const [profileId, setProfileId] = useState("");
  const [status, setStatus] = useState("");
  const [rows, setRows] = useState([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(
    async (t, pid, st) => {
      setBusy(true);
      setError("");
      try {
        const qs = new URLSearchParams();
        if (pid) qs.set("profile_id", String(pid));
        if (st) qs.set("status", st);
        qs.set("limit", "200");
        const res = await fetch(`${API_URL}/admin/import-candidates?${qs}`, {
          headers: authHeaders(t),
        });
        if (res.status === 401) {
          clearToken();
          router.push("/auth?next=/staff/import-candidates");
          return;
        }
        if (!res.ok) {
          setError("Не удалось загрузить кандидатов");
          return;
        }
        setRows(await res.json());
      } finally {
        setBusy(false);
      }
    },
    [router]
  );

  useEffect(() => {
    const t = getStoredToken();
    if (!t) {
      router.push("/auth?next=/staff/import-candidates");
      return;
    }
    setToken(t);
    (async () => {
      const meRes = await fetch(`${API_URL}/auth/me`, { headers: authHeaders(t) });
      if (!meRes.ok) {
        clearToken();
        router.push("/auth?next=/staff/import-candidates");
        return;
      }
      const meJson = await meRes.json();
      if (!isStaffRole(meJson.role)) {
        router.push("/profile");
        return;
      }
      setMe(meJson);
      const pRes = await fetch(`${API_URL}/admin/search-profiles`, {
        headers: authHeaders(t),
      });
      if (pRes.ok) {
        const list = await pRes.json();
        setProfiles(list);
        const first = list[0]?.id ? String(list[0].id) : "";
        setProfileId(first);
        await load(t, first, "");
      }
    })();
  }, [router, load]);

  if (!me) {
    return (
      <div className="container">
        <p className="muted">Загрузка…</p>
      </div>
    );
  }

  return (
    <div className="container import-plan-page">
      <header className="page-header row-between">
        <div>
          <h1 className="page-title">Кандидаты агента</h1>
          <p className="muted">
            Staging отбора: score, reasons, статус. План импорта —{" "}
            <Link href="/staff/import-plan">отдельно</Link>.
          </p>
        </div>
        <HeaderProfileLink />
      </header>

      <div className="import-plan-toolbar" style={{ gap: "0.75rem", flexWrap: "wrap" }}>
        <label className="muted">
          Профиль{" "}
          <select
            className="input"
            value={profileId}
            onChange={(e) => {
              const v = e.target.value;
              setProfileId(v);
              load(token, v, status);
            }}
          >
            {profiles.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name} (#{p.id}, max {p.max_select}/день)
              </option>
            ))}
          </select>
        </label>
        <label className="muted">
          Статус{" "}
          <select
            className="input"
            value={status}
            onChange={(e) => {
              const v = e.target.value;
              setStatus(v);
              load(token, profileId, v);
            }}
          >
            <option value="">все</option>
            <option value="new">new</option>
            <option value="filtered">filtered</option>
            <option value="scored">scored</option>
            <option value="selected">selected</option>
            <option value="rejected">rejected</option>
            <option value="imported">imported</option>
          </select>
        </label>
        <button
          type="button"
          className="btn btn-secondary btn-inline"
          disabled={busy}
          onClick={() => load(token, profileId, status)}
        >
          Обновить
        </button>
      </div>

      {error ? <p className="error">{error}</p> : null}

      <div className="import-plan-table-wrap">
        <table className="import-plan-table">
          <thead>
            <tr>
              <th>Score</th>
              <th>Статус</th>
              <th>Марка / модель</th>
              <th>Год</th>
              <th>Пробег</th>
              <th>Reasons</th>
              <th>URL</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={7} className="muted">
                  {busy ? "Загрузка…" : "Пока нет кандидатов"}
                </td>
              </tr>
            ) : (
              rows.map((c) => (
                <tr key={c.id}>
                  <td className="import-plan-table__mono">
                    {c.score != null ? Number(c.score).toFixed(0) : "—"}
                  </td>
                  <td>{c.status}</td>
                  <td>
                    {[c.brand_name, c.model_name].filter(Boolean).join(" ") || "—"}
                  </td>
                  <td>{c.year ?? "—"}</td>
                  <td>{c.mileage_km ?? "—"}</td>
                  <td>
                    <div className="import-plan-msg" title={(c.reasons || []).join("; ")}>
                      {(c.reasons || []).slice(0, 3).join("; ") ||
                        (c.filter_reasons || []).join("; ") ||
                        "—"}
                    </div>
                  </td>
                  <td>
                    {c.url ? (
                      <a href={c.url} target="_blank" rel="noreferrer">
                        открыть
                      </a>
                    ) : (
                      "—"
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
