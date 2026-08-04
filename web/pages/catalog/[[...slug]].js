import Head from "next/head";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/router";

import CatalogCardMedia from "../../components/CatalogCardMedia";
import CatalogFilterSheet from "../../components/CatalogFilterSheet";
import CatalogFilterSidebar from "../../components/CatalogFilterSidebar";
import CatalogQuickFilters from "../../components/CatalogQuickFilters";
import HomeCarCard from "../../components/HomeCarCard";
import SiteHeaderDesktopNav from "../../components/SiteHeaderDesktopNav";
import CatalogSortDropdown, { CATALOG_SORT_DEFAULT } from "../../components/CatalogSortDropdown";
import SiteHeader from "../../components/SiteHeader";
import CarDetailView from "../../components/CarDetailView";
import HeaderMessagesLink from "../../components/HeaderMessagesLink";
import HeaderProfileLink from "../../components/HeaderProfileLink";
import HeaderFavoritesLink from "../../components/HeaderFavoritesLink";
import TelegramChannelHeaderLink from "../../components/TelegramChannelHeaderLink";
import RequestConfirmModal from "../../components/RequestConfirmModal";
import { fetchAuthMe, getStoredToken, resolveAuthSessionFailure } from "../../lib/auth";
import { carSpecMetaBits } from "../../lib/carCardMeta";
import { listingCarHref, publicCarHref } from "../../lib/carRoutes";
import { saveListingReturnPath, markScrollRestoreTarget, isListingBackNavigation } from "../../lib/listingNavigation";
import { canCreateListings } from "../../lib/roles";
import {
  buildCatalogCarsQuery,
  catalogFetchKey,
  isCarDetailSegments,
  resolveCatalogTree,
  segmentsFromSlugParam,
  catalogTextQueryFromRouter,
} from "../../lib/catalogResolve";
import {
  catalogFilterKeyFromQuery,
  catalogFiltersToQuery,
  chipLabelForFilter,
  EMPTY_CATALOG_FILTERS,
  fuelTypeLabel,
  parseFiltersFromQuery,
} from "../../lib/catalogFilters";
import {
  catalogBreadcrumbItems,
  catalogCanonicalPath,
  catalogSeoCopy,
} from "../../lib/catalogSeo";
import { breadcrumbListJsonLd, jsonLdScriptProps } from "../../lib/schema";
import { scheduleListScrollRestore } from "../../lib/listScrollRestore";
import { getListingPageCache, setListingPageCache } from "../../lib/listingPageCache";
import { absoluteUrl } from "../../lib/siteUrl";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

function countActiveCatalogFilters(filters) {
  if (!filters) return 0;
  let n = 0;
  if (filters.yearFrom) n += 1;
  if (filters.yearTo) n += 1;
  if (filters.hpTo) n += 1;
  if (filters.mileageTo) n += 1;
  if (filters.fuelType) n += 1;
  if (filters.rubFrom || filters.rubTo) n += 1;
  return n;
}

function pluralizeOffers(n) {
  const num = Math.abs(Number(n) || 0);
  const mod10 = num % 10;
  const mod100 = num % 100;
  let word;
  if (mod100 >= 11 && mod100 <= 14) word = "предложений";
  else if (mod10 === 1) word = "предложение";
  else if (mod10 >= 2 && mod10 <= 4) word = "предложения";
  else word = "предложений";
  return `${num.toLocaleString("ru-RU")} ${word}`;
}

const DEFAULT_REQUEST_COMMENT =
  "Нужен расчёт под ключ до РФ. Прошу уточнить сроки и стоимость доставки.";
const DEFAULT_CHAT_COMMENT = "Хочу уточнить по этому авто в чате — без обязательств.";
const CATALOG_SCROLL_STORAGE_PREFIX = "avt_catalog_scroll:";
const CATALOG_LIST_CACHE_NS = "catalog";

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
  const [listSort, setListSort] = useState(listInitial?.listSort ?? CATALOG_SORT_DEFAULT);
  const [requestModalCar, setRequestModalCar] = useState(null);
  const [requestModalComment, setRequestModalComment] = useState("");
  const [requestModalBusy, setRequestModalBusy] = useState(false);
  const [filterDraft, setFilterDraft] = useState(EMPTY_CATALOG_FILTERS);
  const [filterSheetOpen, setFilterSheetOpen] = useState(false);
  const [carsLoading, setCarsLoading] = useState(false);
  const [carsRetryTick, setCarsRetryTick] = useState(0);
  const [similarCars, setSimilarCars] = useState([]);

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
  const isCarDetailRoute =
    initialPayload?.mode === "detail" ||
    (segments != null && isCarDetailSegments(segments));
  const isCatalogListRoute = segments != null && !isCarDetailRoute && !unknownSlug;
  const wasCatalogDetailRef = useRef(false);
  const keepCatalogListRef = useRef(false);

  const appliedFilters = useMemo(
    () =>
      parseFiltersFromQuery(router.query, {
        brandId: brand?.id ?? null,
        modelId: model?.id ?? null,
        generationId: generation?.id ?? null,
      }),
    [router.query, brand?.id, model?.id, generation?.id]
  );

  const catalogBrandOptions = useMemo(
    () =>
      tree.map((b) => ({
        id: b.id,
        name: b.name,
        slug: b.slug,
      })),
    [tree]
  );

  const quickFilterModelOptions = useMemo(() => {
    const bid = filterDraft.brandId;
    if (!bid) return [];
    const row = tree.find((b) => b.id === bid);
    if (!row?.models) return [];
    return [...row.models].sort((a, b) => a.name.localeCompare(b.name, "ru"));
  }, [filterDraft.brandId, tree]);

  const quickFilterGenerationOptions = useMemo(() => {
    const bid = filterDraft.brandId;
    const mid = filterDraft.modelId;
    if (!bid || !mid) return [];
    const row = tree.find((b) => b.id === bid);
    const modelRow = row?.models?.find((m) => m.id === mid);
    if (!modelRow?.generations) return [];
    return [...modelRow.generations].sort((a, b) => a.name.localeCompare(b.name, "ru"));
  }, [filterDraft.brandId, filterDraft.modelId, tree]);

  const applyCatalogQuickFilters = useCallback((filtersOverride) => {
    const fd = filtersOverride || filterDraft;
    const nextBrand = tree.find((b) => b.id === fd.brandId);
    const nextModel = nextBrand?.models?.find((m) => m.id === fd.modelId);
    const nextGeneration = nextModel?.generations?.find((g) => g.id === fd.generationId);
    const filterQuery = catalogFiltersToQuery(fd, { omitBrandModel: true });
    if (listSort !== CATALOG_SORT_DEFAULT) filterQuery.sort = listSort;

    let pathname = "/catalog";
    if (nextBrand?.slug) pathname += `/${nextBrand.slug}`;
    if (nextBrand?.slug && nextModel?.slug) pathname += `/${nextModel.slug}`;
    if (nextBrand?.slug && nextModel?.slug && nextGeneration?.slug) pathname += `/${nextGeneration.slug}`;
    router.push({ pathname, query: filterQuery });
  }, [filterDraft, listSort, router, tree]);

  const currentTextQuery = useMemo(() => catalogTextQueryFromRouter(router.query), [router.query]);
  const [searchInput, setSearchInput] = useState(currentTextQuery);
  useEffect(() => {
    setSearchInput(currentTextQuery);
  }, [currentTextQuery]);

  const onCatalogSearchSubmit = useCallback(
    (e) => {
      e.preventDefault();
      const { slug, q: _oldQ, ...rest } = router.query;
      const qq = searchInput.trim();
      const query = { ...rest };
      if (qq) query.q = qq;
      const pathname = router.asPath.split("?")[0].split("#")[0];
      router.push({ pathname, query });
    },
    [router, searchInput]
  );

  const activeFilterTags = useMemo(() => {
    const tags = [];
    if (brand) {
      tags.push({
        key: "brand",
        label: brand.name,
        onRemove: () => router.push({ pathname: "/catalog", query: catalogFiltersToQuery(appliedFilters, { omitBrandModel: true }) }),
      });
    }
    if (model) {
      tags.push({
        key: "model",
        label: model.name,
        onRemove: () =>
          router.push({
            pathname: `/catalog/${brand.slug}`,
            query: catalogFiltersToQuery(appliedFilters, { omitBrandModel: true }),
          }),
      });
    }
    if (generation) {
      tags.push({
        key: "generation",
        label: generation.name,
        onRemove: () =>
          router.push({
            pathname: `/catalog/${brand.slug}/${model.slug}`,
            query: catalogFiltersToQuery(appliedFilters, { omitBrandModel: true }),
          }),
      });
    }
    const priceLabel = chipLabelForFilter("price", appliedFilters);
    if (priceLabel) {
      tags.push({
        key: "price",
        label: priceLabel,
        onRemove: () => applyCatalogQuickFilters({ ...appliedFilters, rubFrom: null, rubTo: null }),
      });
    }
    const yearLabel = chipLabelForFilter("year", appliedFilters);
    if (yearLabel) {
      tags.push({
        key: "year",
        label: yearLabel,
        onRemove: () => applyCatalogQuickFilters({ ...appliedFilters, yearFrom: null, yearTo: null }),
      });
    }
    if (appliedFilters.hpTo) {
      tags.push({
        key: "hp",
        label: chipLabelForFilter("hp", appliedFilters),
        onRemove: () => applyCatalogQuickFilters({ ...appliedFilters, hpTo: null }),
      });
    }
    if (appliedFilters.fuelType) {
      tags.push({
        key: "fuel",
        label: fuelTypeLabel(appliedFilters.fuelType),
        onRemove: () => applyCatalogQuickFilters({ ...appliedFilters, fuelType: null }),
      });
    }
    if (appliedFilters.mileageTo) {
      tags.push({
        key: "mileage",
        label: chipLabelForFilter("mileage", appliedFilters),
        onRemove: () => applyCatalogQuickFilters({ ...appliedFilters, mileageTo: null }),
      });
    }
    return tags;
  }, [brand, model, generation, appliedFilters, applyCatalogQuickFilters, router]);

  useEffect(() => {
    if (!initialPayload) return;
    if (initialPayload.mode === "list") {
      // Возврат из карточки на том же page-компоненте: не затираем ленту SSR.
      if (wasCatalogDetailRef.current && cars.length > 0) {
        wasCatalogDetailRef.current = false;
        keepCatalogListRef.current = true;
        if (!tree.length && initialPayload.tree?.length) {
          setTree(initialPayload.tree);
          skipTreeLoadRef.current = true;
        }
        return;
      }
      setTree(initialPayload.tree ?? []);
      setCars(initialPayload.cars ?? []);
      setTotal(initialPayload.total ?? 0);
      setListSort(initialPayload.listSort ?? CATALOG_SORT_DEFAULT);
      skipCarsFetchKeyRef.current = initialPayload.fetchKey ?? null;
      skipTreeLoadRef.current = Boolean(initialPayload.tree?.length);
      if (router.asPath && (initialPayload.cars?.length || initialPayload.tree?.length)) {
        setListingPageCache(CATALOG_LIST_CACHE_NS, router.asPath, {
          cars: initialPayload.cars ?? [],
          total: initialPayload.total ?? 0,
          tree: initialPayload.tree ?? [],
          listSort: initialPayload.listSort ?? CATALOG_SORT_DEFAULT,
          fetchKey: initialPayload.fetchKey ?? null,
        });
      }
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
      const nextTree = await res.json();
      setTree(nextTree);
      if (router.asPath) {
        setListingPageCache(CATALOG_LIST_CACHE_NS, router.asPath, { tree: nextTree });
      }
    } catch {
      setTreeError(
        `Нет связи с API (${API_URL}). Запустите backend (docker compose / uvicorn) и проверьте адрес в NEXT_PUBLIC_API_URL.`
      );
      setTree([]);
    }
  }, [router.asPath]);

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

  function openChatForModal(car) {
    if (!token) {
      const carLabel = [car.brand, car.model].filter(Boolean).join(" ") + (car.year ? `, ${car.year}` : "");
      const draft = `Здравствуйте! Хочу уточнить по авто: ${carLabel} — ${absoluteUrl(publicCarHref(car))}`;
      router.push(`/messages?draft=${encodeURIComponent(draft)}`);
      return;
    }
    // Авторизован: без промежуточной модалки — сразу создаём заявку и уходим в чат.
    sendChatRequest(car);
  }

  async function sendChatRequest(car) {
    try {
      const res = await fetch(`${API_URL}/requests`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ car_id: car.id, comment: DEFAULT_CHAT_COMMENT }),
      });
      if (res.status === 401) {
        const kind = await resolveAuthSessionFailure();
        setToken("");
        setMe(null);
        if (kind === "pin-lock") return;
        router.push(`/request-quote?car_id=${car.id}&next=${encodeURIComponent(publicCarHref(car))}`);
        return;
      }
      if (res.status === 403) {
        router.push(`/request-quote?car_id=${car.id}&next=${encodeURIComponent(publicCarHref(car))}`);
        return;
      }
      if (!res.ok) {
        window.alert("Не удалось открыть чат. Попробуйте ещё раз.");
        return;
      }
      const body = await res.json().catch(() => ({}));
      const chatId = body.platform_chat_id;
      router.push(chatId != null ? `/messages?chat=${encodeURIComponent(String(chatId))}` : "/messages");
    } catch {
      window.alert("Сбой связи с сервером. Попробуйте ещё раз.");
    }
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
      setListingPageCache(CATALOG_LIST_CACHE_NS, router.asPath, {
        cars,
        total,
        tree,
        listSort,
      });
      writeCatalogScrollPosition(router.asPath, carId, rect ? rect.top : null);
      lastExplicitScrollSaveRef.current = { path: router.asPath, at: Date.now() };
    },
    [isCatalogListRoute, router.asPath, writeCatalogScrollPosition, cars, total, tree, listSort]
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
      if (res.status === 401) {
        const carRef = requestModalCar;
        const kind = await resolveAuthSessionFailure();
        setToken("");
        setMe(null);
        setRequestModalCar(null);
        if (kind === "pin-lock") return;
        router.push(
          `/request-quote?car_id=${carRef.id}&next=${encodeURIComponent(publicCarHref(carRef))}`
        );
        return;
      }
      if (res.status === 403) {
        const carRef = requestModalCar;
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
      const body = await res.json().catch(() => ({}));
      setRequestModalCar(null);
      const chatId = body.platform_chat_id;
      if (chatId != null) {
        router.push(`/messages?chat=${encodeURIComponent(String(chatId))}`);
        return;
      }
      window.alert("Заявка отправлена. Переписка — в разделе «Сообщения».");
      if (typeof window !== "undefined") {
        window.dispatchEvent(new Event("avt-requests-updated"));
      }
    } finally {
      setRequestModalBusy(false);
    }
  }

  useEffect(() => {
    if (!router.isReady || !isCatalogListRoute) return;
    setFilterDraft(
      parseFiltersFromQuery(router.query, {
        brandId: brand?.id ?? null,
        modelId: model?.id ?? null,
        generationId: generation?.id ?? null,
      })
    );
  }, [router.isReady, router.query, isCatalogListRoute, brand?.id, model?.id, generation?.id]);

  useEffect(() => {
    if (isCarDetailRoute) {
      wasCatalogDetailRef.current = true;
      // Снимок ленты перед уходом в карточку (на случай remount).
      if (router.asPath && cars.length > 0) {
        const returnPath = typeof sessionStorage !== "undefined"
          ? sessionStorage.getItem("avt_listing_return_path")
          : null;
        if (returnPath) {
          setListingPageCache(CATALOG_LIST_CACHE_NS, returnPath, {
            cars,
            total,
            tree,
            listSort,
          });
        }
      }
    }
  }, [isCarDetailRoute, router.asPath, cars, total, tree, listSort]);

  useEffect(() => {
    if (!ssrReady || segments == null) return;
    // На карточке авто не трогаем ленту — иначе list→detail перезатирает cars.
    if (!isCatalogListRoute) return;
    if (unknownSlug) {
      setCars([]);
      setTotal(0);
      return;
    }
    const filterKey = catalogFilterKeyFromQuery(router.query);
    const textQuery = catalogTextQueryFromRouter(router.query);
    const fetchKey = catalogFetchKey(segments, listSort, filterKey, textQuery);
    if (keepCatalogListRef.current) {
      keepCatalogListRef.current = false;
      if (cars.length > 0) {
        setListingPageCache(CATALOG_LIST_CACHE_NS, router.asPath, {
          cars,
          total,
          tree,
          listSort,
          fetchKey,
        });
        return;
      }
    }
    if (wasCatalogDetailRef.current && cars.length > 0) {
      wasCatalogDetailRef.current = false;
      setListingPageCache(CATALOG_LIST_CACHE_NS, router.asPath, {
        cars,
        total,
        tree,
        listSort,
        fetchKey,
      });
      return;
    }
    // SSR отдал полный набор для этого fetchKey — повторный клиентский запрос не нужен.
    let silentListCompletion = false;
    if (skipCarsFetchKeyRef.current === fetchKey) {
      skipCarsFetchKeyRef.current = null;
      const initialCars = listInitial?.cars?.length ?? 0;
      const initialTotal = listInitial?.total ?? 0;
      if (initialTotal > 0 && initialCars >= initialTotal) {
        return;
      }
      // Корень /catalog: SSR даёт укороченный HTML (12), клиент дотягивает до 100.
      // Не сбрасываем сетку в скелетоны — иначе «перезагрузка» уже показанных карточек.
      if (initialCars > 0) {
        silentListCompletion = true;
      }
    }
    const cached = getListingPageCache(CATALOG_LIST_CACHE_NS, router.asPath);
    if (
      isListingBackNavigation(router.asPath) &&
      cached?.cars?.length &&
      (cached.fetchKey == null || cached.fetchKey === fetchKey)
    ) {
      setCars(cached.cars);
      setTotal(cached.total ?? 0);
      if (cached.tree?.length && !tree.length) setTree(cached.tree);
      return;
    }
    const resolved = resolveCatalogTree(segments, tree);
    const filterQuery = parseFiltersFromQuery(router.query, {
      brandId: resolved.brand?.id ?? null,
      modelId: resolved.model?.id ?? null,
    });
    const params = buildCatalogCarsQuery(resolved, listSort, undefined, filterQuery, textQuery);
    if (!params) return;
    let cancelled = false;
    (async () => {
      setCarsError(null);
      // Смена фильтра/сорта — скелетоны как раньше; догрузка после SSR — без мигания UI.
      if (!silentListCompletion) {
        setCarsLoading(true);
      }
      try {
        const res = await fetch(`${API_URL}/cars?${params.toString()}`);
        if (!res.ok) {
          if (!cancelled) {
            if (!silentListCompletion) {
              setCars([]);
              setTotal(0);
            }
            setCarsError(`Не удалось загрузить объявления (${res.status}).`);
          }
          return;
        }
        const data = await res.json();
        if (!cancelled) {
          const nextCars = data.items || [];
          const nextTotal = data.total || 0;
          setCars(nextCars);
          setTotal(nextTotal);
          setListingPageCache(CATALOG_LIST_CACHE_NS, router.asPath, {
            cars: nextCars,
            total: nextTotal,
            tree,
            listSort,
            fetchKey,
          });
        }
      } catch {
        if (!cancelled) {
          if (!silentListCompletion) {
            setCars([]);
            setTotal(0);
          }
          setCarsError("Нет связи с API при загрузке объявлений.");
        }
      } finally {
        if (!cancelled) setCarsLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [
    ssrReady,
    segments,
    tree,
    unknownSlug,
    listSort,
    router.query,
    router.asPath,
    listInitial?.cars?.length,
    listInitial?.total,
    isCatalogListRoute,
    carsRetryTick,
  ]);

  useEffect(() => {
    if (!router.isReady) return;
    const rawS = router.query.sort;
    const sv = Array.isArray(rawS) ? rawS[0] : rawS;
    if (
      sv &&
      [
        "relevance",
        "date_desc",
        "date_asc",
        "price_asc",
        "price_desc",
        "year_desc",
        "year_asc",
        "mileage_asc",
        "power_desc",
      ].includes(String(sv))
    ) {
      setListSort(String(sv));
    } else if (!sv) {
      setListSort(CATALOG_SORT_DEFAULT);
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

  // useLayoutEffect — позиция до paint, без заметного автоскролла.
  useLayoutEffect(() => {
    scrollRestorePathRef.current = "";
    return tryRestoreCatalogScroll();
  }, [tryRestoreCatalogScroll]);

  // Next.js после client transition часто скроллит наверх уже после mount —
  // повторяем restore на routeChangeComplete (мгновенно, без анимации).
  useEffect(() => {
    if (!router.isReady) return undefined;
    let cleanup = () => {};
    const handler = () => {
      cleanup();
      scrollRestorePathRef.current = "";
      cleanup = tryRestoreCatalogScroll() || (() => {});
    };
    router.events.on("routeChangeComplete", handler);
    return () => {
      router.events.off("routeChangeComplete", handler);
      cleanup();
    };
  }, [router.events, router.isReady, tryRestoreCatalogScroll]);

  const breadcrumbItems = useMemo(
    () => catalogBreadcrumbItems({ brand, model, generation }),
    [brand, model, generation]
  );

  const catalogCanon = useMemo(() => catalogCanonicalPath(segments), [segments]);

  const catalogSeo = useMemo(
    () => catalogSeoCopy({ unknownSlug, brand, model, generation }),
    [unknownSlug, brand, model, generation]
  );

  /** Похожие предложения для пустого состояния — та же марка, без остальных фильтров. */
  useEffect(() => {
    if (!isCatalogListRoute || carsLoading || carsError || cars.length > 0) {
      setSimilarCars([]);
      return undefined;
    }
    let cancelled = false;
    (async () => {
      try {
        const params = new URLSearchParams();
        params.set("limit", "3");
        params.set("photo_limit", "4");
        params.set("sort", CATALOG_SORT_DEFAULT);
        if (brand?.id) params.set("brand_id", String(brand.id));
        const res = await fetch(`${API_URL}/cars?${params.toString()}`);
        if (!res.ok) return;
        const data = await res.json();
        if (!cancelled) setSimilarCars(data.items || []);
      } catch {
        /* ignore */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isCatalogListRoute, carsLoading, carsError, cars.length, brand?.id]);

  const catalogBreadcrumbLd = useMemo(
    () => breadcrumbListJsonLd(breadcrumbItems),
    [breadcrumbItems]
  );

  const detailCarId = useMemo(() => {
    if (segments != null && isCarDetailSegments(segments)) {
      return String(segments[2]);
    }
    if (initialPayload?.mode === "detail" && initialPayload.carId != null) {
      return String(initialPayload.carId);
    }
    return null;
  }, [segments, initialPayload]);

  const detailInitialCar = useMemo(() => {
    const ic = initialPayload?.mode === "detail" ? initialPayload.initialCar : null;
    if (ic && detailCarId && String(ic.id) === detailCarId) return ic;
    return null;
  }, [initialPayload, detailCarId]);

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

  if (isCarDetailRoute && detailCarId) {
    return (
      <CarDetailView
        key={detailCarId}
        carId={detailCarId}
        pathBrandSlug={segments?.[0] ?? initialPayload?.pathBrandSlug ?? null}
        pathModelSlug={segments?.[1] ?? initialPayload?.pathModelSlug ?? null}
        initialCar={detailInitialCar}
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
      <SiteHeader className="home-only-mobile" tagline="Доставка автомобилей из Китая и Кореи">
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
            <HeaderProfileLink token={token} me={me} />
            <HeaderFavoritesLink token={token} />
            <TelegramChannelHeaderLink />
          </>
        )}
      </SiteHeader>

      <SiteHeaderDesktopNav active="catalog" token={token} me={me} />

      <main className="site-main">
        <div className="container">

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
                <div className="catalog-sidebar-col">
                {isCatalogListRoute ? (
                  <CatalogFilterSidebar
                    draft={filterDraft}
                    onChangeDraft={setFilterDraft}
                    onApply={applyCatalogQuickFilters}
                    brands={catalogBrandOptions}
                    models={quickFilterModelOptions}
                    generations={quickFilterGenerationOptions}
                    total={total}
                  />
                ) : null}
                </div>

                <div className="catalog-main-panel">
                  {isCatalogListRoute ? (
                    <>
                      <div className="catalog-list-toolbar">
                        <h1 className="section-title section-title--flush-top catalog-list-toolbar__title">
                          {generation
                            ? `${brand.name} · ${model.name} · ${generation.name}`
                            : model
                              ? `${brand.name} · ${model.name}`
                              : brand
                                ? brand.name
                                : "Каталог автомобилей"}
                        </h1>
                        <div className="catalog-sort-field catalog-sort-field--desktop">
                          <CatalogSortDropdown
                            variant="desktop"
                            value={listSort}
                            onChange={(v) => {
                              setListSort(v);
                              const q = { ...router.query };
                              if (v === CATALOG_SORT_DEFAULT) {
                                delete q.sort;
                              } else {
                                q.sort = v;
                              }
                              router.replace({ pathname: router.pathname, query: q }, undefined, { shallow: true });
                            }}
                          />
                        </div>
                      </div>
                      <p className="catalog-list-toolbar__count catalog-list-toolbar__count--desktop">
                        {pluralizeOffers(total)} · цены указаны под ключ до Москвы, с растаможкой
                      </p>

                      <form className="catalog-search" onSubmit={onCatalogSearchSubmit} role="search">
                        <span className="catalog-search__icon" aria-hidden>
                          <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
                            <circle cx="11" cy="11" r="6.5" stroke="currentColor" strokeWidth="1.7" />
                            <path d="m16 16 4 4" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
                          </svg>
                        </span>
                        <input
                          className="catalog-search__input"
                          name="q"
                          placeholder="Поиск по каталогу"
                          value={searchInput}
                          onChange={(e) => setSearchInput(e.target.value)}
                          autoComplete="off"
                          aria-label="Поиск по каталогу"
                        />
                      </form>

                      <div className="catalog-mobile-filters-row">
                        <button
                          type="button"
                          className="catalog-qf__chip catalog-qf__chip--filters"
                          onClick={() => setFilterSheetOpen(true)}
                        >
                          {countActiveCatalogFilters(filterDraft) > 0
                            ? `Фильтры · ${countActiveCatalogFilters(filterDraft)}`
                            : "Фильтры"}
                        </button>
                        <CatalogQuickFilters
                          brands={catalogBrandOptions}
                          models={quickFilterModelOptions}
                          draft={filterDraft}
                          applied={appliedFilters}
                          onChangeDraft={setFilterDraft}
                          onApply={applyCatalogQuickFilters}
                        />
                        <CatalogFilterSheet
                          open={filterSheetOpen}
                          onClose={() => setFilterSheetOpen(false)}
                          brands={catalogBrandOptions}
                          models={quickFilterModelOptions}
                          generations={quickFilterGenerationOptions}
                          draft={filterDraft}
                          onChangeDraft={setFilterDraft}
                          onApply={applyCatalogQuickFilters}
                        />
                      </div>

                      <div className="catalog-results-row catalog-results-row--mobile">
                        <p className="catalog-list-toolbar__count">{pluralizeOffers(total)}</p>
                        <div className="catalog-sort-field catalog-sort-field--mobile">
                          <CatalogSortDropdown
                            variant="mobile"
                            value={listSort}
                            onChange={(v) => {
                              setListSort(v);
                              const q = { ...router.query };
                              if (v === CATALOG_SORT_DEFAULT) {
                                delete q.sort;
                              } else {
                                q.sort = v;
                              }
                              router.replace({ pathname: router.pathname, query: q }, undefined, { shallow: true });
                            }}
                          />
                        </div>
                      </div>
                    </>
                  ) : null}
                  {isCatalogListRoute && activeFilterTags.length > 0 ? (
                    <div className="catalog-active-tags">
                      {activeFilterTags.map((tag) => (
                        <button
                          key={tag.key}
                          type="button"
                          className="catalog-active-tags__tag"
                          onClick={tag.onRemove}
                        >
                          {tag.label}
                          <span className="catalog-active-tags__x" aria-hidden>
                            ✕
                          </span>
                        </button>
                      ))}
                    </div>
                  ) : null}

                  <section className="catalog-section">
                    {carsLoading ? (
                      <div className="catalog-grid" aria-label="Загрузка объявлений">
                        {Array.from({ length: 6 }).map((_, i) => (
                          <div key={i} className="catalog-card catalog-card--skeleton" aria-hidden="true">
                            <div className="catalog-card--skeleton__image" />
                            <div className="catalog-card--skeleton__line catalog-card--skeleton__line--price" />
                            <div className="catalog-card--skeleton__line catalog-card--skeleton__line--title" />
                            <div className="catalog-card--skeleton__line catalog-card--skeleton__line--meta" />
                          </div>
                        ))}
                        <p className="ui-state__loading-label">Подбираем предложения…</p>
                      </div>
                    ) : carsError ? (
                      <div className="ui-state ui-state--error">
                        <p className="ui-state__title">Не удалось загрузить</p>
                        <p className="muted ui-state__text">
                          Проверьте соединение — данные подтянутся автоматически.
                        </p>
                        <div className="ui-state__actions">
                          <button
                            type="button"
                            className="btn btn-primary btn-sm"
                            onClick={() => setCarsRetryTick((t) => t + 1)}
                          >
                            Повторить
                          </button>
                        </div>
                      </div>
                    ) : cars.length === 0 ? (
                      <div className="ui-state ui-state--empty">
                        <p className="ui-state__title">Под такие условия ничего нет</p>
                        <p className="muted ui-state__text">
                          Сбросьте фильтры или оставьте заявку — подберём варианты вручную.
                        </p>
                        <div className="ui-state__actions">
                          <Link href="/catalog" className="btn btn-secondary btn-sm">
                            Сбросить фильтры
                          </Link>
                          <Link href="/request-quote" className="btn btn-primary btn-sm">
                            Заявка на подбор
                          </Link>
                        </div>
                        {similarCars.length > 0 ? (
                          <div className="car-detail-similar ui-state__similar">
                            <h2 className="section-title car-detail-similar__title">Похожие предложения</h2>
                            <div className="car-detail-similar__scroller">
                              {similarCars.map((car) => (
                                <HomeCarCard
                                  key={car.id}
                                  car={car}
                                  variant="mobile"
                                  className="home-m-models__card car-detail-similar__card"
                                />
                              ))}
                            </div>
                          </div>
                        ) : null}
                      </div>
                    ) : (
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
                                {(() => {
                                  const bits = carSpecMetaBits(car);
                                  return bits.length ? (
                                    <span className="catalog-card__meta-rest"> · {bits.join(" · ")}</span>
                                  ) : null;
                                })()}
                              </p>
                              <p className="catalog-card__price">
                                {totalRub != null ? (
                                  <>
                                    <strong className="catalog-price-rub">
                                      {Math.round(totalRub).toLocaleString("ru-RU")} ₽
                                    </strong>
                                    <span className="text-muted catalog-price-sub">
                                      под ключ
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
                          {me?.role !== "dealer" ? (
                            <div className="catalog-card__actions">
                              <button
                                type="button"
                                className="btn btn-primary"
                                onClick={(e) => {
                                  e.preventDefault();
                                  openRequestForModal(car);
                                }}
                              >
                                Оставить заявку
                              </button>
                              <button
                                type="button"
                                className="btn btn-outline-accent"
                                onClick={(e) => {
                                  e.preventDefault();
                                  openChatForModal(car);
                                }}
                              >
                                Задать вопрос
                              </button>
                            </div>
                          ) : null}
                        </article>
                        );
                      })}
                    </div>
                    )}
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
