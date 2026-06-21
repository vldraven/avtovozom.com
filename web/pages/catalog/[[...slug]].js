import Head from "next/head";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/router";

import Breadcrumbs from "../../components/Breadcrumbs";
import CatalogCardMedia from "../../components/CatalogCardMedia";
import CatalogSortDropdown from "../../components/CatalogSortDropdown";
import SiteSelectDropdown from "../../components/SiteSelectDropdown";
import CarDetailView from "../../components/CarDetailView";
import HeaderMessagesLink from "../../components/HeaderMessagesLink";
import HeaderProfileLink from "../../components/HeaderProfileLink";
import HeaderFavoritesLink from "../../components/HeaderFavoritesLink";
import TelegramChannelHeaderLink from "../../components/TelegramChannelHeaderLink";
import RequestConfirmModal from "../../components/RequestConfirmModal";
import { clearToken, getStoredToken } from "../../lib/auth";
import { listingCarHref, publicCarHref } from "../../lib/carRoutes";
import { saveListingReturnPath, markScrollRestoreTarget } from "../../lib/listingNavigation";
import { canCreateListings } from "../../lib/roles";
import {
  buildCatalogCarsQuery,
  catalogFetchKey,
  isCarDetailSegments,
  resolveCatalogTree,
  segmentsFromSlugParam,
} from "../../lib/catalogResolve";
import {
  catalogBreadcrumbItems,
  catalogCanonicalPath,
  catalogSeoCopy,
} from "../../lib/catalogSeo";
import { breadcrumbListJsonLd, jsonLdScriptProps } from "../../lib/schema";
import { scheduleListScrollRestore } from "../../lib/listScrollRestore";
import { absoluteUrl } from "../../lib/siteUrl";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";
const CATALOG_BRANDS_COLLAPSED_LIMIT = 12;

const DEFAULT_REQUEST_COMMENT =
  "Нужен расчёт под ключ до РФ. Прошу уточнить сроки и стоимость доставки.";
const CATALOG_SCROLL_STORAGE_PREFIX = "avt_catalog_scroll:";

export default function CatalogTreePage({ initialPayload = null }) {
  const router = useRouter();
  const lastExplicitScrollSaveRef = useRef({ path: "", at: 0 });
  const listInitial = initialPayload?.mode === "list" ? initialPayload : null;
  const skipCarsFetchKeyRef = useRef(listInitial?.fetchKey ?? null);
  const skipTreeLoadRef = useRef(Boolean(listInitial?.tree?.length));

  /* Без useMemo сегменты — новый массив на каждом рендере, и useEffect с fetch(/cars) зацикливается. */
  const segments = useMemo(() => {
    if (router.isReady) return segmentsFromSlugParam(router.query.slug);
    if (initialPayload?.segments != null) return initialPayload.segments;
    return null;
  }, [router.isReady, router.query.slug, initialPayload]);

  const ssrReady = Boolean(initialPayload) || router.isReady;

  const [tree, setTree] = useState(listInitial?.tree ?? []);
  const [cars, setCars] = useState(listInitial?.cars ?? []);
  const [total, setTotal] = useState(listInitial?.total ?? 0);
  const [token, setToken] = useState("");
  const [me, setMe] = useState(null);
  const [treeError, setTreeError] = useState(null);
  const [carsError, setCarsError] = useState(null);
  const [listSort, setListSort] = useState(listInitial?.listSort ?? "date_desc");
  const [brandsExpanded, setBrandsExpanded] = useState(false);
  const [requestModalCar, setRequestModalCar] = useState(null);
  const [requestModalComment, setRequestModalComment] = useState("");
  const [requestModalBusy, setRequestModalBusy] = useState(false);

  const { brand, model, generation, unknownSlug, badModelSlug, badGenSlug } = useMemo(() => {
    if (segments == null) {
      return {
        brand: null,
        model: null,
        generation: null,
        unknownSlug: false,
        badModelSlug: false,
        badGenSlug: false,
      };
    }
    return resolveCatalogTree(segments, tree);
  }, [segments, tree]);

  const isBrandFocus = Boolean(brand && !unknownSlug);
  const visibleTree = brandsExpanded
    ? tree
    : tree.slice(0, CATALOG_BRANDS_COLLAPSED_LIMIT);
  const hiddenBrandsCount = Math.max(0, tree.length - CATALOG_BRANDS_COLLAPSED_LIMIT);
  const isCarDetailRoute =
    initialPayload?.mode === "detail" ||
    (segments != null && isCarDetailSegments(segments));
  const isCatalogListRoute = segments != null && !isCarDetailRoute && !unknownSlug;

  useEffect(() => {
    if (!initialPayload) return;
    if (initialPayload.mode === "list") {
      setTree(initialPayload.tree ?? []);
      setCars(initialPayload.cars ?? []);
      setTotal(initialPayload.total ?? 0);
      setListSort(initialPayload.listSort ?? "date_desc");
      skipCarsFetchKeyRef.current = initialPayload.fetchKey ?? null;
      skipTreeLoadRef.current = Boolean(initialPayload.tree?.length);
    }
  }, [initialPayload]);

  const loadTree = useCallback(async () => {
    setTreeError(null);
    try {
      const res = await fetch(`${API_URL}/catalog/tree`);
      if (!res.ok) {
        setTreeError(
          `Каталог не отвечает (${res.status}). Убедитесь, что backend запущен: ${API_URL}`
        );
        setTree([]);
        return;
      }
      setTree(await res.json());
    } catch {
      setTreeError(
        `Нет связи с API (${API_URL}). Запустите backend (docker compose / uvicorn) и проверьте адрес в NEXT_PUBLIC_API_URL.`
      );
      setTree([]);
    }
  }, []);

  useEffect(() => {
    if (skipTreeLoadRef.current) {
      skipTreeLoadRef.current = false;
      return;
    }
    loadTree();
  }, [loadTree]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const stored = getStoredToken();
      if (stored) {
        setToken(stored);
        try {
          const res = await fetch(`${API_URL}/auth/me`, {
            headers: { Authorization: `Bearer ${stored}` },
          });
          if (!cancelled && res.ok) setMe(await res.json());
        } catch {
          /* API недоступен — не падаем красным экраном Next */
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

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

  const writeCatalogScrollPosition = useCallback((path, carId = null, cardTop = null) => {
    if (typeof window === "undefined" || !path) return;
    const storageKey = `${CATALOG_SCROLL_STORAGE_PREFIX}${path}`;
    sessionStorage.setItem(
      storageKey,
      JSON.stringify({
        y: window.scrollY,
        carId,
        cardTop,
        savedAt: Date.now(),
      })
    );
  }, []);

  const saveCatalogScrollPosition = useCallback(
    (event, carId) => {
      if (typeof window === "undefined" || !router.asPath || !isCatalogListRoute) return;
      if (
        (event?.button != null && event.button !== 0) ||
        event?.metaKey ||
        event?.ctrlKey ||
        event?.shiftKey ||
        event?.altKey ||
        event?.defaultPrevented
      ) {
        return;
      }

      const card = event.currentTarget?.closest?.("[data-catalog-car-id]");
      const rect = card?.getBoundingClientRect?.();
      saveListingReturnPath(router.asPath);
      markScrollRestoreTarget(router.asPath);
      writeCatalogScrollPosition(router.asPath, carId, rect ? rect.top : null);
      lastExplicitScrollSaveRef.current = { path: router.asPath, at: Date.now() };
    },
    [isCatalogListRoute, router.asPath, writeCatalogScrollPosition]
  );

  useEffect(() => {
    if (typeof window === "undefined" || !("scrollRestoration" in window.history)) return;
    const previous = window.history.scrollRestoration;
    window.history.scrollRestoration = "manual";
    return () => {
      window.history.scrollRestoration = previous;
    };
  }, []);

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
        const carRef = requestModalCar;
        clearToken();
        setToken("");
        setMe(null);
        setRequestModalCar(null);
        router.push(
          `/request-quote?car_id=${carRef.id}&next=${encodeURIComponent(publicCarHref(carRef))}`
        );
        return;
      }
      if (!res.ok) {
        window.alert("Не удалось отправить заявку. Попробуйте ещё раз.");
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

  useEffect(() => {
    if (!ssrReady || segments == null) return;
    if (unknownSlug) {
      setCars([]);
      setTotal(0);
      return;
    }
    const fetchKey = catalogFetchKey(segments, listSort);
    if (skipCarsFetchKeyRef.current === fetchKey) {
      skipCarsFetchKeyRef.current = null;
      const initialCars = listInitial?.cars?.length ?? 0;
      const initialTotal = listInitial?.total ?? 0;
      if (initialTotal > 0 && initialCars >= initialTotal) {
        return;
      }
    }
    const resolved = resolveCatalogTree(segments, tree);
    const params = buildCatalogCarsQuery(resolved, listSort);
    if (!params) return;
    let cancelled = false;
    (async () => {
      setCarsError(null);
      try {
        const res = await fetch(`${API_URL}/cars?${params.toString()}`);
        if (!res.ok) {
          if (!cancelled) {
            setCars([]);
            setTotal(0);
            setCarsError(`Не удалось загрузить объявления (${res.status}).`);
          }
          return;
        }
        const data = await res.json();
        if (!cancelled) {
          setCars(data.items || []);
          setTotal(data.total || 0);
        }
      } catch {
        if (!cancelled) {
          setCars([]);
          setTotal(0);
          setCarsError("Нет связи с API при загрузке объявлений.");
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [ssrReady, segments, tree, unknownSlug, listSort, listInitial?.cars?.length, listInitial?.total]);

  useEffect(() => {
    if (!router.isReady) return;
    const rawS = router.query.sort;
    const sv = Array.isArray(rawS) ? rawS[0] : rawS;
    if (sv && ["date_desc", "date_asc", "price_asc", "price_desc"].includes(String(sv))) {
      setListSort(String(sv));
    }
  }, [router.isReady, router.query.sort]);

  const scrollRestorePathRef = useRef("");

  const tryRestoreCatalogScroll = useCallback(() => {
    if (
      typeof window === "undefined" ||
      !router.isReady ||
      segments == null ||
      !isCatalogListRoute ||
      cars.length === 0
    ) {
      return () => {};
    }
    if (scrollRestorePathRef.current === router.asPath) {
      return () => {};
    }
    scrollRestorePathRef.current = router.asPath;
    return scheduleListScrollRestore({
      storagePrefix: CATALOG_SCROLL_STORAGE_PREFIX,
      path: router.asPath,
      cardDataAttr: "data-catalog-car-id",
    });
  }, [router.isReady, router.asPath, segments, isCatalogListRoute, cars.length]);

  useEffect(() => {
    scrollRestorePathRef.current = "";
    return tryRestoreCatalogScroll();
  }, [tryRestoreCatalogScroll]);

  const breadcrumbItems = useMemo(
    () => catalogBreadcrumbItems({ brand, model, generation }),
    [brand, model, generation]
  );

  const catalogCanon = useMemo(() => catalogCanonicalPath(segments), [segments]);

  const catalogSeo = useMemo(
    () => catalogSeoCopy({ unknownSlug, brand, model, generation }),
    [unknownSlug, brand, model, generation]
  );

  const catalogBreadcrumbLd = useMemo(
    () => breadcrumbListJsonLd(breadcrumbItems),
    [breadcrumbItems]
  );

  if (!ssrReady) {
    return (
      <div className="layout">
        <main className="site-main">
          <div className="container">
            <p className="muted">Загрузка…</p>
          </div>
        </main>
      </div>
    );
  }

  if (isCarDetailRoute) {
    const detailCarId =
      initialPayload?.mode === "detail" ? initialPayload.carId : String(segments[2]);
    return (
      <CarDetailView
        carId={detailCarId}
        pathBrandSlug={segments?.[0] ?? initialPayload?.pathBrandSlug ?? null}
        pathModelSlug={segments?.[1] ?? initialPayload?.pathModelSlug ?? null}
        initialCar={initialPayload?.mode === "detail" ? initialPayload.initialCar ?? null : null}
      />
    );
  }

  return (
    <div className="layout">
      <Head>
        <title>{catalogSeo.title}</title>
        <meta name="description" content={catalogSeo.desc} />
        <link rel="canonical" href={absoluteUrl(catalogCanon)} />
        <meta property="og:title" content={catalogSeo.title} />
        <meta property="og:description" content={catalogSeo.desc} />
        <meta property="og:url" content={absoluteUrl(catalogCanon)} />
        {catalogBreadcrumbLd ? <script {...jsonLdScriptProps(catalogBreadcrumbLd)} /> : null}
      </Head>
      <header className="site-header">
        <div className="container site-header__inner">
          <div className="site-header__brand">
            <Link href="/" className="site-logo">
              avtovozom
            </Link>
            <span className="site-tagline">Доставка автомобилей из Китая и Кореи</span>
          </div>
          <div className="auth-bar">
            {!token ? (
              <>
                <button type="button" className="btn btn-primary btn-sm" onClick={() => router.push("/auth")}>
                  Войти
                </button>
                <TelegramChannelHeaderLink />
              </>
            ) : (
              <>
                <HeaderMessagesLink token={token} />
                {canCreateListings(me?.role) && (
                  <Link href="/staff/new-listing" className="btn btn-primary btn-sm">
                    Добавить объявление
                  </Link>
                )}
                <HeaderProfileLink token={token} userRole={me?.role} />
                <HeaderFavoritesLink token={token} />
                <TelegramChannelHeaderLink />
              </>
            )}
          </div>
        </div>
      </header>

      <main className="site-main">
        <div className="container">
          <Breadcrumbs items={breadcrumbItems} />

          {treeError ? (
            <div className="alert alert--danger" style={{ marginBottom: "1rem" }}>
              <strong>Ошибка загрузки каталога.</strong> {treeError}
              <div style={{ marginTop: "0.75rem" }}>
                <button type="button" className="btn btn-secondary btn-sm" onClick={() => loadTree()}>
                  Повторить
                </button>
              </div>
            </div>
          ) : null}

          {unknownSlug ? (
            <div className="panel" style={{ padding: "1.25rem" }}>
              <h1 className="section-title" style={{ marginTop: 0 }}>
                Раздел не найден
              </h1>
              <p className="muted">
                Проверьте адрес или выберите марку и модель в дереве каталога слева.
              </p>
              <Link href="/catalog" className="btn btn-primary" style={{ marginTop: "0.75rem" }}>
                Весь каталог
              </Link>
            </div>
          ) : (
            <>
              <h1 className="home-hero__title" style={{ marginBottom: "0.35rem" }}>
                {generation
                  ? `${brand.name} · ${model.name} · ${generation.name}`
                  : model
                    ? `${brand.name} · ${model.name}`
                    : brand
                      ? brand.name
                      : "Каталог автомобилей"}
              </h1>

              {badModelSlug ? (
                <div className="alert alert--warn" style={{ marginBottom: "1rem" }}>
                  Такой модели в каталоге нет — показаны объявления по марке «{brand.name}».
                </div>
              ) : null}

              {badGenSlug ? (
                <div className="alert alert--warn" style={{ marginBottom: "1rem" }}>
                  Такого поколения в справочнике нет — показаны все объявления по модели «{model.name}».
                </div>
              ) : null}

              <div className={`catalog-layout${isBrandFocus ? " catalog-layout--brand-focus" : ""}`}>
                <aside
                  className={`catalog-tree-panel${isBrandFocus ? " catalog-tree-panel--focused" : ""}`}
                  aria-label={isBrandFocus ? `Модели марки ${brand.name}` : "Дерево каталога"}
                >
                  {isBrandFocus ? (
                    <>
                      <Link href="/catalog" className="catalog-tree-back-link">
                        ← Все марки
                      </Link>
                      <h2 className="catalog-tree-panel__title">Модели</h2>
                      <p className="catalog-tree-focused-brand">{brand.name}</p>
                      {model && !badModelSlug ? (
                        <>
                          <div className="catalog-tree-field">
                            <SiteSelectDropdown
                              className="site-dropdown--block"
                              label="Модель"
                              placeholder="Все модели марки"
                              searchable
                              value={String(model.id)}
                              onChange={(v) => {
                                if (v === "") {
                                  router.push(`/catalog/${brand.slug}`);
                                  return;
                                }
                                const m = brand.models.find((x) => String(x.id) === v);
                                if (m) router.push(`/catalog/${brand.slug}/${m.slug}`);
                              }}
                              ariaLabel="Выбор модели"
                              options={[
                                { value: "", label: "Все модели марки" },
                                ...brand.models.map((m) => ({
                                  value: String(m.id),
                                  label: `${m.name}${m.listings_count > 0 ? ` · ${m.listings_count}` : ""}`,
                                })),
                              ]}
                            />
                          </div>
                          {(model.generations || []).length > 0 ? (
                            <div className="catalog-tree-generation-step">
                              <div className="catalog-tree-field catalog-tree-field--tight">
                                <SiteSelectDropdown
                                  className="site-dropdown--block"
                                  label="Поколение"
                                  placeholder="Все поколения"
                                  searchable
                                  value={generation ? String(generation.id) : ""}
                                  onChange={(v) => {
                                    if (v === "") {
                                      router.push(`/catalog/${brand.slug}/${model.slug}`);
                                      return;
                                    }
                                    const g = (model.generations || []).find(
                                      (x) => String(x.id) === v
                                    );
                                    if (g) {
                                      router.push(
                                        `/catalog/${brand.slug}/${model.slug}/${g.slug}`
                                      );
                                    }
                                  }}
                                  ariaLabel="Выбор поколения"
                                  options={[
                                    { value: "", label: "Все поколения" },
                                    ...(model.generations || []).map((g) => ({
                                      value: String(g.id),
                                      label: `${g.name}${g.listings_count > 0 ? ` · ${g.listings_count}` : ""}`,
                                    })),
                                  ]}
                                />
                              </div>
                            </div>
                          ) : null}
                        </>
                      ) : (
                        <div className="catalog-tree-field">
                          <SiteSelectDropdown
                            className="site-dropdown--block"
                            label="Модель"
                            placeholder="Все модели марки"
                            searchable
                            value=""
                            onChange={(v) => {
                              if (v === "") return;
                              const m = brand.models.find((x) => String(x.id) === v);
                              if (m) router.push(`/catalog/${brand.slug}/${m.slug}`);
                            }}
                            ariaLabel="Выбор модели марки"
                            options={[
                              { value: "", label: "Все модели марки" },
                              ...brand.models.map((m) => ({
                                value: String(m.id),
                                label: `${m.name}${m.listings_count > 0 ? ` · ${m.listings_count}` : ""}`,
                              })),
                            ]}
                          />
                        </div>
                      )}
                    </>
                  ) : (
                    <>
                      <h2 className="catalog-tree-panel__title">Марки и модели</h2>
                      {visibleTree.map((b) => (
                        <details
                          key={b.id}
                          className="catalog-tree-brand"
                          open={brand?.id === b.id}
                        >
                          <summary className="catalog-tree-brand__summary">
                            <span className="catalog-tree-brand__name">{b.name}</span>
                            <span className="catalog-tree-brand__count">{b.listings_count || "—"}</span>
                          </summary>
                          <ul className="catalog-tree-models">
                            <li>
                              <Link
                                href={`/catalog/${b.slug}`}
                                className={`catalog-tree-model-link${
                                  brand?.id === b.id && !model ? " catalog-tree-model-link--active" : ""
                                }`}
                              >
                                <span>Все модели марки</span>
                                <span className="catalog-tree-model-link__count">
                                  {b.listings_count || "—"}
                                </span>
                              </Link>
                            </li>
                            {b.models.map((m) => (
                              <li key={m.id}>
                                <Link
                                  href={`/catalog/${b.slug}/${m.slug}`}
                                  className={`catalog-tree-model-link${
                                    model?.id === m.id && !generation ? " catalog-tree-model-link--active" : ""
                                  }`}
                                >
                                  <span>{m.name}</span>
                                  <span className="catalog-tree-model-link__count">
                                    {m.listings_count > 0 ? m.listings_count : "—"}
                                  </span>
                                </Link>
                                {(m.generations || []).length > 0 ? (
                                  <ul className="catalog-tree-generations">
                                    {(m.generations || []).map((g) => (
                                      <li key={g.id}>
                                        <Link
                                          href={`/catalog/${b.slug}/${m.slug}/${g.slug}`}
                                          className={`catalog-tree-generation-link${
                                            model?.id === m.id && generation?.id === g.id
                                              ? " catalog-tree-generation-link--active"
                                              : ""
                                          }`}
                                        >
                                          <span>{g.name}</span>
                                          <span className="catalog-tree-model-link__count">
                                            {g.listings_count > 0 ? g.listings_count : "—"}
                                          </span>
                                        </Link>
                                      </li>
                                    ))}
                                  </ul>
                                ) : null}
                              </li>
                            ))}
                          </ul>
                        </details>
                      ))}
                      {hiddenBrandsCount > 0 ? (
                        <button
                          type="button"
                          className="catalog-tree-more"
                          onClick={() => setBrandsExpanded((v) => !v)}
                          aria-expanded={brandsExpanded}
                        >
                          {brandsExpanded ? "Свернуть марки" : `Показать ещё ${hiddenBrandsCount}`}
                          <span className="catalog-tree-more__chev" aria-hidden>
                            {brandsExpanded ? "▴" : "▾"}
                          </span>
                        </button>
                      ) : null}
                    </>
                  )}
                </aside>

                <div className="catalog-main-panel">
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
                        router.replace({ pathname: router.pathname, query: q }, undefined, { shallow: true });
                      }}
                    />
                  </div>

                  {carsError ? (
                    <div className="alert alert--warn" style={{ marginBottom: "1rem" }}>
                      {carsError}
                    </div>
                  ) : null}

                  <section className="catalog-section">
                    <div className="catalog-grid">
                      {cars.map((car) => {
                        const totalRub =
                          car.price_breakdown?.total_rub != null
                            ? car.price_breakdown.total_rub
                            : car.estimated_total_rub != null
                              ? car.estimated_total_rub
                              : null;
                        return (
                        <article
                          key={car.id}
                          className="catalog-card"
                          data-catalog-car-id={car.id}
                        >
                          <Link
                            href={listingCarHref(car)}
                            className="catalog-card__main"
                            onClickCapture={(e) => saveCatalogScrollPosition(e, car.id)}
                          >
                            <CatalogCardMedia photos={car.photos} carId={car.id} car={car} />
                            <div className="catalog-card__content">
                              <h3 className="catalog-card__title">{car.title}</h3>
                              <p className="catalog-card__meta">
                                <span className="catalog-card__model-line">
                                  {car.brand} · <strong>{car.model}</strong>
                                  {car.generation ? (
                                    <>
                                      {" "}
                                      · <span className="catalog-card__generation">{car.generation}</span>
                                    </>
                                  ) : null}
                                </span>
                                <span className="catalog-card__meta-rest">
                                  {" "}
                                  · {car.year}
                                  {car.mileage_km != null
                                    ? ` · ${Number(car.mileage_km).toLocaleString("ru-RU")} км`
                                    : ""}
                                </span>
                              </p>
                              <p className="catalog-card__price">
                                {totalRub != null ? (
                                  <>
                                    <strong className="catalog-price-rub">
                                      {Math.round(totalRub).toLocaleString("ru-RU")} ₽
                                    </strong>
                                    <span className="text-muted catalog-price-sub">
                                      в России (расчётная)
                                    </span>
                                  </>
                                ) : (
                                  <>
                                    {Math.round(car.price_cny).toLocaleString("ru-RU")} ¥
                                    <span className="text-muted catalog-price-cny-note"> CNY</span>
                                  </>
                                )}
                              </p>
                            </div>
                          </Link>
                          <div className="catalog-card__actions">
                            {me?.role !== "dealer" ? (
                              <button
                                type="button"
                                className="btn btn-primary btn-sm"
                                onClick={(e) => {
                                  e.preventDefault();
                                  openRequestForModal(car);
                                }}
                              >
                                Получить расчёт
                              </button>
                            ) : null}
                            <Link
                              href={listingCarHref(car)}
                              className="btn btn-secondary btn-sm"
                              onClickCapture={(e) => saveCatalogScrollPosition(e, car.id)}
                            >
                              Подробнее
                            </Link>
                          </div>
                        </article>
                        );
                      })}
                    </div>
                  </section>
                </div>
              </div>
            </>
          )}

          <RequestConfirmModal
            open={!!requestModalCar}
            onClose={closeRequestModal}
            onConfirm={confirmRequestFromModal}
            busy={requestModalBusy}
            car={requestModalCar}
            comment={requestModalComment}
            onCommentChange={setRequestModalComment}
          />
        </div>
      </main>
    </div>
  );
}

export async function getServerSideProps(context) {
  const { fetchCatalogPageProps } = await import("../../lib/catalogServerProps");
  return fetchCatalogPageProps(context);
}
