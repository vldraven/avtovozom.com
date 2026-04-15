import Head from "next/head";
import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/router";

import CatalogCardImageScrub from "../components/CatalogCardImageScrub";
import CatalogSortDropdown from "../components/CatalogSortDropdown";
import DealerOpenRequests from "../components/DealerOpenRequests";
import SiteSelectDropdown from "../components/SiteSelectDropdown";
import HeaderMessagesLink from "../components/HeaderMessagesLink";
import HeaderProfileLink from "../components/HeaderProfileLink";
import RequestConfirmModal from "../components/RequestConfirmModal";
import { clearToken } from "../lib/auth";
import { publicCarHref } from "../lib/carRoutes";
import { canCreateListings, isStaffRole } from "../lib/roles";
import { absoluteUrl } from "../lib/siteUrl";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

const DEFAULT_REQUEST_COMMENT =
  "Нужен расчёт под ключ до РФ. Прошу уточнить сроки и стоимость доставки.";

function parseImportStepMessage(msg) {
  const m = /^(\d)\/(\d)\s/.exec(msg || "");
  if (!m) return null;
  return { cur: Number(m[1]), total: Number(m[2]) };
}

export default function Home() {
  const router = useRouter();
  const [mobileHeaderMenuOpen, setMobileHeaderMenuOpen] = useState(false);
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
  const [importListingBusy, setImportListingBusy] = useState(false);
  const [listSort, setListSort] = useState("date_desc");
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

  const BRANDS_COLLAPSED_DESKTOP = 30;
  const BRANDS_COLLAPSED_MOBILE = 14;
  const [isMobileBrandsLayout, setIsMobileBrandsLayout] = useState(false);
  useEffect(() => {
    if (typeof window === "undefined") return;
    const mq = window.matchMedia("(max-width: 768px)");
    const apply = () => setIsMobileBrandsLayout(mq.matches);
    apply();
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, []);

  const brandsCollapsedLimit = isMobileBrandsLayout ? BRANDS_COLLAPSED_MOBILE : BRANDS_COLLAPSED_DESKTOP;
  const visibleBrands = brandsExpanded
    ? sortedBrands
    : sortedBrands.slice(0, brandsCollapsedLimit);

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
    if (listSort && listSort !== "date_desc") {
      params.set("sort", listSort);
    }
    try {
      const res = await fetch(`${API_URL}/cars?${params.toString()}`);
      const data = await res.json();
      setCars(data.items || []);
      setTotal(data.total || 0);
      setCatalogCbr(data.cbr || null);
      setCatalogCbrError(data.cbr_error || null);
    } catch {
      setCars([]);
      setTotal(0);
      setCatalogCbr(null);
      setCatalogCbrError("network");
    }
  }, [router.isReady, router.query.brand, router.query.model, router.query.q, listSort]);

  function onSelectBrand(brandId) {
    const row = catalogBrands.find((b) => b.id === brandId);
    if (row?.slug) {
      router.push(`/catalog/${row.slug}`);
      return;
    }
    const qq = q.trim();
    const query = {};
    if (qq) query.q = qq;
    query.brand = String(brandId);
    router.replace({ pathname: "/", query }, undefined, { shallow: true });
  }

  function onSelectModel(modelId) {
    const rawB = router.query.brand;
    const qb = Array.isArray(rawB) ? rawB[0] : rawB;
    const bid = qb || selectedBrandId;
    const brandRow = catalogBrands.find((b) => b.id === Number(bid));
    const modelRow = catalogModels.find((m) => m.id === modelId);
    if (brandRow?.slug && modelRow?.slug) {
      router.push(`/catalog/${brandRow.slug}/${modelRow.slug}`);
      return;
    }
    const qq = q.trim();
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
      const next = publicCarHref(car);
      router.push(`/request-quote?car_id=${car.id}&next=${encodeURIComponent(next)}`);
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
        router.push(
          `/request-quote?car_id=${cid}&next=${encodeURIComponent(publicCarHref(requestModalCar))}`
        );
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
    setMobileHeaderMenuOpen(false);
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

  async function importListingFromChe168() {
    if (!token) {
      alert("Сначала выполните вход");
      return;
    }
    if (parserAdminModelId == null) {
      alert("Выберите марку и модель.");
      return;
    }
    const url = (catalogUrlDrafts[parserAdminModelId] || "").trim();
    if (!url) {
      alert("Вставьте ссылку на объявление на che168.");
      return;
    }
    setImportListingBusy(true);
    setParserJobMessage("");
    try {
      const res = await fetch(`${API_URL}/admin/parser/import-listing`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ model_id: parserAdminModelId, che168_url: url }),
      });
      if (!res.ok) {
        let detail = "Не удалось запустить импорт.";
        try {
          const err = await res.json();
          if (err.detail) {
            detail = Array.isArray(err.detail)
              ? err.detail.map((x) => x.msg || x).join(" ")
              : String(err.detail);
          }
        } catch {
          /* ignore */
        }
        setParserJobMessage(detail);
        return;
      }
      const job = await res.json();
      setLatestParserJob(job);
      setParserJobMessage("Импорт запущен. Статус обновляется автоматически.");
      await loadWhitelistCatalog(token);
    } catch {
      setParserJobMessage("Сбой связи с API. Проверьте, что backend доступен.");
    } finally {
      setImportListingBusy(false);
    }
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
    const rawS = router.query.sort;
    const sv = Array.isArray(rawS) ? rawS[0] : rawS;
    if (sv && ["date_desc", "date_asc", "price_asc", "price_desc"].includes(String(sv))) {
      setListSort(String(sv));
    }
  }, [router.isReady, router.query.brand, router.query.model, router.query.q, router.query.sort]);

  useEffect(() => {
    loadCars();
  }, [loadCars]);

  useEffect(() => {
    setMobileHeaderMenuOpen(false);
  }, [router.asPath]);

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
            ? job.type === "import_one"
              ? `Импорт выполнен: ${job.message || "готово"}`
              : "Парсер завершил работу. Каталог обновлён."
            : `Парсер завершился с ошибкой: ${job.message || "см. логи"}`
        );
        loadCars();
        loadWhitelistCatalog(token);
      }
    };
    tick();
    const t = setInterval(tick, 1500);
    return () => clearInterval(t);
  }, [token, latestParserJob?.id, latestParserJob?.status]);

  return (
    <>
      <Head>
        <title>avtovozom — автомобили из Китая в Россию</title>
        <meta
          name="description"
          content="Каталог автомобилей из Китая: подбор марки и модели, цена в юанях, ориентировочная цена в России, доставка и растаможка."
        />
        <link rel="canonical" href={absoluteUrl("/")} />
        <meta property="og:title" content="avtovozom — автомобили из Китая в Россию" />
        <meta
          property="og:description"
          content="Каталог автомобилей из Китая: подбор марки и модели, цена в юанях, ориентировочная цена в России, доставка и растаможка."
        />
        <meta property="og:url" content={absoluteUrl("/")} />
      </Head>
      <div className="layout">
      <header className="site-header">
        <div className="container site-header__inner">
          <div className="site-header__brand">
            <Link href="/" className="site-logo">
              avtovozom
            </Link>
            <span className="site-tagline">Каталог и подбор автомобилей</span>
          </div>
          <button
            type="button"
            className="site-header__burger"
            aria-label="Открыть меню"
            aria-expanded={mobileHeaderMenuOpen}
            onClick={() => setMobileHeaderMenuOpen((v) => !v)}
          >
            <span className={`site-header__burger-icon${mobileHeaderMenuOpen ? " is-open" : ""}`} aria-hidden>
              <span />
              <span />
              <span />
            </span>
          </button>
          <div className="auth-bar">
            <Link href="/customs-calculator" className="site-header-calc-link">
              Калькулятор растаможки
            </Link>
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
        {mobileHeaderMenuOpen ? (
          <div className="site-header-mobile-menu-wrap">
            <button
              type="button"
              className="site-header-mobile-menu__backdrop"
              aria-label="Закрыть меню"
              onClick={() => setMobileHeaderMenuOpen(false)}
            />
            <div className="container site-header-mobile-menu__container">
              <nav className="site-header-mobile-menu" aria-label="Меню сайта">
                <Link href="/customs-calculator" className="site-header-mobile-menu__link">
                  Калькулятор растаможки
                </Link>
                {!token ? (
                  <Link href="/auth" className="site-header-mobile-menu__link">
                    Войти
                  </Link>
                ) : (
                  <>
                    <Link href="/profile" className="site-header-mobile-menu__link">
                      Профиль
                    </Link>
                    {canCreateListings(me?.role) ? (
                      <Link href="/staff/new-listing" className="site-header-mobile-menu__link">
                        Добавить объявление
                      </Link>
                    ) : null}
                    <button type="button" className="site-header-mobile-menu__link site-header-mobile-menu__btn" onClick={logout}>
                      Выйти
                    </button>
                  </>
                )}
              </nav>
            </div>
          </div>
        ) : null}
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
              {sortedBrands.length > brandsCollapsedLimit ? (
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

          <div className="catalog-list-toolbar">
            <h2 className="section-title section-title--flush-top catalog-list-toolbar__title">
              Объявления <span className="text-muted">· {total}</span>
            </h2>
            <CatalogSortDropdown
              value={listSort}
              onChange={(v) => {
                setListSort(v);
                const q = { ...router.query };
                if (v === "date_desc") {
                  delete q.sort;
                } else {
                  q.sort = v;
                }
                router.replace({ pathname: "/", query: q }, undefined, { shallow: true });
              }}
            />
          </div>

      {profileReady && isStaffRole(me?.role) && (
        <div className="alert alert--success">
          <b>Администратор:</b> у объявлений ниже доступно удаление из каталога.
        </div>
      )}

      {token && isStaffRole(me?.role) && whitelistCatalog.length > 0 && (
        <section className="panel admin-parser-panel">
          <h2 className="section-title panel-heading-sm">Импорт объявления с che168</h2>
          <p className="admin-parser-meta-line">
            В справочнике <b>{whitelistCatalog.length}</b> моделей ·{" "}
            <b>{parserAdminBrandNames.length}</b> марок. Ссылка должна вести на{" "}
            <b>одно объявление</b> (формат <code>…/dealer/…/….html</code> или{" "}
            <code>i.che168.com/car/…</code>). Модель будет включена в автоматический парсинг.
          </p>
          <div className="admin-parser-picker admin-parser-picker--import">
            <div className="admin-parser-label">
              <SiteSelectDropdown
                className="site-dropdown--block"
                label="1. Марка"
                placeholder="— Выберите марку —"
                value={parserAdminBrand}
                searchable
                onChange={(v) => {
                  setParserAdminBrand(v);
                  setParserAdminModelId(null);
                }}
                options={[
                  { value: "", label: "— Выберите марку —" },
                  ...parserAdminBrandNames.map((name) => ({ value: name, label: name })),
                ]}
              />
            </div>
            <div className="admin-parser-label">
              <SiteSelectDropdown
                className="site-dropdown--block"
                label="2. Модель"
                placeholder={
                  parserAdminBrand ? "— Выберите модель —" : "Сначала выберите марку"
                }
                disabled={!parserAdminBrand}
                searchable
                value={parserAdminModelId != null ? String(parserAdminModelId) : ""}
                onChange={(v) => {
                  setParserAdminModelId(v ? Number(v) : null);
                }}
                options={[
                  {
                    value: "",
                    label: parserAdminBrand ? "— Выберите модель —" : "Сначала выберите марку",
                  },
                  ...parserAdminModelsInBrand.map((row) => ({
                    value: String(row.model_id),
                    label: row.model,
                  })),
                ]}
              />
            </div>
            {parserAdminSelectedRow ? (
              <>
                <label className="admin-parser-label">
                  <span className="admin-parser-label__text">3. Ссылка на объявление che168</span>
                  <div className="input-with-clear-wrap">
                    <input
                      className="input input-with-clear"
                      type="url"
                      inputMode="url"
                      autoComplete="off"
                      placeholder="https://www.che168.com/dealer/…/….html"
                      value={catalogUrlDrafts[parserAdminSelectedRow.model_id] ?? ""}
                      onChange={(e) =>
                        setCatalogUrlDrafts((prev) => ({
                          ...prev,
                          [parserAdminSelectedRow.model_id]: e.target.value,
                        }))
                      }
                    />
                    {(catalogUrlDrafts[parserAdminSelectedRow.model_id] || "").trim() ? (
                      <button
                        type="button"
                        className="input-with-clear__btn"
                        title="Очистить ссылку"
                        aria-label="Очистить ссылку"
                        onClick={() =>
                          setCatalogUrlDrafts((prev) => ({
                            ...prev,
                            [parserAdminSelectedRow.model_id]: "",
                          }))
                        }
                      >
                        ×
                      </button>
                    ) : null}
                  </div>
                </label>
                <div className="admin-parser-import-actions">
                  <button
                    type="button"
                    className="btn btn-primary"
                    disabled={importListingBusy}
                    onClick={importListingFromChe168}
                  >
                    {importListingBusy ? "Импорт…" : "Импорт объявления"}
                  </button>
                </div>
              </>
            ) : null}
          </div>
        </section>
      )}

      {latestParserJob && (() => {
        const j = latestParserJob;
        const step = parseImportStepMessage(j.message);
        const running = j.status === "queued" || j.status === "running";
        const fillPct = (() => {
          if (j.status === "success" || j.status === "failed") return 100;
          if (step && running) return Math.min(96, Math.round((step.cur / step.total) * 100));
          const n = j.total_processed ?? 0;
          return Math.min(92, 18 + Math.min(74, n * 12));
        })();
        return (
          <div
            className={`panel parser-card${
              j.status === "success" ? " parser-card--success" : ""
            }${j.status === "failed" ? " parser-card--failed" : ""}${
              j.type === "import_one" && running ? " parser-card--import-running" : ""
            }`}
          >
            <p className="parser-job-line">
              <b>{j.type === "import_one" ? "Импорт объявления" : "Последний запуск парсера"}:</b> #{j.id} ·{" "}
              <span className="parser-job-status">{String(j.status || "").toUpperCase()}</span>
              {step && running ? (
                <span className="parser-job-step">
                  {" "}
                  · шаг {step.cur} из {step.total}
                </span>
              ) : null}
              {j.message ? <> · {j.message}</> : null}
            </p>
            <div className="parser-bar" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={fillPct}>
              {running && (
                <div className="parser-bar__shimmer" aria-hidden />
              )}
              {(j.status === "success" || j.status === "failed" || running) && (
                <div
                  className="parser-bar__fill"
                  style={{
                    width: `${fillPct}%`,
                    background:
                      j.status === "failed"
                        ? "#c62828"
                        : j.status === "success"
                          ? "#2e7d32"
                          : "#1976d2",
                  }}
                />
              )}
            </div>
            {j.status === "success" && j.type === "import_one" ? (
              <p className="parser-card__import-done">Готово: объявление добавлено в каталог (см. сообщение выше).</p>
            ) : null}
            <p className="parser-job-stats">
              Обработано объявлений: <b>{j.total_processed ?? 0}</b> · создано: <b>{j.total_created ?? 0}</b> ·
              обновлено: <b>{j.total_updated ?? 0}</b>
              {(j.total_errors ?? 0) > 0 ? (
                <>
                  {" "}
                  · <span className="parser-job-error">ошибок: {j.total_errors}</span>
                </>
              ) : null}
            </p>
          </div>
        );
      })()}
      {parserJobMessage && <div className="muted parser-job-message">{parserJobMessage}</div>}

      {(catalogCbr || catalogCbrError) && (
        <p className="muted catalog-cbr-line">
          {catalogCbr ? (
            <>
              Курс ЦБ на {catalogCbr.rate_date}: <b>1 ¥ = {catalogCbr.rub_per_cny.toFixed(2)} ₽</b>
            </>
          ) : (
            <>Курс ЦБ недоступен ({catalogCbrError || "ошибка"}).</>
          )}
        </p>
      )}

      <section className="catalog-section">
        <div className="catalog-grid">
          {cars.map((car) => (
            <article key={car.id} className="catalog-card">
              <Link href={publicCarHref(car)} className="catalog-card__main">
                <CatalogCardImageScrub photos={car.photos} />
                <div className="catalog-card__content">
                  <h3 className="catalog-card__title">{car.title}</h3>
                  <p className="catalog-card__meta">
                    <span className="catalog-card__model-line">
                      {car.brand} · <strong>{car.model}</strong>
                      {car.generation ? (
                        <>
                          {" "}
                          · {car.generation}
                        </>
                      ) : null}
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
                    {car.price_breakdown?.total_rub != null ? (
                      <>
                        <strong className="catalog-price-rub">
                          {Math.round(car.price_breakdown.total_rub).toLocaleString("ru-RU")} ₽
                        </strong>
                        <span className="text-muted catalog-price-sub">
                          в России (расчётная)
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
                  Заказать расчёт
                </button>
                <Link href={publicCarHref(car)} className="btn btn-secondary btn-sm">
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
    </>
  );
}
