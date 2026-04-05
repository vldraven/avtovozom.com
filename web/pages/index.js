import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/router";

import DealerOpenRequests from "../components/DealerOpenRequests";
import HeaderMessagesLink from "../components/HeaderMessagesLink";
import HeaderProfileLink from "../components/HeaderProfileLink";
import RequestConfirmModal from "../components/RequestConfirmModal";
import { clearToken } from "../lib/auth";
import { mediaSrc } from "../lib/media";
import { canCreateListings, isStaffRole } from "../lib/roles";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

const DEFAULT_REQUEST_COMMENT =
  "Нужен расчёт под ключ до РФ. Прошу уточнить сроки и стоимость доставки.";

export default function Home() {
  const router = useRouter();
  const [cars, setCars] = useState([]);
  const [total, setTotal] = useState(0);
  const [catalogCbr, setCatalogCbr] = useState(null);
  const [catalogCbrError, setCatalogCbrError] = useState(null);
  const [q, setQ] = useState("");
  const [catalogBrands, setCatalogBrands] = useState([]);
  const [brandsExpanded, setBrandsExpanded] = useState(false);
  const [catalogModels, setCatalogModels] = useState([]);
  const [selectedBrandId, setSelectedBrandId] = useState(null);
  const [selectedModelId, setSelectedModelId] = useState(null);
  const [token, setToken] = useState("");
  const [me, setMe] = useState(null);
  const [latestParserJob, setLatestParserJob] = useState(null);
  const [parserJobMessage, setParserJobMessage] = useState("");
  const [whitelistCatalog, setWhitelistCatalog] = useState([]);
  const [catalogUrlDrafts, setCatalogUrlDrafts] = useState({});
  /** Админка парсера: марка → модель → URL (не путать с фильтром каталога объявлений). */
  const [parserAdminBrand, setParserAdminBrand] = useState("");
  const [parserAdminModelId, setParserAdminModelId] = useState(null);
  const [profileReady, setProfileReady] = useState(false);
  const [requestModalCar, setRequestModalCar] = useState(null);
  const [requestModalComment, setRequestModalComment] = useState("");
  const [requestModalBusy, setRequestModalBusy] = useState(false);
  const sortedBrands = useMemo(() => {
    return [...catalogBrands].sort(
      (a, b) =>
        b.listings_count - a.listings_count || a.name.localeCompare(b.name, "ru")
    );
  }, [catalogBrands]);

  const BRANDS_COLLAPSED = 30;
  const visibleBrands = brandsExpanded
    ? sortedBrands
    : sortedBrands.slice(0, BRANDS_COLLAPSED);

  const parserAdminBrandNames = useMemo(() => {
    const names = [...new Set(whitelistCatalog.map((r) => r.brand))];
    return names.sort((a, b) => a.localeCompare(b, "ru"));
  }, [whitelistCatalog]);

  const parserAdminModelsInBrand = useMemo(() => {
    if (!parserAdminBrand) return [];
    return whitelistCatalog
      .filter((r) => r.brand === parserAdminBrand)
      .sort(
        (a, b) =>
          Number(b.enabled) - Number(a.enabled) || a.model.localeCompare(b.model, "ru")
      );
  }, [whitelistCatalog, parserAdminBrand]);

  const parserAdminSelectedRow = useMemo(() => {
    if (parserAdminModelId == null) return null;
    return whitelistCatalog.find((r) => r.model_id === parserAdminModelId) ?? null;
  }, [whitelistCatalog, parserAdminModelId]);

  const loadCars = useCallback(async () => {
    if (!router.isReady) return;
    const rawB = router.query.brand;
    const rawM = router.query.model;
    const rawQ = router.query.q;
    const brand = Array.isArray(rawB) ? rawB[0] : rawB;
    const model = Array.isArray(rawM) ? rawM[0] : rawM;
    const qq = Array.isArray(rawQ) ? rawQ[0] : rawQ;
    const params = new URLSearchParams();
    if (qq != null && String(qq).trim() !== "") params.set("q", String(qq).trim());
    if (brand) {
      const n = Number(brand);
      if (!Number.isNaN(n)) params.set("brand_id", String(n));
    }
    if (model) {
      const n = Number(model);
      if (!Number.isNaN(n)) params.set("model_id", String(n));
    }
    const res = await fetch(`${API_URL}/cars?${params.toString()}`);
    const data = await res.json();
    setCars(data.items || []);
    setTotal(data.total || 0);
    setCatalogCbr(data.cbr || null);
    setCatalogCbrError(data.cbr_error || null);
  }, [router.isReady, router.asPath]);

  function onSelectBrand(brandId) {
    const qq = q.trim();
    const query = {};
    if (qq) query.q = qq;
    query.brand = String(brandId);
    router.replace({ pathname: "/", query }, undefined, { shallow: true });
  }

  function onSelectModel(modelId) {
    const qq = q.trim();
    const rawB = router.query.brand;
    const brand = Array.isArray(rawB) ? rawB[0] : rawB;
    const bid = brand || selectedBrandId;
    const query = {};
    if (qq) query.q = qq;
    if (bid) query.brand = String(bid);
    query.model = String(modelId);
    router.replace({ pathname: "/", query }, undefined, { shallow: true });
  }

  function clearBrandModel() {
    const qq = q.trim();
    const query = {};
    if (qq) query.q = qq;
    router.replace({ pathname: "/", query }, undefined, { shallow: true });
  }

  function onSearchSubmit(e) {
    e.preventDefault();
    const rawB = router.query.brand;
    const rawM = router.query.model;
    const brand = Array.isArray(rawB) ? rawB[0] : rawB;
    const model = Array.isArray(rawM) ? rawM[0] : rawM;
    const qq = q.trim();
    if (!qq) setQ("");
    const query = {};
    if (qq) query.q = qq;
    if (brand) query.brand = String(brand);
    if (model) query.model = String(model);
    router.replace({ pathname: "/", query }, undefined, { shallow: true });
  }

  async function runParser() {
    if (!token) {
      alert("Сначала выполните вход");
      return;
    }
    setParserJobMessage("");
    try {
      const res = await fetch(`${API_URL}/admin/parser/run`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        setParserJobMessage("Не удалось запустить парсер. Проверь роль и доступность API.");
        return;
      }
      const job = await res.json();
      setLatestParserJob(job);
      setParserJobMessage("Парсер запущен. Статус обновляется автоматически.");
    } catch (e) {
      setParserJobMessage("Сбой связи с API. Проверь, что backend доступен, и попробуй еще раз.");
    }
  }

  async function deleteCar(carId) {
    if (!token) {
      alert("Сначала выполните вход");
      return;
    }
    if (!confirm("Удалить объявление из каталога? Его не будет видно в списке.")) {
      return;
    }
    const res = await fetch(`${API_URL}/admin/cars/${carId}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) {
      alert("Не удалось удалить. Нужны права администратора.");
      return;
    }
    await loadCars();
  }

  function openRequestForModal(car) {
    if (!token) {
      router.push(`/request-quote?car_id=${car.id}&next=${encodeURIComponent("/")}`);
      return;
    }
    setRequestModalCar(car);
    setRequestModalComment(DEFAULT_REQUEST_COMMENT);
  }

  function closeRequestModal() {
    if (requestModalBusy) return;
    setRequestModalCar(null);
  }

  async function confirmRequestFromModal() {
    if (!requestModalCar || !token) return;
    const comment = requestModalComment.trim() || DEFAULT_REQUEST_COMMENT;
    setRequestModalBusy(true);
    try {
      const res = await fetch(`${API_URL}/requests`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          car_id: requestModalCar.id,
          comment,
        }),
      });
      if (res.status === 401 || res.status === 403) {
        const cid = requestModalCar.id;
        clearToken();
        setToken("");
        setMe(null);
        setRequestModalCar(null);
        router.push(`/request-quote?car_id=${cid}&next=${encodeURIComponent("/")}`);
        return;
      }
      if (!res.ok) {
        alert("Не удалось отправить заявку. Попробуйте еще раз.");
        return;
      }
      setRequestModalCar(null);
      window.alert(
        "Заявка отправлена. Статус и расчёты дилеров — в профиле, раздел «Мои заявки на расчёт»."
      );
      if (typeof window !== "undefined") {
        window.dispatchEvent(new Event("avt-requests-updated"));
      }
    } finally {
      setRequestModalBusy(false);
    }
  }

  function logout() {
    clearToken();
    setToken("");
    setMe(null);
  }

  async function loadMe(accessToken) {
    const currentToken = accessToken || token;
    if (!currentToken) return;
    const res = await fetch(`${API_URL}/auth/me`, {
      headers: { Authorization: `Bearer ${currentToken}` },
    });
    if (!res.ok) return;
    const data = await res.json();
    setMe(data);

    if (isStaffRole(data.role)) {
      await loadLatestParserJob(currentToken);
      await loadWhitelistCatalog(currentToken);
    } else {
      setLatestParserJob(null);
      setWhitelistCatalog([]);
    }

  }

  async function loadWhitelistCatalog(accessToken) {
    const currentToken = accessToken || token;
    if (!currentToken) return;
    const res = await fetch(`${API_URL}/admin/model-whitelist`, {
      headers: { Authorization: `Bearer ${currentToken}` },
    });
    if (!res.ok) return;
    const data = await res.json();
    setWhitelistCatalog(data || []);
    const draft = {};
    (data || []).forEach((r) => {
      draft[r.model_id] = r.che168_url || "";
    });
    setCatalogUrlDrafts(draft);
  }

  async function saveCatalogUrl(modelId) {
    if (!token) return;
    const che168_url = (catalogUrlDrafts[modelId] || "").trim() || null;
    const res = await fetch(`${API_URL}/admin/car-models/${modelId}/catalog`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ che168_url }),
    });
    if (!res.ok) {
      alert("Не удалось сохранить URL каталога.");
      return;
    }
    await loadWhitelistCatalog(token);
  }

  async function saveParserModelWhitelist(modelId, enabled) {
    if (!token || modelId == null) return;
    const res = await fetch(`${API_URL}/admin/model-whitelist`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify([{ model_id: modelId, enabled }]),
    });
    if (!res.ok) {
      alert("Не удалось обновить whitelist для модели.");
      return;
    }
    await loadWhitelistCatalog(token);
  }

  async function loadLatestParserJob(accessToken) {
    const currentToken = accessToken || token;
    if (!currentToken) return;
    const res = await fetch(`${API_URL}/admin/parser/latest`, {
      headers: { Authorization: `Bearer ${currentToken}` },
    });
    if (!res.ok) return;
    const data = await res.json();
    setLatestParserJob(data);
  }

  async function loadParserJobById(jobId, accessToken) {
    const currentToken = accessToken || token;
    if (!currentToken || !jobId) return null;
    const res = await fetch(`${API_URL}/admin/parser/jobs/${jobId}`, {
      headers: { Authorization: `Bearer ${currentToken}` },
    });
    if (!res.ok) return null;
    return res.json();
  }

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const stored = localStorage.getItem("avt_token");
      if (stored) {
        setToken(stored);
        await loadMe(stored);
      }
      if (!cancelled) setProfileReady(true);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    (async () => {
      const res = await fetch(`${API_URL}/catalog/brands`);
      if (res.ok) setCatalogBrands(await res.json());
    })();
  }, []);

  useEffect(() => {
    if (!selectedBrandId) {
      setCatalogModels([]);
      return;
    }
    (async () => {
      const res = await fetch(`${API_URL}/catalog/models?brand_id=${selectedBrandId}`);
      if (res.ok) {
        const list = await res.json();
        list.sort(
          (a, b) =>
            b.listings_count - a.listings_count || a.name.localeCompare(b.name, "ru")
        );
        setCatalogModels(list);
      }
    })();
  }, [selectedBrandId]);

  useEffect(() => {
    if (parserAdminModelId != null && !whitelistCatalog.some((r) => r.model_id === parserAdminModelId)) {
      setParserAdminModelId(null);
    }
  }, [whitelistCatalog, parserAdminModelId]);

  useEffect(() => {
    if (!parserAdminBrand) return;
    if (!parserAdminBrandNames.includes(parserAdminBrand)) {
      setParserAdminBrand("");
      setParserAdminModelId(null);
    }
  }, [whitelistCatalog, parserAdminBrand, parserAdminBrandNames]);

  useEffect(() => {
    if (!router.isReady) return;
    const rawB = router.query.brand;
    const rawM = router.query.model;
    const rawQ = router.query.q;
    const brand = Array.isArray(rawB) ? rawB[0] : rawB;
    const model = Array.isArray(rawM) ? rawM[0] : rawM;
    const qq = Array.isArray(rawQ) ? rawQ[0] : rawQ;
    if (brand) {
      const n = Number(brand);
      if (!Number.isNaN(n)) setSelectedBrandId(n);
    } else {
      setSelectedBrandId(null);
    }
    if (model) {
      const n = Number(model);
      if (!Number.isNaN(n)) setSelectedModelId(n);
    } else {
      setSelectedModelId(null);
    }
    if (qq != null && String(qq) !== "") setQ(String(qq));
  }, [router.isReady, router.query.brand, router.query.model, router.query.q]);

  useEffect(() => {
    loadCars();
  }, [loadCars]);

  useEffect(() => {
    if (!token || !latestParserJob?.id) return;
    const s = latestParserJob.status;
    if (s !== "queued" && s !== "running") return;
    const id = latestParserJob.id;
    const tick = async () => {
      const job = await loadParserJobById(id, token);
      if (!job) return;
      setLatestParserJob(job);
      if (job.status === "success" || job.status === "failed") {
        setParserJobMessage(
          job.status === "success"
            ? "Парсер завершил работу. Каталог обновлён."
            : `Парсер завершился с ошибкой: ${job.message || "см. логи"}`
        );
        loadCars();
      }
    };
    tick();
    const t = setInterval(tick, 1500);
    return () => clearInterval(t);
  }, [token, latestParserJob?.id, latestParserJob?.status]);

  return (
    <div className="layout">
      <header className="site-header">
        <div className="container site-header__inner">
          <div className="site-header__brand">
            <Link href="/" className="site-logo">
              avtovozom
            </Link>
            <span className="site-brand-divider" aria-hidden="true" />
            <span className="site-tagline">Каталог и подбор автомобилей из Китая</span>
          </div>
          <div className="auth-bar">
            {!token ? (
              <button type="button" className="btn btn-primary btn-sm" onClick={() => router.push("/auth")}>
                Войти
              </button>
            ) : (
              <>
                <HeaderMessagesLink token={token} />
                {canCreateListings(me?.role) && (
                  <Link href="/staff/new-listing" className="btn btn-primary btn-sm">
                    Добавить объявление
                  </Link>
                )}
                <HeaderProfileLink token={token} userRole={me?.role} />
                <button type="button" className="btn btn-ghost btn-sm" onClick={logout}>
                  Выйти
                </button>
              </>
            )}
          </div>
        </div>
      </header>

      <main className="site-main">
        <div className="container">
          <section className="home-hero" aria-label="Поиск и выбор марки">
            <h1 className="home-hero__title">Подобрать автомобиль</h1>
            <form className="home-search-form" onSubmit={onSearchSubmit} role="search">
              <input
                className="input"
                name="q"
                placeholder="Марка, модель или название объявления"
                value={q}
                onChange={(e) => setQ(e.target.value)}
                autoComplete="off"
                aria-label="Поиск по каталогу"
              />
              <button type="submit" className="btn btn-primary">
                Найти
              </button>
            </form>

            <div className="catalog-picker">
              <h2 className="catalog-picker__section-title">Марки</h2>
              {selectedBrandId || selectedModelId ? (
                <div className="catalog-breadcrumb">
                  <button type="button" onClick={clearBrandModel}>
                    Все марки
                  </button>
                  {selectedBrandId ? (
                    <>
                      <span aria-hidden>·</span>
                      <span>
                        {catalogBrands.find((b) => b.id === selectedBrandId)?.name || "Марка"}
                      </span>
                    </>
                  ) : null}
                  {selectedModelId ? (
                    <>
                      <span aria-hidden>·</span>
                      <span>
                        {catalogModels.find((m) => m.id === selectedModelId)?.name || "Модель"}
                      </span>
                    </>
                  ) : null}
                </div>
              ) : null}
              <div className="brands-compact-grid" role="list">
                {visibleBrands.map((b) => (
                  <button
                    key={b.id}
                    type="button"
                    role="listitem"
                    className={`brands-compact-item${selectedBrandId === b.id ? " brands-compact-item--active" : ""}`}
                    onClick={() => onSelectBrand(b.id)}
                  >
                    <span className="brands-compact-item__name">{b.name}</span>
                    <span className="brands-compact-item__count">
                      {b.listings_count > 0 ? b.listings_count : "—"}
                    </span>
                  </button>
                ))}
              </div>
              {sortedBrands.length > BRANDS_COLLAPSED ? (
                <button
                  type="button"
                  className="brands-compact-more"
                  onClick={() => setBrandsExpanded((v) => !v)}
                >
                  {brandsExpanded ? "Свернуть" : "Все марки"}
                  <span className="brands-compact-more__chev" aria-hidden>
                    {brandsExpanded ? "▴" : "▾"}
                  </span>
                </button>
              ) : null}
              {selectedBrandId ? (
                <div style={{ marginTop: "1rem" }}>
                  <h2 className="catalog-picker__section-title" style={{ marginBottom: "0.5rem" }}>
                    Модели · {catalogBrands.find((x) => x.id === selectedBrandId)?.name}
                  </h2>
                  <div className="models-strip" role="list">
                    {catalogModels.map((m) => (
                      <button
                        key={m.id}
                        type="button"
                        role="listitem"
                        className={`model-chip${selectedModelId === m.id ? " model-chip--active" : ""}`}
                        onClick={() => onSelectModel(m.id)}
                      >
                        {m.name}
                        {m.listings_count > 0 ? (
                          <span className="model-chip__badge">{m.listings_count}</span>
                        ) : null}
                      </button>
                    ))}
                  </div>
                </div>
              ) : null}
            </div>
          </section>

          <div className="toolbar toolbar--below-hero">
            {token && isStaffRole(me?.role) && (
              <button type="button" className="btn btn-secondary" onClick={runParser}>
                Обновить каталог (парсер)
              </button>
            )}
          </div>

          <h2 className="section-title section-title--flush-top">
            Объявления{" "}
            <span className="text-muted">
              · {total}{" "}
              {selectedBrandId || selectedModelId || q.trim()
                ? "по выбранным условиям"
                : "в каталоге"}
            </span>
          </h2>

      {profileReady && isStaffRole(me?.role) && (
        <div className="alert alert--success">
          <b>Режим администратора:</b> у каждой карточки ниже есть кнопка «Удалить это объявление» — она
          скрывает объявление из каталога.
        </div>
      )}

      {token && isStaffRole(me?.role) && whitelistCatalog.length > 0 && (
        <section className="panel admin-parser-panel">
          <h2 className="section-title panel-heading-sm">Каталог парсера (админ)</h2>
          <p className="admin-parser-intro">
            Выберите марку и модель, включите <b>«Участвует в парсинге»</b>, затем вставьте URL: можно
            страницу <b>серии</b> (список объявлений) или прямую ссылку на <b>одно объявление</b>{" "}
            <code>…/dealer/…/….html</code>. Без галочки whitelist парсер модель не обрабатывает. За один
            запуск — до <b>5 новых</b> карточек, которых ещё нет в базе. Обновление витрины — кнопкой
            «Обновить каталог (парсер)» выше.
          </p>
          <p className="admin-parser-meta-line">
            В справочнике <b>{whitelistCatalog.length}</b> моделей ·{" "}
            <b>{parserAdminBrandNames.length}</b> марок
          </p>
          <div className="admin-parser-picker">
            <label className="admin-parser-label">
              <span className="admin-parser-label__text">1. Марка</span>
              <select
                className="input"
                style={{ width: "100%" }}
                value={parserAdminBrand}
                onChange={(e) => {
                  setParserAdminBrand(e.target.value);
                  setParserAdminModelId(null);
                }}
              >
                <option value="">— Выберите марку —</option>
                {parserAdminBrandNames.map((name) => (
                  <option key={name} value={name}>
                    {name}
                  </option>
                ))}
              </select>
            </label>
            <label className="admin-parser-label">
              <span className="admin-parser-label__text">2. Модель</span>
              <select
                className="input"
                style={{ width: "100%" }}
                disabled={!parserAdminBrand}
                value={parserAdminModelId ?? ""}
                onChange={(e) => {
                  const v = e.target.value;
                  setParserAdminModelId(v ? Number(v) : null);
                }}
              >
                <option value="">
                  {parserAdminBrand ? "— Выберите модель —" : "Сначала выберите марку"}
                </option>
                {parserAdminModelsInBrand.map((row) => (
                  <option key={row.model_id} value={row.model_id}>
                    {row.model}
                    {row.enabled ? " · парсер" : ""}
                    {row.che168_url || catalogUrlDrafts[row.model_id] ? " · URL" : ""}
                  </option>
                ))}
              </select>
            </label>
            {parserAdminSelectedRow ? (
              <>
                <label className="admin-parser-check">
                  <input
                    type="checkbox"
                    checked={parserAdminSelectedRow.enabled}
                    onChange={(e) =>
                      saveParserModelWhitelist(parserAdminSelectedRow.model_id, e.target.checked)
                    }
                  />
                  <span>
                    Участвует в парсинге (whitelist)
                    {!parserAdminSelectedRow.enabled ? (
                      <span className="admin-parser-muted"> — пока выключено, парсер эту модель пропустит</span>
                    ) : null}
                  </span>
                </label>
                <label className="admin-parser-label">
                  <span className="admin-parser-label__text">3. Ссылка на серию che168</span>
                  <input
                    className="input"
                    type="url"
                    autoComplete="off"
                    placeholder="https://www.che168.com/china/.../..."
                    value={catalogUrlDrafts[parserAdminSelectedRow.model_id] ?? ""}
                    onChange={(e) =>
                      setCatalogUrlDrafts((prev) => ({
                        ...prev,
                        [parserAdminSelectedRow.model_id]: e.target.value,
                      }))
                    }
                  />
                </label>
                <div>
                  <button
                    type="button"
                    className="btn btn-secondary"
                    onClick={() => saveCatalogUrl(parserAdminSelectedRow.model_id)}
                  >
                    Сохранить URL
                  </button>
                </div>
              </>
            ) : parserAdminBrand ? (
              <p className="admin-parser-hint">Выберите модель, чтобы ввести ссылку.</p>
            ) : null}
          </div>
        </section>
      )}

      {latestParserJob && (
        <div className="panel parser-card">
          <p className="parser-job-line">
            <b>Последний запуск парсера:</b> #{latestParserJob.id} ·{" "}
            <span style={{ textTransform: "uppercase" }}>{latestParserJob.status}</span>
            {latestParserJob.message ? <> · {latestParserJob.message}</> : null}
          </p>
          <div className="parser-bar">
            {((latestParserJob.status === "queued" ||
              latestParserJob.status === "running") &&
              (latestParserJob.status === "queued" ||
                (latestParserJob.total_processed ?? 0) === 0)) && (
              <div className="parser-bar__shimmer" />
            )}
            {(latestParserJob.status === "success" ||
              latestParserJob.status === "failed" ||
              (latestParserJob.status === "running" &&
                (latestParserJob.total_processed ?? 0) > 0)) && (
              <div
                className="parser-bar__fill"
                style={{
                  width: `${(() => {
                    const j = latestParserJob;
                    if (j.status === "success") return 100;
                    if (j.status === "failed") return 100;
                    const n = j.total_processed ?? 0;
                    return Math.min(92, 18 + Math.min(74, n * 12));
                  })()}%`,
                  background:
                    latestParserJob.status === "failed"
                      ? "#c62828"
                      : latestParserJob.status === "success"
                        ? "#2e7d32"
                        : "#1976d2",
                }}
              />
            )}
          </div>
          <p className="parser-job-stats">
            Обработано объявлений: <b>{latestParserJob.total_processed ?? 0}</b> · создано:{" "}
            <b>{latestParserJob.total_created ?? 0}</b> · обновлено: <b>{latestParserJob.total_updated ?? 0}</b>
            {(latestParserJob.total_errors ?? 0) > 0 ? (
              <>
                {" "}
                · <span className="parser-job-error">ошибок: {latestParserJob.total_errors}</span>
              </>
            ) : null}
          </p>
          {(latestParserJob.status === "queued" || latestParserJob.status === "running") && (
            <p className="parser-job-note">
              {(latestParserJob.total_processed ?? 0) === 0 && latestParserJob.status === "running"
                ? "Открывается сайт che168 и ищутся ссылки — счётчики обновятся после первой карточки."
                : "Полоса заполняется по числу обработанных объявлений; текст статуса — из сервера."}
            </p>
          )}
        </div>
      )}
      {parserJobMessage && <div className="muted parser-job-message">{parserJobMessage}</div>}

      {(catalogCbr || catalogCbrError) && (
        <p className="muted catalog-cbr-line">
          {catalogCbr ? (
            <>
              Курс ЦБ на {catalogCbr.rate_date}: <b>1 ¥ = {catalogCbr.rub_per_cny.toFixed(2)} ₽</b> · цены в
              каталоге — ориентировочно, «в Китае» в рублях.
            </>
          ) : (
            <>Курс юаня ЦБ сейчас недоступен ({catalogCbrError || "ошибка"}). Показаны только цены в ¥.</>
          )}
        </p>
      )}

      <section className="catalog-section">
        <div className="catalog-grid">
          {cars.map((car) => (
            <article key={car.id} className="catalog-card">
              <Link href={`/cars/${car.id}`} className="catalog-card__main">
                <div className="catalog-card__image-wrap">
                  {car.photos?.[0]?.storage_url ? (
                    <img
                      className="catalog-card__image"
                      src={mediaSrc(car.photos[0].storage_url)}
                      alt=""
                    />
                  ) : (
                    <div className="catalog-card__placeholder">Нет фото</div>
                  )}
                </div>
                <div className="catalog-card__content">
                  <h3 className="catalog-card__title">{car.title}</h3>
                  <p className="catalog-card__meta">
                    <span className="catalog-card__model-line">
                      {car.brand} · <strong>{car.model}</strong>
                    </span>
                    <span className="catalog-card__meta-rest">
                      {" "}
                      · {car.year}
                      {car.engine_volume_cc ? ` · ${car.engine_volume_cc} см³` : ""}
                      {car.horsepower != null && car.horsepower > 0
                        ? ` · ${car.horsepower} л.с.`
                        : ""}
                      {car.fuel_type ? ` · ${car.fuel_type}` : ""}
                    </span>
                  </p>
                  <p className="catalog-card__price">
                    {car.rub_china != null ? (
                      <>
                        <strong className="catalog-price-rub">
                          {Math.round(car.rub_china).toLocaleString("ru-RU")} ₽
                        </strong>
                        <span className="text-muted catalog-price-sub">
                          в Китае по ЦБ · {Math.round(car.price_cny).toLocaleString("ru-RU")} ¥
                        </span>
                      </>
                    ) : (
                      <>
                        {Math.round(car.price_cny).toLocaleString("ru-RU")} ¥
                        <span className="text-muted catalog-price-cny-note">
                          {" "}
                          CNY
                        </span>
                      </>
                    )}
                  </p>
                </div>
              </Link>
              <div className="catalog-card__actions">
                <button
                  type="button"
                  className="btn btn-primary btn-sm"
                  onClick={(e) => {
                    e.preventDefault();
                    openRequestForModal(car);
                  }}
                >
                  Заявка на расчёт
                </button>
                <Link href={`/cars/${car.id}`} className="btn btn-secondary btn-sm">
                  Подробнее
                </Link>
                {profileReady && isStaffRole(me?.role) && (
                  <div className="catalog-card__admin">
                    <span className="catalog-card__admin-label">Администратор</span>
                    <button
                      type="button"
                      className="btn btn-danger btn-sm"
                      onClick={(e) => {
                        e.preventDefault();
                        deleteCar(car.id);
                      }}
                    >
                      Удалить объявление
                    </button>
                  </div>
                )}
              </div>
            </article>
          ))}
        </div>
      </section>

      <RequestConfirmModal
        open={!!requestModalCar}
        onClose={closeRequestModal}
        onConfirm={confirmRequestFromModal}
        busy={requestModalBusy}
        car={requestModalCar}
        comment={requestModalComment}
        onCommentChange={setRequestModalComment}
      />

      {me?.role === "dealer" && (
        <DealerOpenRequests
          token={token}
          onOpenChat={(chatId) => router.push(`/messages?chat=${encodeURIComponent(String(chatId))}`)}
          onChatsUpdated={() => {}}
        />
      )}

        </div>
      </main>
    </div>
  );
}
