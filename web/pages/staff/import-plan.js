import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/router";

import HeaderProfileLink from "../../components/HeaderProfileLink";
import SiteSelectDropdown from "../../components/SiteSelectDropdown";
import { clearToken, getStoredToken } from "../../lib/auth";
import {
  IMPORT_PLAN_MAX_RETRIES,
  addImportPlanRow,
  bootstrapImportPlan,
  clearFinishedImportPlanRows,
  getImportPlanState,
  patchImportPlanRow,
  removeImportPlanRow,
  setImportPlanToken,
  startImportPlan,
  stopImportPlan,
  stopImportPlanPolling,
  subscribeImportPlan,
} from "../../lib/importPlanStore";
import { isAdminRole, isStaffRole } from "../../lib/roles";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

const MARKETPLACE_OPTIONS = [
  { value: "che168", label: "che168.com" },
  { value: "global_che168", label: "global.che168.com" },
  { value: "dongchedi", label: "dongchedi.com" },
];

function urlPlaceholder(marketplace) {
  if (marketplace === "global_che168") return "https://global.che168.com/detail/…";
  if (marketplace === "dongchedi") return "https://www.dongchedi.com/usedcar/…";
  return "https://www.che168.com/dealer/…/….html";
}

function statusIcon(status) {
  if (status === "success") return { symbol: "✓", className: "import-plan-status import-plan-status--ok" };
  if (status === "failed") return { symbol: "✕", className: "import-plan-status import-plan-status--err" };
  if (status === "running" || status === "queued")
    return { symbol: "…", className: "import-plan-status import-plan-status--run" };
  if (status === "cancelled")
    return { symbol: "■", className: "import-plan-status import-plan-status--muted" };
  return { symbol: "○", className: "import-plan-status import-plan-status--pending" };
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

export default function StaffImportPlanPage() {
  const router = useRouter();
  const [token, setToken] = useState("");
  const [me, setMe] = useState(null);
  const [plan, setPlan] = useState(() => getImportPlanState());
  const [brands, setBrands] = useState([]);
  const [modelsByBrand, setModelsByBrand] = useState({});
  const [gensByModel, setGensByModel] = useState({});
  const [catalogBusy, setCatalogBusy] = useState(false);
  const [catalogNotice, setCatalogNotice] = useState("");
  const [catalogNoticeIsError, setCatalogNoticeIsError] = useState(false);

  const rows = plan.rows;
  const running = plan.running;
  const banner = plan.banner;
  const error = plan.error;

  useEffect(() => subscribeImportPlan(setPlan), []);

  useEffect(() => {
    return () => stopImportPlanPolling();
  }, []);

  useEffect(() => {
    const t = getStoredToken();
    if (!t) {
      router.push("/auth?next=/staff/import-plan");
      return;
    }
    setToken(t);
    setImportPlanToken(t);
    (async () => {
      const res = await fetch(`${API_URL}/auth/me`, { headers: { Authorization: `Bearer ${t}` } });
      if (!res.ok) {
        clearToken();
        router.push("/auth?next=/staff/import-plan");
        return;
      }
      const data = await res.json();
      setMe(data);
      if (!isStaffRole(data.role)) {
        router.replace("/profile");
        return;
      }
      const b = await fetch(`${API_URL}/staff/catalog/brands`, {
        headers: { Authorization: `Bearer ${t}` },
      });
      if (b.ok) setBrands(await b.json());
      await bootstrapImportPlan(t);
    })();
  }, [router]);

  const brandOptions = useMemo(
    () => [
      { value: "", label: "— марка —" },
      ...brands.map((b) => ({ value: String(b.id), label: b.name })),
    ],
    [brands]
  );

  const ensureModels = useCallback(
    async (brandId) => {
      if (!token || !brandId || modelsByBrand[brandId]) return;
      const r = await fetch(`${API_URL}/staff/catalog/models?brand_id=${brandId}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (r.ok) {
        const list = await r.json();
        setModelsByBrand((prev) => ({ ...prev, [brandId]: list }));
      }
    },
    [token, modelsByBrand]
  );

  const ensureGens = useCallback(
    async (modelId) => {
      if (!token || !modelId || gensByModel[modelId]) return;
      const r = await fetch(`${API_URL}/staff/catalog/generations?model_id=${modelId}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (r.ok) {
        const list = await r.json();
        setGensByModel((prev) => ({ ...prev, [modelId]: list }));
      }
    },
    [token, gensByModel]
  );

  async function reloadBrands() {
    if (!token) return [];
    const r = await fetch(`${API_URL}/staff/catalog/brands`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!r.ok) return [];
    const list = await r.json();
    setBrands(list);
    return list;
  }

  async function reloadModels(brandId) {
    if (!token || !brandId) return [];
    const r = await fetch(`${API_URL}/staff/catalog/models?brand_id=${brandId}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!r.ok) return [];
    const list = await r.json();
    setModelsByBrand((prev) => ({ ...prev, [brandId]: list }));
    return list;
  }

  async function reloadGens(modelId) {
    if (!token || !modelId) return [];
    const r = await fetch(`${API_URL}/staff/catalog/generations?model_id=${modelId}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!r.ok) return [];
    const list = await r.json();
    setGensByModel((prev) => ({ ...prev, [modelId]: list }));
    return list;
  }

  const catalogKeys = rows.map((r) => `${r.brandId}:${r.modelId}`).join("|");
  useEffect(() => {
    if (!token) return;
    const brandIds = [...new Set(rows.map((r) => r.brandId).filter(Boolean))];
    brandIds.forEach((id) => ensureModels(id));
    const modelIds = [...new Set(rows.map((r) => r.modelId).filter(Boolean))];
    modelIds.forEach((id) => ensureGens(id));
  }, [token, catalogKeys, ensureModels, ensureGens, rows]);

  async function createBrandForRow(rowId, name) {
    const n = String(name || "").trim();
    if (!token || !n || !isAdminRole(me?.role) || running) return;
    setCatalogNotice("");
    setCatalogNoticeIsError(false);
    setCatalogBusy(true);
    try {
      const res = await fetch(`${API_URL}/admin/car-brands`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ name: n }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setCatalogNoticeIsError(true);
        setCatalogNotice(formatApiErrorDetail(body) || `Ошибка ${res.status}: не удалось добавить марку`);
        return;
      }
      const created = { id: body.id, name: body.name };
      setBrands((prev) => {
        const next = prev.filter((b) => b.id !== created.id);
        next.push(created);
        next.sort((a, b) => a.name.localeCompare(b.name, "ru"));
        return next;
      });
      patchImportPlanRow(rowId, {
        brandId: String(created.id),
        brandName: created.name,
        modelId: "",
        modelName: "",
        generationId: "",
        generationName: "",
      });
      setCatalogNoticeIsError(false);
      setCatalogNotice(`Марка «${created.name}» добавлена. Выберите или добавьте модель.`);
      await reloadBrands();
    } finally {
      setCatalogBusy(false);
    }
  }

  async function createModelForRow(rowId, brandId, name) {
    const n = String(name || "").trim();
    if (!token || !n || !brandId || !isAdminRole(me?.role) || running) return;
    setCatalogNotice("");
    setCatalogNoticeIsError(false);
    setCatalogBusy(true);
    try {
      const res = await fetch(`${API_URL}/admin/car-brands/${brandId}/models`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ name: n }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setCatalogNoticeIsError(true);
        setCatalogNotice(formatApiErrorDetail(body) || `Ошибка ${res.status}: не удалось добавить модель`);
        return;
      }
      if (body?.id == null || body?.name == null) {
        setCatalogNoticeIsError(true);
        setCatalogNotice("Сервер вернул неполные данные о модели.");
        return;
      }
      const created = { id: body.id, name: body.name };
      setModelsByBrand((prev) => {
        const cur = prev[brandId] || [];
        const next = cur.filter((m) => m.id !== created.id);
        next.push(created);
        next.sort((a, b) => a.name.localeCompare(b.name, "ru"));
        return { ...prev, [brandId]: next };
      });
      patchImportPlanRow(rowId, {
        modelId: String(created.id),
        modelName: created.name,
        generationId: "",
        generationName: "",
      });
      setCatalogNoticeIsError(false);
      setCatalogNotice(`Модель «${created.name}» добавлена.`);
      await reloadModels(brandId);
    } finally {
      setCatalogBusy(false);
    }
  }

  async function createGenerationForRow(rowId, modelId, name) {
    const n = String(name || "").trim();
    if (!token || !n || !modelId || !isAdminRole(me?.role) || running) return;
    setCatalogNotice("");
    setCatalogNoticeIsError(false);
    setCatalogBusy(true);
    try {
      const res = await fetch(`${API_URL}/admin/car-models/${modelId}/generations`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ name: n }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setCatalogNoticeIsError(true);
        setCatalogNotice(
          typeof body.detail === "string" ? body.detail : `Ошибка ${res.status}: не удалось добавить поколение`
        );
        return;
      }
      const created = {
        id: body.id,
        name: body.name,
        slug: body.slug ?? "",
        listings_count: body.listings_count ?? 0,
      };
      setGensByModel((prev) => {
        const cur = prev[modelId] || [];
        const next = cur.filter((g) => g.id !== created.id);
        next.push(created);
        next.sort((a, b) => a.name.localeCompare(b.name, "ru"));
        return { ...prev, [modelId]: next };
      });
      patchImportPlanRow(rowId, {
        generationId: String(created.id),
        generationName: created.name,
      });
      setCatalogNoticeIsError(false);
      setCatalogNotice(`Поколение «${created.name}» добавлено.`);
      await reloadGens(modelId);
    } finally {
      setCatalogBusy(false);
    }
  }

  const canCreateCatalog = isAdminRole(me?.role) && !running;

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
        <div className="container import-plan-page">
          <p className="muted" style={{ marginBottom: "0.5rem" }}>
            <Link href="/">← Главная</Link>
            {" · "}
            <Link href="/profile">Профиль</Link>
          </p>
          <h1 className="section-title">План импорта объявлений</h1>
          <p className="muted" style={{ marginTop: "-0.35rem", marginBottom: "1rem" }}>
            Составьте список ссылок, затем запустите обход. При ошибке — до {IMPORT_PLAN_MAX_RETRIES} попыток на
            строку, затем следующая. План и прогресс хранятся на сервере — можно закрыть сайт; с другого
            устройства под admin/moderator виден тот же статус.
            {isAdminRole(me?.role)
              ? " Нет нужной марки/модели/поколения — введите название в поиске выпадающего списка и нажмите «Добавить»."
              : ""}
          </p>

          {error ? <div className="alert alert--danger">{error}</div> : null}
          {banner ? <div className="alert alert--success">{banner}</div> : null}
          {catalogNotice ? (
            <div
              className={`alert ${catalogNoticeIsError ? "alert--danger" : "alert--success"}`}
              style={{ marginBottom: "0.75rem" }}
            >
              {catalogNotice}
            </div>
          ) : null}

          <div className="import-plan-toolbar">
            <button
              type="button"
              className="btn btn-primary"
              disabled={running}
              onClick={() => startImportPlan(token)}
            >
              {running ? "Идёт импорт…" : "Запустить обход"}
            </button>
            <button type="button" className="btn btn-secondary" disabled={!running} onClick={() => stopImportPlan()}>
              Остановить
            </button>
            <button type="button" className="btn btn-ghost" disabled={running} onClick={() => addImportPlanRow()}>
              + Строка
            </button>
            <button
              type="button"
              className="btn btn-ghost"
              disabled={running}
              onClick={() => clearFinishedImportPlanRows()}
            >
              Убрать успешные
            </button>
          </div>

          <div className="import-plan-table-wrap">
            <table className="import-plan-table">
              <thead>
                <tr>
                  <th style={{ width: 36 }}> </th>
                  <th>Площадка</th>
                  <th>Марка</th>
                  <th>Модель</th>
                  <th>Поколение</th>
                  <th>Ссылка</th>
                  <th style={{ width: 72 }}>Попытки</th>
                  <th>Статус</th>
                  <th style={{ width: 56 }}> </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => {
                  const icon = statusIcon(row.status);
                  const models = row.brandId ? modelsByBrand[row.brandId] || [] : [];
                  const gens = row.modelId ? gensByModel[row.modelId] || [] : [];
                  return (
                    <tr
                      key={row.id}
                      className={
                        row.status === "success"
                          ? "import-plan-table__row--ok"
                          : row.status === "failed"
                            ? "import-plan-table__row--err"
                            : row.status === "running" || row.status === "queued"
                              ? "import-plan-table__row--run"
                              : ""
                      }
                    >
                      <td>
                        <span className={icon.className} title={row.status}>
                          {icon.symbol}
                        </span>
                      </td>
                      <td>
                        <SiteSelectDropdown
                          className="site-dropdown--block"
                          portal
                          value={row.marketplace}
                          disabled={running}
                          onChange={(v) => v && patchImportPlanRow(row.id, { marketplace: v })}
                          options={MARKETPLACE_OPTIONS}
                        />
                      </td>
                      <td>
                        <SiteSelectDropdown
                          className="site-dropdown--block"
                          portal
                          searchable
                          busy={catalogBusy}
                          value={row.brandId}
                          disabled={running}
                          placeholder="— марка —"
                          createActionLabel="Добавить марку"
                          onCreateFromSearch={
                            canCreateCatalog ? (q) => createBrandForRow(row.id, q) : undefined
                          }
                          onChange={(v) => {
                            const brand = brands.find((b) => String(b.id) === String(v));
                            patchImportPlanRow(row.id, {
                              brandId: v || "",
                              brandName: brand?.name || "",
                              modelId: "",
                              modelName: "",
                              generationId: "",
                              generationName: "",
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
                          busy={catalogBusy}
                          value={row.modelId}
                          disabled={running || !row.brandId}
                          placeholder={row.brandId ? "— модель —" : "Сначала марка"}
                          createActionLabel="Добавить модель"
                          onCreateFromSearch={
                            canCreateCatalog && row.brandId
                              ? (q) => createModelForRow(row.id, row.brandId, q)
                              : undefined
                          }
                          onChange={(v) => {
                            const model = models.find((m) => String(m.id) === String(v));
                            patchImportPlanRow(row.id, {
                              modelId: v || "",
                              modelName: model?.name || "",
                              generationId: "",
                              generationName: "",
                            });
                            if (v) ensureGens(v);
                          }}
                          options={[
                            { value: "", label: row.brandId ? "— модель —" : "Сначала марка" },
                            ...models.map((m) => ({ value: String(m.id), label: m.name })),
                          ]}
                        />
                      </td>
                      <td>
                        <SiteSelectDropdown
                          className="site-dropdown--block"
                          portal
                          searchable
                          busy={catalogBusy}
                          value={row.generationId}
                          disabled={running || !row.modelId}
                          placeholder="— не выбрано —"
                          createActionLabel="Добавить поколение"
                          onCreateFromSearch={
                            canCreateCatalog && row.modelId
                              ? (q) => createGenerationForRow(row.id, row.modelId, q)
                              : undefined
                          }
                          onChange={(v) => {
                            const gen = gens.find((g) => String(g.id) === String(v));
                            patchImportPlanRow(row.id, {
                              generationId: v || "",
                              generationName: gen?.name || "",
                            });
                          }}
                          options={[
                            { value: "", label: "— не выбрано —" },
                            ...gens.map((g) => ({ value: String(g.id), label: g.name })),
                          ]}
                        />
                      </td>
                      <td>
                        <input
                          className="input import-plan-url"
                          type="url"
                          disabled={running}
                          placeholder={urlPlaceholder(row.marketplace)}
                          value={row.url}
                          onChange={(e) => patchImportPlanRow(row.id, { url: e.target.value })}
                        />
                      </td>
                      <td className="import-plan-table__mono">
                        {row.attempts ? `${row.attempts}/${IMPORT_PLAN_MAX_RETRIES}` : "—"}
                      </td>
                      <td>
                        <div className="import-plan-msg" title={row.message || row.status}>
                          {row.message || row.status}
                        </div>
                      </td>
                      <td>
                        <button
                          type="button"
                          className="btn btn-ghost btn-sm"
                          disabled={running}
                          title="Удалить строку"
                          onClick={() => removeImportPlanRow(row.id)}
                        >
                          ×
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      </main>
    </div>
  );
}
