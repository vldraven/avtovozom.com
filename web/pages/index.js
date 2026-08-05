import Head from "next/head";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/router";

import CatalogCardMedia from "../components/CatalogCardMedia";
import CatalogQuickFilters from "../components/CatalogQuickFilters";
import BrandLogoMarquee from "../components/BrandLogoMarquee";
import DealerOpenRequests from "../components/DealerOpenRequests";
import HomeCarCard from "../components/HomeCarCard";
import SiteSelectDropdown from "../components/SiteSelectDropdown";
import SiteLogo from "../components/SiteLogo";
import HeaderMessagesLink from "../components/HeaderMessagesLink";
import HeaderProfileLink from "../components/HeaderProfileLink";
import HeaderFavoritesLink from "../components/HeaderFavoritesLink";
import TelegramChannelHeaderLink from "../components/TelegramChannelHeaderLink";
import TelegramChannelSticky from "../components/TelegramChannelSticky";
import RequestConfirmModal from "../components/RequestConfirmModal";
import { fetchAuthMe, getStoredToken, resolveAuthSessionFailure } from "../lib/auth";
import { carSpecMetaBits, carListingTitle, carTotalRub } from "../lib/carCardMeta";
import { listingCarHref, publicCarHref } from "../lib/carRoutes";
import { mediaSrc } from "../lib/media";
import { peekScrollRestoreTarget, isListingBackNavigation, saveListingReturnPath, markScrollRestoreTarget } from "../lib/listingNavigation";
import { canCreateListings, isAdminRole, isStaffRole } from "../lib/roles";
import { organizationAndWebSiteJsonLd, jsonLdScriptProps } from "../lib/schema";
import { scheduleListScrollRestore } from "../lib/listScrollRestore";
import { getListingPageCache, setListingPageCache } from "../lib/listingPageCache";
import {
  fetchCatalogBrandsCached,
  fetchCatalogTreeCached,
  setCatalogMetaCache,
} from "../lib/catalogMetaCache";
import { absoluteUrl } from "../lib/siteUrl";
import { getServerApiBase } from "../lib/serverApiUrl";
import { trimCatalogTreeForSsr } from "../lib/catalogTreeSsr";
import {
  appendFiltersToSearchParams,
  catalogFiltersToQuery,
  EMPTY_CATALOG_FILTERS,
  FUEL_TYPE_OPTIONS,
  homeHasListingQuery,
  RUB_TO_PRESETS,
} from "../lib/catalogFilters";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";
const HOME_FRESH_LOTS_LIMIT = 16;
const HOME_POPULAR_CARS_LIMIT = 12;

const HOME_FUEL_TYPE_OPTIONS = [{ value: "", label: "Любое" }, ...FUEL_TYPE_OPTIONS];

const HOME_PRICE_OPTIONS = [
  { value: "", label: "Любая" },
  ...RUB_TO_PRESETS.map((p) => ({ value: p.value, label: p.label })),
];

const HOME_DEAL_STEPS = [
  { n: 1, title: "Выбор и расчёт", text: "Поможем выбрать авто и подготовим расчёт до вашего города" },
  {
    n: 2,
    title: "Договор",
    text: "Проверяем авто, согласуем условия и сопровождаем договор с дилером.",
  },
  { n: 3, title: "Доставка", text: "Организуем перевозку. Статусы — в личном кабинете." },
  {
    n: 4,
    title: "Оформление",
    text: "Таможенное оформление, ЭПТС и передача автомобиля.",
  },
];

const HOME_BENEFITS = [
  {
    title: "Прозрачная стоимость",
    text: "Автомобиль, доставка, таможенное оформление",
    icon: (
      <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z M14 3v4a1 1 0 0 0 1 1h4 M9 13h6M9 17h4" />
    ),
  },
  {
    title: "Проверка до сделки",
    text: "Фото, видео и доступные отчёты по автомобилю — до решения о покупке.",
    icon: (
      <>
        <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
        <circle cx="12" cy="13" r="4" />
      </>
    ),
  },
  {
    title: "Вся сделка — в кабинете",
    text: "Статусы, расчёты, документы и чат с менеджером — в одном месте.",
    icon: <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />,
  },
];

const HOME_STEP_ICONS = [
  <>
    <path d="M9 12h6M9 16h6M9 8h2" />
    <path d="M14 3v4a1 1 0 0 0 1 1h4" />
    <path d="M15 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
  </>,
  <>
    <circle cx="10" cy="10" r="6" />
    <path d="m21 21-4.35-4.35" />
    <path d="m8 10 1.5 1.5L13 8" />
  </>,
  <>
    <path d="M1 3h13v13H1z" />
    <path d="M14 8h4l3 3v5h-7z" />
    <circle cx="5.5" cy="18.5" r="1.8" />
    <circle cx="17.5" cy="18.5" r="1.8" />
  </>,
  <>
    <path d="M9 11l3 3L22 4" />
    <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />
  </>,
];

/** Иначе GET справочников может отдаваться из HTTP-кэша без только что созданной записи. */
const STAFF_GET_INIT = { cache: "no-store" };

const DEFAULT_REQUEST_COMMENT =
  "Нужен расчёт под ключ до РФ. Прошу уточнить сроки и стоимость доставки.";
const HOME_SCROLL_STORAGE_PREFIX = "avt_home_scroll:";
const HOME_LIST_CACHE_NS = "home";

function readHomeListCacheSeed() {
  if (typeof window === "undefined") return null;
  const target = peekScrollRestoreTarget();
  if (!target) return null;
  const cached = getListingPageCache(HOME_LIST_CACHE_NS, target);
  if (!cached?.cars?.length) return null;
  return cached;
}
function parseImportStepMessage(msg) {
  const m = /^(\d)\/(\d)\s/.exec(msg || "");
  if (!m) return null;
  return { cur: Number(m[1]), total: Number(m[2]) };
}

/** id марки в staff-справочнике по подписи из выпадающего списка (дефис/пробел/регистр). */
function resolveStaffBrandId(brands, selectedLabel) {
  if (!selectedLabel || !brands?.length) return undefined;
  const t = String(selectedLabel).trim();
  const exact = brands.find((b) => b.name === t);
  if (exact) return exact.id;
  const norm = (s) =>
    String(s)
      .trim()
      .toLowerCase()
      .replace(/[\u2010-\u2015\u2212\u00AD]/g, "-")
      .replace(/\s+/g, " ");
  const nt = norm(t);
  const byNorm = brands.find((b) => norm(b.name) === nt);
  if (byNorm) return byNorm.id;
  const compact = (s) => norm(s).replace(/[-\s]/g, "");
  const ct = compact(t);
  return brands.find((b) => compact(b.name) === ct)?.id;
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

/** SSR уже отдал ленту — не дублируем клиентский fetch (фильтры/staff по-прежнему дергают loadCars). */
function homeHasSsrListSeed(initialData) {
  if (!initialData) return false;
  return (
    (Array.isArray(initialData.cars) && initialData.cars.length > 0) ||
    (Array.isArray(initialData.popularCars) && initialData.popularCars.length > 0)
  );
}

export default function Home({ initialData = null }) {
  const router = useRouter();
  const lastExplicitHomeScrollSaveRef = useRef({ path: "", at: 0 });
  const cacheSeed = readHomeListCacheSeed();
  const skipHomeListFetchOnceRef = useRef(
    Boolean(cacheSeed) ||
      homeHasSsrListSeed(initialData) ||
      (typeof window !== "undefined" &&
        isListingBackNavigation(`${window.location.pathname}${window.location.search}`))
  );
  const [mobileHeaderMenuOpen, setMobileHeaderMenuOpen] = useState(false);
  const [heroBrandId, setHeroBrandId] = useState("");
  const [heroModelId, setHeroModelId] = useState("");
  const [heroRubTo, setHeroRubTo] = useState("");
  const [heroFuelType, setHeroFuelType] = useState("");
  const [heroModels, setHeroModels] = useState([]);
  const [heroModelsBusy, setHeroModelsBusy] = useState(false);
  const [homeFilterDraft, setHomeFilterDraft] = useState(EMPTY_CATALOG_FILTERS);
  const [homeFilterApplied, setHomeFilterApplied] = useState(EMPTY_CATALOG_FILTERS);
  const [popularCars, setPopularCars] = useState(initialData?.popularCars ?? []);
  const [cars, setCars] = useState(cacheSeed?.cars ?? initialData?.cars ?? []);
  const [total, setTotal] = useState(cacheSeed?.total ?? initialData?.total ?? 0);
  const [catalogCbr, setCatalogCbr] = useState(cacheSeed?.cbr ?? initialData?.cbr ?? null);
  const [catalogCbrError, setCatalogCbrError] = useState(
    cacheSeed?.cbrError ?? initialData?.cbrError ?? null
  );
  const [q, setQ] = useState("");
  const [catalogBrands, setCatalogBrands] = useState(
    cacheSeed?.brands ?? initialData?.brands ?? []
  );
  const [catalogTree, setCatalogTree] = useState(initialData?.tree ?? []);
  const [brandsExpanded, setBrandsExpanded] = useState(false);
  const [token, setToken] = useState("");
  const [me, setMe] = useState(null);
  const [latestParserJob, setLatestParserJob] = useState(null);
  const [parserJobMessage, setParserJobMessage] = useState("");
  const [cancelParserBusy, setCancelParserBusy] = useState(false);
  const [whitelistCatalog, setWhitelistCatalog] = useState([]);
  const [catalogUrlDrafts, setCatalogUrlDrafts] = useState({});
  /** Админка парсера: марка → модель → URL (не путать с фильтром каталога объявлений). */
  const [parserAdminBrand, setParserAdminBrand] = useState("");
  const [parserAdminModelId, setParserAdminModelId] = useState(null);
  /** Полный справочник марок/моделей для админа в виджете парсера */
  const [staffBrandsParser, setStaffBrandsParser] = useState([]);
  const [staffModelsParser, setStaffModelsParser] = useState([]);
  const [staffGensParser, setStaffGensParser] = useState([]);
  const [parserAdminGenId, setParserAdminGenId] = useState("");
  const [parserCatalogBusy, setParserCatalogBusy] = useState(false);
  const [parserCatalogNotice, setParserCatalogNotice] = useState("");
  const [importListingBusy, setImportListingBusy] = useState(false);
  /** Площадка-источник для ручного импорта (che168 / global.che168 / dongchedi). */
  const [parserImportMarketplace, setParserImportMarketplace] = useState("che168");
  /** Защита от гонки: ответ старого GET не перезаписывает список после POST+свежего GET. */
  const staffBrandsLoadGen = useRef(0);
  const staffModelsLoadGen = useRef(0);
  const staffGensLoadGen = useRef(0);
  const [listSort] = useState("date_desc");
  const [profileReady, setProfileReady] = useState(false);
  const [requestModalCar, setRequestModalCar] = useState(null);
  const [requestModalComment, setRequestModalComment] = useState("");
  const [requestModalBusy, setRequestModalBusy] = useState(false);
  const [activeDeal, setActiveDeal] = useState(null);
  const sortedBrands = useMemo(() => {
    return [...catalogBrands].sort(
      (a, b) =>
        b.listings_count - a.listings_count || a.name.localeCompare(b.name, "ru")
    );
  }, [catalogBrands]);

  const quickFilterBrands = useMemo(() => {
    return catalogBrands
      .filter((b) => b.logo_storage_url && b.slug)
      .sort((a, b) => {
        const ar = a.quick_filter_rank;
        const br = b.quick_filter_rank;
        if (ar != null && br != null) {
          return ar - br || b.listings_count - a.listings_count || a.name.localeCompare(b.name, "ru");
        }
        if (ar != null) return -1;
        if (br != null) return 1;
        return b.listings_count - a.listings_count || a.name.localeCompare(b.name, "ru");
      });
  }, [catalogBrands]);

  const BRANDS_COLLAPSED_DESKTOP = 10;
  const BRANDS_COLLAPSED_MOBILE = 10;
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

  const parserBrandDropdownOptions = useMemo(() => {
    if (isAdminRole(me?.role) && staffBrandsParser.length > 0) {
      return [...staffBrandsParser]
        .sort((a, b) => a.name.localeCompare(b.name, "ru"))
        .map((b) => ({ value: String(b.id), label: b.name }));
    }
    return parserAdminBrandNames.map((name) => ({ value: name, label: name }));
  }, [me?.role, staffBrandsParser, parserAdminBrandNames]);

  /** id марки в staff-справочнике для импорта (после выбора по id имя совпадает с API). */
  const parserStaffBrandId = useMemo(() => {
    if (!isAdminRole(me?.role) || staffBrandsParser.length === 0) return null;
    const name = String(parserAdminBrand || "").trim();
    if (!name) return null;
    return resolveStaffBrandId(staffBrandsParser, parserAdminBrand) ?? null;
  }, [me?.role, staffBrandsParser, parserAdminBrand]);

  const parserModelDropdownOptions = useMemo(() => {
    if (isAdminRole(me?.role)) {
      return staffModelsParser.map((m) => ({
        value: String(m.id),
        label: m.name,
      }));
    }
    return parserAdminModelsInBrand.map((row) => ({
      value: String(row.model_id),
      label: row.model,
    }));
  }, [me?.role, staffModelsParser, parserAdminModelsInBrand]);

  const parserGenDropdownOptions = useMemo(() => {
    return staffGensParser.map((g) => ({
      value: String(g.id),
      label: g.name,
    }));
  }, [staffGensParser]);

  const parserMarketplaceOptions = useMemo(
    () => [
      { value: "che168", label: "che168.com" },
      { value: "global_che168", label: "global.che168.com" },
      { value: "dongchedi", label: "dongchedi.com" },
    ],
    []
  );

  const parserImportUrlPlaceholder = useMemo(() => {
    if (parserImportMarketplace === "global_che168") {
      return "https://global.che168.com/detail/…";
    }
    if (parserImportMarketplace === "dongchedi") {
      return "https://www.dongchedi.com/usedcar/…";
    }
    return "https://www.che168.com/dealer/…/….html";
  }, [parserImportMarketplace]);

  const loadCars = useCallback(async () => {
    if (!router.isReady) return;
    const params = new URLSearchParams();
    params.set("photo_limit", "8");
    params.set("limit", String(HOME_FRESH_LOTS_LIMIT));
    params.set("sort", "date_desc");
    if (homeFilterApplied.brandId) params.set("brand_id", String(homeFilterApplied.brandId));
    if (homeFilterApplied.modelId) params.set("model_id", String(homeFilterApplied.modelId));
    appendFiltersToSearchParams(params, homeFilterApplied);
    const popularParams = new URLSearchParams();
    popularParams.set("is_popular", "true");
    popularParams.set("photo_limit", "8");
    popularParams.set("limit", String(HOME_POPULAR_CARS_LIMIT));
    popularParams.set("sort", "date_desc");
    if (homeFilterApplied.brandId) popularParams.set("brand_id", String(homeFilterApplied.brandId));
    if (homeFilterApplied.modelId) popularParams.set("model_id", String(homeFilterApplied.modelId));
    appendFiltersToSearchParams(popularParams, homeFilterApplied);
    try {
      const [res, popularRes] = await Promise.all([
        fetch(`${API_URL}/cars?${params.toString()}`),
        fetch(`${API_URL}/cars?${popularParams.toString()}`),
      ]);
      const data = await res.json();
      const nextCars = data.items || [];
      const nextTotal = data.total || 0;
      const nextCbr = data.cbr || null;
      const nextCbrError = data.cbr_error || null;
      setCars(nextCars);
      setTotal(nextTotal);
      setCatalogCbr(nextCbr);
      setCatalogCbrError(nextCbrError);
      if (popularRes.ok) {
        const popularData = await popularRes.json();
        setPopularCars(popularData.items || []);
      }
      setListingPageCache(HOME_LIST_CACHE_NS, router.asPath, {
        cars: nextCars,
        total: nextTotal,
        cbr: nextCbr,
        cbrError: nextCbrError,
        listSort: "date_desc",
        brands: catalogBrands,
      });
    } catch {
      setCars([]);
      setTotal(0);
      setCatalogCbr(null);
      setCatalogCbrError("network");
    }
  }, [router.isReady, router.asPath, catalogBrands, homeFilterApplied]);

  function onSearchSubmit(e) {
    e.preventDefault();
    const qq = q.trim();
    if (!qq) {
      router.push("/catalog");
      return;
    }
    router.push({ pathname: "/catalog", query: { q: qq } });
  }

  function onHeroFiltersSubmit(e) {
    e.preventDefault();
    const fd = {
      ...EMPTY_CATALOG_FILTERS,
      brandId: heroBrandId ? Number(heroBrandId) : null,
      modelId: heroModelId ? Number(heroModelId) : null,
      rubTo: heroRubTo ? Number(heroRubTo) : null,
      fuelType: heroFuelType || null,
    };
    const nextBrand =
      catalogTree.find((b) => b.id === fd.brandId) || catalogBrands.find((b) => b.id === fd.brandId);
    const nextModel =
      nextBrand?.models?.find((m) => m.id === fd.modelId) ||
      heroModels.find((m) => m.id === fd.modelId);
    const filterQuery = catalogFiltersToQuery(fd, { omitBrandModel: true });

    let pathname = "/catalog";
    if (nextBrand?.slug) pathname += `/${nextBrand.slug}`;
    if (nextBrand?.slug && nextModel?.slug) pathname += `/${nextModel.slug}`;

    // Если slug марки нет, но выбран brand/model id — пробросим query.
    if (!nextBrand?.slug && (fd.brandId || fd.modelId)) {
      Object.assign(filterQuery, catalogFiltersToQuery(fd));
    }

    router.push({ pathname, query: filterQuery });
  }

  useEffect(() => {
    let cancelled = false;
    if (!heroBrandId) {
      setHeroModels([]);
      setHeroModelId("");
      return undefined;
    }
    setHeroModelsBusy(true);
    (async () => {
      try {
        const res = await fetch(`${API_URL}/catalog/models?brand_id=${encodeURIComponent(heroBrandId)}`, {
          cache: "no-store",
        });
        if (!res.ok) throw new Error("models");
        const data = await res.json();
        if (cancelled) return;
        setHeroModels(Array.isArray(data) ? data : []);
      } catch {
        if (!cancelled) setHeroModels([]);
      } finally {
        if (!cancelled) setHeroModelsBusy(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [heroBrandId]);

  const desktopArrivals = useMemo(() => cars.slice(0, HOME_FRESH_LOTS_LIMIT), [cars]);

  const popularBrands = useMemo(() => {
    const withLogo = (list) => (list || []).filter((b) => b.logo_storage_url && b.slug);
    const sortBrands = (list) =>
      [...list].sort(
        (a, b) =>
          (a.quick_filter_rank ?? 999) - (b.quick_filter_rank ?? 999) ||
          (b.listings_count || 0) - (a.listings_count || 0) ||
          String(a.name || "").localeCompare(String(b.name || ""), "ru")
      );
    const flagged = sortBrands(withLogo(catalogBrands.filter((b) => b.is_popular)));
    if (flagged.length) return flagged;
    return sortBrands(withLogo(quickFilterBrands.length ? quickFilterBrands : catalogBrands));
  }, [catalogBrands, quickFilterBrands]);

  const homeFilterBrandOptions = useMemo(
    () => sortedBrands.map((b) => ({ id: b.id, name: b.name })),
    [sortedBrands]
  );

  const homeFilterModelOptions = useMemo(() => {
    if (!homeFilterDraft.brandId) return [];
    const brand = (catalogTree || []).find((b) => b.id === homeFilterDraft.brandId);
    if (brand?.models?.length) {
      return brand.models.map((m) => ({ id: m.id, name: m.name }));
    }
    return [];
  }, [catalogTree, homeFilterDraft.brandId]);

  const applyHomeQuickFilters = useCallback(
    (filtersOverride) => {
      const fd = filtersOverride || homeFilterDraft;
      setHomeFilterDraft(fd);
      setHomeFilterApplied(fd);
    },
    [homeFilterDraft]
  );

  const showCountLabel = total
    ? `Показать ${Number(total).toLocaleString("ru-RU")}`
    : "Показать авто";

  async function cancelParserJob(jobId) {
    if (!token || !jobId || cancelParserBusy) return;
    if (!confirm("Остановить текущую задачу парсера?")) return;
    setCancelParserBusy(true);
    setParserJobMessage("");
    try {
      const res = await fetch(`${API_URL}/admin/parser/jobs/${jobId}/cancel`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        let detail = "Не удалось остановить задачу.";
        try {
          const err = await res.json();
          if (err.detail) detail = String(err.detail);
        } catch {
          /* ignore */
        }
        setParserJobMessage(detail);
        return;
      }
      const job = await res.json();
      setLatestParserJob(job);
      setParserJobMessage(
        job.status === "cancelled"
          ? "Задача остановлена."
          : "Запрошена остановка. Дождитесь завершения текущего шага…"
      );
    } catch {
      setParserJobMessage("Сбой связи с API. Проверьте, что backend доступен.");
    } finally {
      setCancelParserBusy(false);
    }
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

  const writeHomeScrollPosition = useCallback((path, carId = null, cardTop = null) => {
    if (typeof window === "undefined" || !path) return;
    sessionStorage.setItem(
      `${HOME_SCROLL_STORAGE_PREFIX}${path}`,
      JSON.stringify({
        y: window.scrollY,
        carId,
        cardTop,
        savedAt: Date.now(),
      })
    );
  }, []);

  const saveHomeScrollPosition = useCallback(
    (event, carId) => {
      if (typeof window === "undefined" || !router.asPath) return;
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

      const card = event.currentTarget?.closest?.("[data-home-car-id]");
      const rect = card?.getBoundingClientRect?.();
      saveListingReturnPath(router.asPath);
      markScrollRestoreTarget(router.asPath);
      setListingPageCache(HOME_LIST_CACHE_NS, router.asPath, {
        cars,
        total,
        cbr: catalogCbr,
        cbrError: catalogCbrError,
        brands: catalogBrands,
        listSort,
      });
      writeHomeScrollPosition(router.asPath, carId, rect ? rect.top : null);
      lastExplicitHomeScrollSaveRef.current = { path: router.asPath, at: Date.now() };
    },
    [
      router.asPath,
      writeHomeScrollPosition,
      cars,
      total,
      catalogCbr,
      catalogCbrError,
      catalogBrands,
      listSort,
    ]
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
        const kind = await resolveAuthSessionFailure();
        setToken(getStoredToken());
        setMe(null);
        if (kind === "pin-lock") return;
        return;
      }
      if (res.status === 403) {
        const cid = requestModalCar.id;
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
      const body = await res.json().catch(() => ({}));
      setRequestModalCar(null);
      const chatId = body.platform_chat_id;
      if (chatId != null) {
        router.push(`/messages?chat=${encodeURIComponent(String(chatId))}`);
        return;
      }
      alert("Заявка отправлена. Переписка — в разделе «Сообщения».");
      if (typeof window !== "undefined") {
        window.dispatchEvent(new Event("avt-requests-updated"));
      }
    } finally {
      setRequestModalBusy(false);
    }
  }

  async function loadMe(accessToken) {
    const currentToken = accessToken || token;
    if (!currentToken) return;
    try {
      const meRes = await fetchAuthMe();
      if (!meRes.ok) {
        if (meRes.kind === "pin-lock") {
          setToken("");
          setMe(null);
          return;
        }
        if (meRes.kind === "logout" || meRes.kind === "no-token") {
          setToken("");
          setMe(null);
        }
        return;
      }
      const data = meRes.user;
      setMe(data);
      const activeToken = meRes.accessToken || currentToken;

      if (isStaffRole(data.role)) {
        await loadLatestParserJob(activeToken);
        await loadWhitelistCatalog(activeToken);
      } else {
        setLatestParserJob(null);
        setWhitelistCatalog([]);
      }
    } catch {
      /* API недоступен (backend не запущен) — не роняем главную */
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
    // Не затираем ввод в «Ссылка на объявление»: whitelist хранит che168-пример для модели;
    // после импорта с dongchedi/global там остаётся старая che168-ссылка.
    setCatalogUrlDrafts((prev) => {
      const next = { ...prev };
      for (const r of data || []) {
        const mid = r.model_id;
        if (!(mid in next)) {
          next[mid] = r.che168_url || "";
        }
      }
      return next;
    });
  }

  /** Актуальный список марок из API (для восстановления после 404 «Марка не найдена»). */
  async function reloadStaffBrandsParser(accessToken) {
    const currentToken = accessToken || token;
    if (!currentToken) return null;
    const r = await fetch(`${API_URL}/staff/catalog/brands`, {
      ...STAFF_GET_INIT,
      headers: { Authorization: `Bearer ${currentToken}` },
    });
    if (!r.ok) return null;
    return r.json();
  }

  useEffect(() => {
    if (!token || !me || !isAdminRole(me.role)) {
      setStaffBrandsParser([]);
      return;
    }
    const opGen = (() => {
      staffBrandsLoadGen.current += 1;
      return staffBrandsLoadGen.current;
    })();
    let cancelled = false;
    (async () => {
      const r = await fetch(`${API_URL}/staff/catalog/brands`, {
        ...STAFF_GET_INIT,
        headers: { Authorization: `Bearer ${token}` },
      });
      if (cancelled || opGen !== staffBrandsLoadGen.current) return;
      if (r.ok) {
        setStaffBrandsParser(await r.json());
      }
    })();
    return () => {
      cancelled = true;
      staffBrandsLoadGen.current += 1;
    };
  }, [token, me?.role]);

  useEffect(() => {
    if (!token || !me || !isAdminRole(me.role) || !parserAdminBrand) {
      setStaffModelsParser([]);
      return;
    }
    /* Пока марки ещё не подгрузились, не обнуляем модели — иначе затирается только что добавленная
     * модель (parserStaffBrandId временно null, bid не находится). */
    if (staffBrandsParser.length === 0) {
      return;
    }
    const bid = parserStaffBrandId ?? resolveStaffBrandId(staffBrandsParser, parserAdminBrand);
    if (!bid) {
      setStaffModelsParser([]);
      return;
    }
    const opGen = (() => {
      staffModelsLoadGen.current += 1;
      return staffModelsLoadGen.current;
    })();
    let cancelled = false;
    (async () => {
      const r = await fetch(`${API_URL}/staff/catalog/models?brand_id=${bid}`, {
        ...STAFF_GET_INIT,
        headers: { Authorization: `Bearer ${token}` },
      });
      if (cancelled || opGen !== staffModelsLoadGen.current) return;
      if (r.ok) {
        setStaffModelsParser(await r.json());
      }
    })();
    return () => {
      cancelled = true;
      staffModelsLoadGen.current += 1;
    };
  }, [token, me?.role, parserAdminBrand, staffBrandsParser, parserStaffBrandId]);

  useEffect(() => {
    if (!token || !me || !isAdminRole(me?.role) || !parserAdminModelId) {
      setStaffGensParser([]);
      setParserAdminGenId("");
      return;
    }
    const opGen = (() => {
      staffGensLoadGen.current += 1;
      return staffGensLoadGen.current;
    })();
    let cancelled = false;
    (async () => {
      const r = await fetch(`${API_URL}/staff/catalog/generations?model_id=${parserAdminModelId}`, {
        ...STAFF_GET_INIT,
        headers: { Authorization: `Bearer ${token}` },
      });
      if (cancelled || opGen !== staffGensLoadGen.current) return;
      if (r.ok) {
        setStaffGensParser(await r.json());
      }
    })();
    return () => {
      cancelled = true;
      staffGensLoadGen.current += 1;
    };
  }, [token, me?.role, parserAdminModelId]);

  async function addParserCatalogBrand(name) {
    const n = String(name || "").trim();
    if (!token || !n || !isAdminRole(me?.role)) return;
    setParserCatalogNotice("");
    setParserCatalogBusy(true);
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
        setParserCatalogNotice(
          formatApiErrorDetail(body) || `Ошибка ${res.status}: не удалось добавить марку`
        );
        return;
      }
      /* Сразу после POST: инвалидируем старые GET и показываем новую марку в списке (иначе ответ
       * старого запроса из useEffect может прийти между POST и bump и затереть список). */
      staffBrandsLoadGen.current += 1;
      const opGenBrands = staffBrandsLoadGen.current;
      const createdBrand = { id: body.id, name: body.name };
      setStaffBrandsParser((prev) => {
        const next = prev.filter((b) => b.id !== createdBrand.id);
        next.push(createdBrand);
        next.sort((a, b) => a.name.localeCompare(b.name, "ru"));
        return next;
      });
      setParserAdminBrand(body.name);
      setParserAdminModelId(null);
      setParserAdminGenId("");
      setParserCatalogNotice("Марка добавлена. Выберите модель или введите название в поиске.");
      const r = await fetch(`${API_URL}/staff/catalog/brands`, {
        ...STAFF_GET_INIT,
        headers: { Authorization: `Bearer ${token}` },
      });
      if (opGenBrands === staffBrandsLoadGen.current && r.ok) {
        setStaffBrandsParser(await r.json());
      }
      await loadWhitelistCatalog(token);
    } finally {
      setParserCatalogBusy(false);
    }
  }

  async function addParserCatalogModel(name) {
    const n = String(name || "").trim();
    let bid = parserStaffBrandId ?? resolveStaffBrandId(staffBrandsParser, parserAdminBrand);
    if (!token || !n || !isAdminRole(me?.role)) return;
    if (!bid) {
      setParserCatalogNotice(
        "Не удалось определить марку. Откройте «Марка», выберите марку в списке и повторите добавление модели."
      );
      return;
    }
    setParserCatalogNotice("");
    setParserCatalogBusy(true);
    try {
      const postModel = async (brandId) => {
        const res = await fetch(`${API_URL}/admin/car-brands/${brandId}/models`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ name: n }),
        });
        const body = await res.json().catch(() => ({}));
        return { res, body };
      };

      let { res, body } = await postModel(bid);

      /* 404: либо устаревший brand_id в UI, либо (часто) в контейнере backend старый образ без маршрута.
       * Подтягиваем свежий справочник марок и один раз повторяем POST с пересчитанным id. */
      if (!res.ok && res.status === 404) {
        const fresh = await reloadStaffBrandsParser(token);
        if (fresh && Array.isArray(fresh)) {
          staffBrandsLoadGen.current += 1;
          setStaffBrandsParser(fresh);
          const bid2 = resolveStaffBrandId(fresh, parserAdminBrand);
          if (bid2 != null && bid2 !== bid) {
            ({ res, body } = await postModel(bid2));
            bid = bid2;
          } else if (bid2 == null) {
            setParserCatalogNotice(
              "Справочник марок обновлён, но выбранное название марки не найдено. Выберите марку в поле «1. Марка» заново."
            );
            return;
          } else {
            /* bid2 === bid: пересоберите backend (docker compose build backend) или проверьте, что в образе есть POST /admin/car-brands/{id}/models */
            setParserCatalogNotice(
              formatApiErrorDetail(body) ||
                "404: марка не найдена или устарел справочник. Выполните «docker compose build backend && docker compose up -d backend» и обновите страницу."
            );
            return;
          }
        }
      }

      if (!res.ok) {
        setParserCatalogNotice(
          formatApiErrorDetail(body) || `Ошибка ${res.status}: не удалось добавить модель`
        );
        return;
      }
      if (body?.id == null || body?.name == null) {
        setParserCatalogNotice(
          "Сервер вернул неполные данные о модели. Обновите страницу и проверьте справочник."
        );
        return;
      }
      staffModelsLoadGen.current += 1;
      const opGenModels = staffModelsLoadGen.current;
      const createdModel = {
        id: body.id,
        name: body.name,
        brand_id: body.brand_id ?? bid,
      };
      setStaffModelsParser((prev) => {
        const next = prev.filter((m) => m.id !== createdModel.id);
        next.push(createdModel);
        next.sort((a, b) => a.name.localeCompare(b.name, "ru"));
        return next;
      });
      setParserAdminModelId(createdModel.id);
      setParserAdminGenId("");
      setCatalogUrlDrafts((prev) => ({ ...prev, [createdModel.id]: prev[createdModel.id] ?? "" }));
      setParserCatalogNotice("Модель добавлена и выбрана.");
      const r = await fetch(`${API_URL}/staff/catalog/models?brand_id=${bid}`, {
        ...STAFF_GET_INIT,
        headers: { Authorization: `Bearer ${token}` },
      });
      if (opGenModels === staffModelsLoadGen.current && r.ok) {
        const raw = await r.json();
        const list = Array.isArray(raw) ? raw : [];
        let merged = list.slice();
        if (!merged.some((m) => m.id === createdModel.id)) {
          merged.push(createdModel);
          merged.sort((a, b) => a.name.localeCompare(b.name, "ru"));
        }
        setStaffModelsParser(merged);
      }
      await loadWhitelistCatalog(token);
    } catch (e) {
      setParserCatalogNotice(
        e instanceof Error ? `Сеть или сервер: ${e.message}` : "Не удалось выполнить запрос к API"
      );
    } finally {
      setParserCatalogBusy(false);
    }
  }

  async function addParserCatalogGeneration(name) {
    const n = String(name || "").trim();
    if (!token || !parserAdminModelId || !n || !isAdminRole(me?.role)) return;
    setParserCatalogNotice("");
    setParserCatalogBusy(true);
    try {
      const res = await fetch(`${API_URL}/admin/car-models/${parserAdminModelId}/generations`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ name: n }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setParserCatalogNotice(
          typeof body.detail === "string" ? body.detail : "Не удалось добавить поколение"
        );
        return;
      }
      staffGensLoadGen.current += 1;
      const opGenGens = staffGensLoadGen.current;
      const createdGen = {
        id: body.id,
        name: body.name,
        slug: body.slug ?? "",
        listings_count: body.listings_count ?? 0,
      };
      setStaffGensParser((prev) => {
        const next = prev.filter((g) => g.id !== createdGen.id);
        next.push(createdGen);
        next.sort((a, b) => a.name.localeCompare(b.name, "ru"));
        return next;
      });
      setParserAdminGenId(String(body.id));
      setParserCatalogNotice(`Поколение «${body.name}» добавлено в справочник.`);
      const gr = await fetch(`${API_URL}/staff/catalog/generations?model_id=${parserAdminModelId}`, {
        ...STAFF_GET_INIT,
        headers: { Authorization: `Bearer ${token}` },
      });
      if (opGenGens === staffGensLoadGen.current && gr.ok) {
        setStaffGensParser(await gr.json());
      }
    } finally {
      setParserCatalogBusy(false);
    }
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
      alert("Вставьте ссылку на объявление.");
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
        body: JSON.stringify({
          model_id: parserAdminModelId,
          che168_url: url,
          marketplace: parserImportMarketplace,
          generation_id: parserAdminGenId ? Number(parserAdminGenId) : null,
        }),
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
      const stored = getStoredToken();
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

  const loadCatalogBrandsOnly = useCallback(async () => {
    try {
      const brands = await fetchCatalogBrandsCached(API_URL);
      setCatalogBrands(brands);
      if (router.isReady && router.asPath) {
        setListingPageCache(HOME_LIST_CACHE_NS, router.asPath, { brands });
      }
    } catch {
      /* ignore */
    }
  }, [router.isReady, router.asPath]);

  /** SSR-фетч /catalog/tree иногда не успевает (холодный старт backend) — без этого фильтр «Модель» остаётся пустым на весь сеанс. */
  useEffect(() => {
    if (initialData?.brands?.length) {
      setCatalogMetaCache("brands", initialData.brands);
    }
    // Урезанное SSR-дерево в общий кэш не кладём — фильтрам нужен полный справочник.
    if (initialData?.tree?.length && initialData?.treeComplete) {
      setCatalogMetaCache("tree", initialData.tree);
    }
    if (catalogTree.length > 0 && initialData?.treeComplete) return;
    let cancelled = false;
    (async () => {
      try {
        const nextTree = await fetchCatalogTreeCached(API_URL);
        if (!cancelled && Array.isArray(nextTree) && nextTree.length > 0) {
          setCatalogTree(nextTree);
        }
      } catch {
        /* ignore */
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (isAdminRole(me?.role)) return;
    if (parserAdminModelId != null && !whitelistCatalog.some((r) => r.model_id === parserAdminModelId)) {
      setParserAdminModelId(null);
    }
  }, [whitelistCatalog, parserAdminModelId, me?.role]);

  useEffect(() => {
    if (!parserAdminBrand) return;
    if (isAdminRole(me?.role)) {
      if (staffBrandsParser.length === 0) return;
      const bid = resolveStaffBrandId(staffBrandsParser, parserAdminBrand);
      if (bid != null) {
        const row = staffBrandsParser.find((b) => b.id === bid);
        if (row && row.name !== parserAdminBrand) {
          setParserAdminBrand(row.name);
        }
        return;
      }
      setParserAdminBrand("");
      setParserAdminModelId(null);
      return;
    }
    if (!parserAdminBrandNames.includes(parserAdminBrand)) {
      setParserAdminBrand("");
      setParserAdminModelId(null);
    }
  }, [whitelistCatalog, parserAdminBrand, parserAdminBrandNames, staffBrandsParser, me?.role]);

  useEffect(() => {
    if (!token || !profileReady) {
      setActiveDeal(null);
      return undefined;
    }
    if (isStaffRole(me?.role) || me?.role === "dealer") {
      setActiveDeal(null);
      return undefined;
    }
    let cancelled = false;
    (async () => {
      try {
        const [rr, cr] = await Promise.all([
          fetch(`${API_URL}/requests/my`, { headers: { Authorization: `Bearer ${token}` } }),
          fetch(`${API_URL}/chats/my`, { headers: { Authorization: `Bearer ${token}` } }),
        ]);
        if (cancelled) return;
        const requests = rr.ok ? await rr.json() : [];
        const chats = cr.ok ? await cr.json() : [];
        const openReq = (requests || []).find((r) => r.status === "open" || r.status === "in_progress");
        const platform = (chats || []).find((c) => c.chat_type === "platform") || (chats || [])[0];
        if (!openReq && !platform) {
          setActiveDeal(null);
          return;
        }
        setActiveDeal({
          requestId: openReq?.id ?? null,
          status: openReq?.status ?? null,
          comment: openReq?.comment ?? "",
          chatId: platform?.id ?? null,
          chatTitle: platform?.title || platform?.peer_label || "Чат сделки",
        });
      } catch {
        if (!cancelled) setActiveDeal(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [token, profileReady, me?.role]);

  const loadHomeCatalogParallel = useCallback(async () => {
    if (!router.isReady) {
      await loadCatalogBrandsOnly();
      return;
    }
    await Promise.all([loadCatalogBrandsOnly(), loadCars()]);
  }, [router.isReady, loadCatalogBrandsOnly, loadCars]);

  useEffect(() => {
    if (!router.isReady) return;
    // SSR-seed или «назад» из карточки: не дублируем ленту (один раз на mount).
    // Смена фильтров меняет loadHomeCatalogParallel → эффект снова грузит.
    if (skipHomeListFetchOnceRef.current) {
      skipHomeListFetchOnceRef.current = false;
      if (router.asPath && cars.length > 0) {
        setListingPageCache(HOME_LIST_CACHE_NS, router.asPath, {
          cars,
          total,
          cbr: catalogCbr,
          cbrError: catalogCbrError,
          brands: catalogBrands,
          listSort,
        });
      }
      if (!catalogBrands.length) {
        loadCatalogBrandsOnly();
      }
      return;
    }
    loadHomeCatalogParallel();
    // Намеренно только loadHomeCatalogParallel + isReady: skip срабатывает один раз
    // после Back; смена фильтров меняет колбэк и снова грузит ленту.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadHomeCatalogParallel, router.isReady]);

  const scrollRestorePathRef = useRef("");

  const tryRestoreHomeScroll = useCallback(() => {
    if (typeof window === "undefined" || !router.isReady || cars.length === 0) {
      return () => {};
    }
    if (scrollRestorePathRef.current === router.asPath) {
      return () => {};
    }
    scrollRestorePathRef.current = router.asPath;
    return scheduleListScrollRestore({
      storagePrefix: HOME_SCROLL_STORAGE_PREFIX,
      path: router.asPath,
      cardDataAttr: "data-home-car-id",
    });
  }, [router.isReady, router.asPath, cars.length]);

  // useLayoutEffect — позиция до paint, без заметного автоскролла.
  useLayoutEffect(() => {
    scrollRestorePathRef.current = "";
    return tryRestoreHomeScroll();
  }, [tryRestoreHomeScroll]);

  // Next.js после client transition часто скроллит наверх уже после mount —
  // повторяем restore на routeChangeComplete (мгновенно, без анимации).
  useEffect(() => {
    if (!router.isReady) return undefined;
    let cleanup = () => {};
    const handler = () => {
      cleanup();
      scrollRestorePathRef.current = "";
      cleanup = tryRestoreHomeScroll() || (() => {});
    };
    router.events.on("routeChangeComplete", handler);
    return () => {
      router.events.off("routeChangeComplete", handler);
      cleanup();
    };
  }, [router.events, router.isReady, tryRestoreHomeScroll]);

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
      if (job.status === "success" || job.status === "failed" || job.status === "cancelled") {
        setParserJobMessage(
          job.status === "success"
            ? job.type === "import_one"
              ? `Импорт выполнен: ${job.message || "готово"}`
              : "Парсер завершил работу. Каталог обновлён."
            : job.status === "cancelled"
              ? `Задача остановлена: ${job.message || "отменено пользователем"}`
              : `Парсер завершился с ошибкой: ${job.message || "см. логи"}`
        );
        loadHomeCatalogParallel();
        loadWhitelistCatalog(token);
      }
    };
    tick();
    const t = setInterval(tick, 1500);
    return () => clearInterval(t);
  }, [token, latestParserJob?.id, latestParserJob?.status, loadHomeCatalogParallel]);

  return (
    <>
      <Head>
        <title>Доставка автомобилей из Китая и Кореи в Россию | Автовозом</title>
        <meta
          name="description"
          content="Каталог авто из Китая и Кореи с расчётом под ключ до РФ. Подбор, выкуп, доставка — смотрите цены в ¥ и ориентир в рублях, оставьте заявку."
        />
        <link rel="canonical" href={absoluteUrl("/")} />
        <meta property="og:title" content="Доставка автомобилей из Китая и Кореи в Россию | Автовозом" />
        <meta
          property="og:description"
          content="Каталог авто из Китая и Кореи с расчётом под ключ до РФ. Подбор, выкуп, доставка — смотрите цены и оставьте заявку."
        />
        <meta property="og:url" content={absoluteUrl("/")} />
        <script {...jsonLdScriptProps(organizationAndWebSiteJsonLd())}></script>
      </Head>
      <div className="layout layout--home">
      <header className="site-header site-header--home">
        {/* —— Mobile header —— */}
        <div className="container site-header__inner home-only-mobile">
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
          <div className="site-header__brand">
            <SiteLogo />
            <span className="site-tagline">Доставка автомобилей из Китая и Кореи</span>
          </div>
          <div className="auth-bar">
            <Link href="/customs-calculator" className="site-header-calc-link">
              Калькулятор растаможки
            </Link>
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
          </div>
        </div>

        {/* —— Desktop header (mockup 36) —— */}
        <div className="container site-header__inner home-d-header home-only-desktop">
          <SiteLogo />
          <nav className="home-d-nav" aria-label="Основная навигация">
            <Link href="/catalog">Каталог</Link>
            <Link href="/customs-calculator">Калькулятор</Link>
            <Link href="/faq">FAQ</Link>
          </nav>
          <div className="home-d-header__actions">
            <HeaderMessagesLink token={token} />
            <HeaderFavoritesLink token={token} />
            {!token ? (
              <>
                <Link href="/auth" className="btn home-d-btn-login">
                  Войти
                </Link>
                <Link href="/auth" className="btn home-d-btn-register">
                  Регистрация
                </Link>
              </>
            ) : (
              <>
                <HeaderProfileLink token={token} me={me} />
                {canCreateListings(me?.role) ? (
                  <Link href="/staff/new-listing" className="btn btn-primary btn-sm home-d-btn-cta">
                    Добавить объявление
                  </Link>
                ) : null}
              </>
            )}
          </div>
        </div>

        {mobileHeaderMenuOpen ? (
          <div className="site-header-mobile-menu-wrap home-only-mobile">
            <button
              type="button"
              className="site-header-mobile-menu__backdrop"
              aria-label="Закрыть меню"
              onClick={() => setMobileHeaderMenuOpen(false)}
            />
            <div className="container site-header-mobile-menu__container">
              <nav className="site-header-mobile-menu" aria-label="Меню сайта">
                <Link href="/catalog" className="site-header-mobile-menu__link">
                  Каталог
                </Link>
                <Link href="/customs-calculator" className="site-header-mobile-menu__link">
                  Калькулятор растаможки
                </Link>
                <Link href="/dostavka-avto-iz-kitaya" className="site-header-mobile-menu__link">
                  Доставка авто из Китая
                </Link>
                <Link href="/dostavka-avto-iz-korei" className="site-header-mobile-menu__link">
                  Доставка авто из Кореи
                </Link>
                <Link href="/faq" className="site-header-mobile-menu__link">
                  Частые вопросы
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
                    <Link href="/favorites" className="site-header-mobile-menu__link">
                      Избранное
                    </Link>
                    {canCreateListings(me?.role) ? (
                      <Link href="/staff/new-listing" className="site-header-mobile-menu__link">
                        Добавить объявление
                      </Link>
                    ) : null}
                  </>
                )}
              </nav>
            </div>
          </div>
        ) : null}
      </header>

      <main className="site-main site-main--home">
        <div className="container">
          {/* ===================== MOBILE showcase (guest mockup) ===================== */}
          <div className="home-m home-only-mobile">
            <div className="home-m-top">
              <div className="home-m-top__row">
                <SiteLogo className="home-m-top__logo" />
                {!token ? (
                  <Link href="/auth" className="home-m-top__login">
                    Войти
                  </Link>
                ) : (
                  <div className="home-m-top__auth">
                    <HeaderMessagesLink token={token} />
                    <HeaderProfileLink token={token} me={me} />
                  </div>
                )}
              </div>
              <form className="home-m-search" onSubmit={onSearchSubmit} role="search">
                <span className="home-m-search__icon" aria-hidden>
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
                    <circle cx="11" cy="11" r="6.5" stroke="currentColor" strokeWidth="1.7" />
                    <path d="m16 16 4 4" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
                  </svg>
                </span>
                <input
                  className="home-m-search__input"
                  name="q"
                  placeholder="Марка, модель или VIN"
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  autoComplete="off"
                  aria-label="Поиск по каталогу"
                />
              </form>
              <div className="home-m-filters">
                <CatalogQuickFilters
                  brands={homeFilterBrandOptions}
                  models={homeFilterModelOptions}
                  draft={homeFilterDraft}
                  applied={homeFilterApplied}
                  onChangeDraft={setHomeFilterDraft}
                  onApply={applyHomeQuickFilters}
                  applyLabel="Показать"
                  applyOnSelect
                />
              </div>
            </div>

            <section className="home-m-hero" aria-label="Витрина">
              <p className="home-m-hero__eyebrow">Авто из Китая</p>
              <h1 className="home-m-hero__title">Весь путь автомобиля — под вашим контролем</h1>
              <p className="home-m-hero__subtitle">
                Проверенные китайские дилеры, сопровождение сделки и таможенное оформление в России.
                Весь процесс — в личном кабинете.
              </p>
              <div className="home-m-hero__cta-row">
                <Link href="/request-quote" className="btn btn-primary home-m-hero__cta">
                  Рассчитать
                </Link>
                <Link href="/catalog" className="btn home-m-hero__cta home-m-hero__cta--ghost">
                  Каталог
                </Link>
              </div>
            </section>

            {activeDeal ? (
              <div className="home-deal-card">
                <div className="home-deal-card__body">
                  <p className="home-deal-card__eyebrow">
                    {activeDeal.requestId != null ? `Ваша сделка · №${activeDeal.requestId}` : "Ваша сделка"}
                  </p>
                  <p className="home-deal-card__title">
                    {activeDeal.comment
                      ? String(activeDeal.comment).slice(0, 120)
                      : activeDeal.chatTitle}
                  </p>
                  {activeDeal.status ? (
                    <p className="home-deal-card__meta">
                      {activeDeal.status === "in_progress" ? "В работе" : "Принята — ждём расчёт"}
                    </p>
                  ) : null}
                </div>
                <Link
                  href={
                    activeDeal.chatId != null
                      ? `/messages?chat=${encodeURIComponent(String(activeDeal.chatId))}`
                      : "/messages"
                  }
                  className="btn btn-primary"
                >
                  Открыть чат сделки
                </Link>
              </div>
            ) : null}

            <div className="home-quick-tiles" role="navigation" aria-label="Быстрые действия">
              <Link href="/customs-calculator" className="home-quick-tile">
                <span className="home-quick-tile__icon" aria-hidden>
                  ₽
                </span>
                <span className="home-quick-tile__label">Калькулятор</span>
              </Link>
              <Link href="/request-quote" className="home-quick-tile">
                <span className="home-quick-tile__icon" aria-hidden>
                  ✎
                </span>
                <span className="home-quick-tile__label">Заявка</span>
              </Link>
              <Link href="/faq" className="home-quick-tile">
                <span className="home-quick-tile__icon" aria-hidden>
                  ?
                </span>
                <span className="home-quick-tile__label">FAQ</span>
              </Link>
            </div>

            {popularBrands.length > 0 ? (
              <section className="home-m-brands" aria-label="Популярные марки">
                <div className="home-m-brands__head">
                  <h2 className="home-m-brands__title">Популярные марки</h2>
                </div>
                <div className="home-m-brands__scroller">
                  {popularBrands.map((b) => (
                    <Link
                      key={b.id}
                      href={`/catalog/${b.slug}`}
                      className="home-m-brands__tile"
                      title={b.name}
                    >
                      <img
                        src={mediaSrc(b.logo_storage_url)}
                        alt=""
                        width={40}
                        height={40}
                        loading="lazy"
                        decoding="async"
                        className="home-m-brands__logo"
                      />
                    </Link>
                  ))}
                </div>
              </section>
            ) : null}

            {popularCars.length > 0 ? (
              <section className="home-m-models" aria-label="Популярные модели">
                <div className="home-m-models__head">
                  <h2 className="home-m-models__title">Популярные модели</h2>
                  <Link href="/catalog" className="home-m-models__link">
                    Все
                  </Link>
                </div>
                <div className="home-m-models__scroller">
                  {popularCars.map((car) => (
                    <HomeCarCard
                      key={`m-pop-${car.id}`}
                      car={car}
                      variant="mobile"
                      className="home-m-models__card"
                      draggable={false}
                      onClickCapture={(e) => saveHomeScrollPosition(e, car.id)}
                    />
                  ))}
                </div>
              </section>
            ) : null}

            <section className="home-m-arrivals" aria-label="Последние поступления">
              <div className="home-m-arrivals__head">
                <h2 className="home-m-arrivals__title">Последние поступления</h2>
              </div>
              {cars.length === 0 ? (
                <div className="ui-state">
                  <p className="ui-state__title">Лотов пока нет</p>
                  <div className="ui-state__actions">
                    <Link href="/catalog" className="btn btn-secondary btn-sm">
                      Каталог
                    </Link>
                    <Link href="/request-quote" className="btn btn-primary btn-sm">
                      Заявка
                    </Link>
                  </div>
                </div>
              ) : (
                <div className="home-m-arrivals__list">
                  {cars.slice(0, HOME_FRESH_LOTS_LIMIT).map((car) => (
                    <HomeCarCard
                      key={`m-${car.id}`}
                      car={car}
                      variant="mobile"
                      draggable={false}
                      onClickCapture={(e) => saveHomeScrollPosition(e, car.id)}
                    />
                  ))}
                </div>
              )}
            </section>

            {!token ? (
              <aside className="home-m-auth-card">
                <h2 className="home-m-auth-card__title">Войдите, чтобы вести сделку</h2>
                <p className="home-m-auth-card__text">
                  Чат с менеджером, избранное, статусы доставки и документы — в личном кабинете.
                </p>
                <Link href="/auth" className="btn btn-primary home-m-auth-card__cta">
                  Войти или зарегистрироваться
                </Link>
              </aside>
            ) : null}
          </div>

          {/* ===================== DESKTOP showcase ===================== */}
          <div className="home-d home-only-desktop">
            <section className="home-d-hero" aria-label="Витрина">
              <p className="home-d-hero__eyebrow">Авто из Китая</p>
              <h1 className="home-d-hero__title">Весь путь автомобиля — под вашим контролем</h1>
              <p className="home-d-hero__subtitle">
                Проверенные китайские дилеры, сопровождение сделки и таможенное оформление в России.
                Весь процесс — в личном кабинете.
              </p>
              <form className="home-d-filters" onSubmit={onHeroFiltersSubmit}>
                <div className="home-d-filters__field">
                  <SiteSelectDropdown
                    className="site-dropdown--block"
                    label="Марка"
                    placeholder="Любая"
                    searchable
                    value={heroBrandId}
                    onChange={(v) => {
                      setHeroBrandId(v || "");
                      setHeroModelId("");
                    }}
                    options={[
                      { value: "", label: "Любая" },
                      ...sortedBrands.map((b) => ({ value: String(b.id), label: b.name })),
                    ]}
                  />
                </div>
                <div className="home-d-filters__field">
                  <SiteSelectDropdown
                    className="site-dropdown--block"
                    label="Модель"
                    placeholder={heroModelsBusy ? "Загрузка…" : "Любая"}
                    searchable
                    disabled={!heroBrandId || heroModelsBusy}
                    value={heroModelId}
                    onChange={(v) => setHeroModelId(v || "")}
                    options={[
                      { value: "", label: heroModelsBusy ? "Загрузка…" : "Любая" },
                      ...heroModels.map((m) => ({ value: String(m.id), label: m.name })),
                    ]}
                  />
                </div>
                <div className="home-d-filters__field">
                  <SiteSelectDropdown
                    className="site-dropdown--block"
                    label="Цена под ключ"
                    placeholder="Любая"
                    value={heroRubTo}
                    onChange={(v) => setHeroRubTo(v || "")}
                    options={HOME_PRICE_OPTIONS}
                  />
                </div>
                <div className="home-d-filters__field">
                  <SiteSelectDropdown
                    className="site-dropdown--block"
                    label="Тип топлива"
                    placeholder="Любая"
                    value={heroFuelType}
                    onChange={(v) => setHeroFuelType(v || "")}
                    options={HOME_FUEL_TYPE_OPTIONS}
                  />
                </div>
                <button type="submit" className="btn btn-primary home-d-filters__submit">
                  {showCountLabel}
                </button>
              </form>
              <div className="home-d-stats" aria-label="Цифры платформы">
                <div className="home-d-stats__metrics">
                  <div className="home-d-stats__item">
                    <strong>{total ? Number(total).toLocaleString("ru-RU") : "—"}</strong>
                    <span>авто в подборе</span>
                  </div>
                  <div className="home-d-stats__item">
                    <strong>6–8 нед.</strong>
                    <span>доставка</span>
                  </div>
                  <div className="home-d-stats__item">
                    <strong>0 ₽</strong>
                    <span>за расчёт и отчёты</span>
                  </div>
                </div>
                <Link href="/request-quote" className="btn home-d-stats__quote">
                  Рассчитать стоимость
                </Link>
              </div>
            </section>

            {popularBrands.length > 0 ? (
              <section className="home-d-brands" aria-label="Популярные марки">
                <div className="home-d-brands__head">
                  <h2 className="home-d-brands__title">Популярные марки</h2>
                </div>
                <BrandLogoMarquee brands={popularBrands} variant="home" />
              </section>
            ) : null}

            {activeDeal ? (
              <div className="home-deal-card home-deal-card--desktop">
                <div className="home-deal-card__body">
                  <p className="home-deal-card__eyebrow">
                    {activeDeal.requestId != null ? `Ваша сделка · №${activeDeal.requestId}` : "Ваша сделка"}
                  </p>
                  <p className="home-deal-card__title">
                    {activeDeal.comment
                      ? String(activeDeal.comment).slice(0, 120)
                      : activeDeal.chatTitle}
                  </p>
                </div>
                <Link
                  href={
                    activeDeal.chatId != null
                      ? `/messages?chat=${encodeURIComponent(String(activeDeal.chatId))}`
                      : "/messages"
                  }
                  className="btn btn-primary"
                >
                  Открыть чат сделки
                </Link>
              </div>
            ) : null}

            <section className="home-d-arrivals" aria-label="Последние поступления">
              <div className="home-d-arrivals__head">
                <h2 className="home-d-arrivals__title">Последние поступления</h2>
                <Link href="/catalog" className="home-d-arrivals__link">
                  В каталог
                </Link>
              </div>
              {desktopArrivals.length === 0 ? (
                <div className="ui-state">
                  <p className="ui-state__title">Лотов пока нет</p>
                  <div className="ui-state__actions">
                    <Link href="/catalog" className="btn btn-secondary btn-sm">
                      Каталог
                    </Link>
                    <Link href="/request-quote" className="btn btn-primary btn-sm">
                      Заявка
                    </Link>
                  </div>
                </div>
              ) : (
                <div className="home-d-carousel" role="list">
                  {desktopArrivals.map((car) => {
                    const totalRub = carTotalRub(car);
                    const title = carListingTitle(car);
                    const metaBits = carSpecMetaBits(car);
                    return (
                      <article
                        key={car.id}
                        className="catalog-card home-d-card"
                        role="listitem"
                        data-home-car-id={car.id}
                      >
                        <Link
                          href={listingCarHref(car)}
                          className="catalog-card__main home-d-card__main"
                          draggable={false}
                          onClickCapture={(e) => saveHomeScrollPosition(e, car.id)}
                        >
                          <CatalogCardMedia photos={car.photos} carId={car.id} car={car} />
                          <div className="catalog-card__content home-d-card__body">
                            <p className="home-d-card__price">
                              {totalRub != null ? (
                                <>
                                  <strong>{Math.round(totalRub).toLocaleString("ru-RU")} ₽</strong>
                                  <span>под ключ</span>
                                </>
                              ) : (
                                <strong>{Math.round(car.price_cny).toLocaleString("ru-RU")} ¥</strong>
                              )}
                            </p>
                            <p className="home-d-card__title">{title}</p>
                            {metaBits.length ? (
                              <p className="home-d-card__meta">{metaBits.join(" · ")}</p>
                            ) : null}
                          </div>
                        </Link>
                      </article>
                    );
                  })}
                </div>
              )}
            </section>

            <div className="home-d-steps-row">
              <section className="home-d-steps" aria-label="Как проходит покупка">
                <h2 className="home-d-steps__title">Как проходит покупка</h2>
                <div className="home-d-steps__grid">
                  <div className="home-d-steps__connector" aria-hidden />
                  {HOME_DEAL_STEPS.map((s, i) => (
                    <article key={s.n} className="home-d-step">
                      <span className="home-d-step__icon" aria-hidden>
                        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          {HOME_STEP_ICONS[i]}
                        </svg>
                      </span>
                      <p className="home-d-step__n">Шаг {s.n}</p>
                      <p className="home-d-step__title">{s.title}</p>
                      <p className="home-d-step__text">{s.text}</p>
                    </article>
                  ))}
                </div>
              </section>
              <aside className="home-d-steps-cta">
                <p className="home-d-steps-cta__title">Не нашли нужное авто?</p>
                <p className="home-d-steps-cta__text">
                  Оставьте заявку — подберём варианты у проверенных дилеров и подготовим расчёт.
                </p>
                <Link href="/request-quote" className="btn btn-primary home-d-steps-cta__btn">
                  Подобрать автомобиль
                </Link>
              </aside>
            </div>

            {popularCars.length > 0 ? (
              <section className="home-d-models" aria-label="Популярные модели">
                <div className="home-d-models__head">
                  <h2 className="home-d-models__title">Популярные модели</h2>
                  <Link href="/catalog" className="home-d-models__link">
                    Все модели
                  </Link>
                </div>
                <div className="home-d-carousel" role="list">
                  {popularCars.map((car) => (
                    <HomeCarCard
                      key={`pop-${car.id}`}
                      car={car}
                      variant="desktop"
                      role="listitem"
                      draggable={false}
                      onClickCapture={(e) => saveHomeScrollPosition(e, car.id)}
                    />
                  ))}
                </div>
              </section>
            ) : null}

            <section className="home-d-benefits" aria-label="Преимущества">
              {HOME_BENEFITS.map((b) => (
                <article key={b.title} className="home-d-benefit">
                  <span className="home-d-benefit__icon" aria-hidden>
                    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      {b.icon}
                    </svg>
                  </span>
                  <h3 className="home-d-benefit__title">{b.title}</h3>
                  <p className="home-d-benefit__text">{b.text}</p>
                </article>
              ))}
            </section>
          </div>

          <div className="home-only-mobile home-m-staff-gap" />

          <div className="toolbar toolbar--below-hero">
            {token && isStaffRole(me?.role) && (
              <button type="button" className="btn btn-secondary" onClick={runParser}>
                Обновить каталог (парсер)
              </button>
            )}
          </div>

          {/* Mobile listings live in home-m-arrivals; keep staff tools below. */}
          <div className="home-only-desktop">
            {/* spacer for desktop staff blocks alignment */}
          </div>

      {profileReady && isStaffRole(me?.role) && (
        <div className="alert alert--success">
          <b>Администратор:</b> у объявлений ниже доступно удаление из каталога.
        </div>
      )}

      {token && isStaffRole(me?.role) && (whitelistCatalog.length > 0 || isAdminRole(me?.role)) && (
        <section className="panel admin-parser-panel">
          <h2 className="section-title panel-heading-sm">Импорт объявления</h2>
          <p className="muted" style={{ margin: "0 0 0.75rem", fontSize: "0.9rem" }}>
            Быстрый импорт одной ссылки. Для списка объявлений с обходом и ретраями —{" "}
            <Link href="/staff/import-plan">страница плана импорта</Link>.
          </p>
          {parserCatalogNotice ? (
            <p className="muted" style={{ margin: "0 0 0.75rem", fontSize: "0.9rem" }}>
              {parserCatalogNotice}
            </p>
          ) : null}
          <div className="admin-parser-picker admin-parser-picker--import">
            <div className="admin-parser-label">
              <SiteSelectDropdown
                className="site-dropdown--block"
                label="1. Площадка"
                placeholder="— Выберите площадку —"
                value={parserImportMarketplace}
                onChange={(v) => v && setParserImportMarketplace(v)}
                options={parserMarketplaceOptions}
              />
            </div>
            <div className="admin-parser-label">
              <SiteSelectDropdown
                className="site-dropdown--block"
                label="2. Марка"
                placeholder="— Выберите марку —"
                value={
                  isAdminRole(me?.role) && staffBrandsParser.length > 0
                    ? parserStaffBrandId != null
                      ? String(parserStaffBrandId)
                      : ""
                    : parserAdminBrand
                }
                searchable
                busy={parserCatalogBusy}
                onCreateFromSearch={isAdminRole(me?.role) ? (q) => addParserCatalogBrand(q) : undefined}
                createActionLabel="Добавить марку"
                onChange={(v) => {
                  if (!v) {
                    setParserAdminBrand("");
                    setParserAdminModelId(null);
                    setParserAdminGenId("");
                    return;
                  }
                  if (isAdminRole(me?.role) && staffBrandsParser.length > 0) {
                    const id = Number(v);
                    const row = staffBrandsParser.find((b) => b.id === id);
                    setParserAdminBrand(row?.name ?? "");
                    setParserAdminModelId(null);
                    setParserAdminGenId("");
                    return;
                  }
                  setParserAdminBrand(v);
                  setParserAdminModelId(null);
                  setParserAdminGenId("");
                }}
                options={[{ value: "", label: "— Выберите марку —" }, ...parserBrandDropdownOptions]}
              />
            </div>
            <div className="admin-parser-label">
              <SiteSelectDropdown
                className="site-dropdown--block"
                label="3. Модель"
                placeholder={
                  parserAdminBrand ? "— Выберите модель —" : "Сначала выберите марку"
                }
                disabled={!parserAdminBrand}
                searchable
                busy={parserCatalogBusy}
                onCreateFromSearch={
                  isAdminRole(me?.role) && parserAdminBrand
                    ? (q) => addParserCatalogModel(q)
                    : undefined
                }
                createActionLabel="Добавить модель"
                value={parserAdminModelId != null ? String(parserAdminModelId) : ""}
                onChange={(v) => {
                  setParserAdminModelId(v ? Number(v) : null);
                  setParserAdminGenId("");
                }}
                options={[
                  {
                    value: "",
                    label: parserAdminBrand ? "— Выберите модель —" : "Сначала выберите марку",
                  },
                  ...parserModelDropdownOptions,
                ]}
              />
            </div>
            {isAdminRole(me?.role) && parserAdminModelId != null ? (
              <div className="admin-parser-label">
                <SiteSelectDropdown
                  className="site-dropdown--block"
                  label="4. Поколение (необязательно)"
                  placeholder="— не выбрано —"
                  searchable
                  busy={parserCatalogBusy}
                  onCreateFromSearch={(q) => addParserCatalogGeneration(q)}
                  createActionLabel="Добавить поколение"
                  value={parserAdminGenId}
                  onChange={setParserAdminGenId}
                  options={[
                    { value: "", label: "— не выбрано —" },
                    ...parserGenDropdownOptions,
                  ]}
                />
              </div>
            ) : null}
            {parserAdminModelId != null ? (
              <>
                <label className="admin-parser-label">
                  <span className="admin-parser-label__text">
                    {isAdminRole(me?.role) ? "5." : "4."} Ссылка на объявление
                  </span>
                  <div className="input-with-clear-wrap">
                    <input
                      className="input input-with-clear"
                      type="url"
                      inputMode="url"
                      autoComplete="off"
                      placeholder={parserImportUrlPlaceholder}
                      value={catalogUrlDrafts[parserAdminModelId] ?? ""}
                      onChange={(e) =>
                        setCatalogUrlDrafts((prev) => ({
                          ...prev,
                          [parserAdminModelId]: e.target.value,
                        }))
                      }
                    />
                    {(catalogUrlDrafts[parserAdminModelId] || "").trim() ? (
                      <button
                        type="button"
                        className="input-with-clear__btn"
                        title="Очистить ссылку"
                        aria-label="Очистить ссылку"
                        onClick={() =>
                          setCatalogUrlDrafts((prev) => ({
                            ...prev,
                            [parserAdminModelId]: "",
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
              j.status === "cancelled" ? " parser-card--cancelled" : ""
            }${j.type === "import_one" && running ? " parser-card--import-running" : ""}`}
          >
            <div className="parser-card__head">
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
              {running ? (
                <button
                  type="button"
                  className="btn btn-secondary btn-sm parser-card__stop"
                  disabled={cancelParserBusy || j.cancel_requested}
                  onClick={() => cancelParserJob(j.id)}
                >
                  {cancelParserBusy ? "Остановка…" : j.cancel_requested ? "Останавливается…" : "Остановить"}
                </button>
              ) : null}
            </div>
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

      {(catalogCbr || catalogCbrError) && profileReady && isStaffRole(me?.role) ? (
        <p className="muted catalog-cbr-line">
          {catalogCbr ? (
            <>
              Расчётный курс на {catalogCbr.rate_date}: <b>1 ¥ = {catalogCbr.rub_per_cny.toFixed(2)} ₽</b>
            </>
          ) : (
            <>Расчётный курс недоступен ({catalogCbrError || "ошибка"}).</>
          )}
        </p>
      ) : null}

      {profileReady && isStaffRole(me?.role) ? (
      <section className="catalog-section">
        <h2 className="section-title panel-heading-sm">Свежие лоты · админ</h2>
        {cars.length === 0 ? (
          <div className="ui-state">
            <p className="ui-state__title">Лотов пока нет</p>
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
            <article key={car.id} className="catalog-card" data-home-car-id={car.id}>
              <Link
                href={listingCarHref(car)}
                className="catalog-card__main"
                onClickCapture={(e) => saveHomeScrollPosition(e, car.id)}
              >
                <CatalogCardMedia photos={car.photos} carId={car.id} car={car} />
                <div className="catalog-card__content">
                  <h3 className="catalog-card__title">{car.title}</h3>
                  <p className="catalog-card__price">
                    {totalRub != null ? (
                      <>
                        <strong className="catalog-price-rub">
                          {Math.round(totalRub).toLocaleString("ru-RU")} ₽
                        </strong>
                        <span className="text-muted catalog-price-sub">под ключ</span>
                      </>
                    ) : (
                      <>
                        {Math.round(car.price_cny).toLocaleString("ru-RU")} ¥
                      </>
                    )}
                  </p>
                </div>
              </Link>
              <div className="catalog-card__actions">
                <div className="catalog-card__admin">
                  <span className="catalog-card__admin-label">Администратор</span>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                    {isAdminRole(me?.role) ? (
                      <>
                        <Link href={`/staff/publish-telegram/${car.id}`} className="btn btn-secondary btn-sm">
                          В Telegram
                        </Link>
                        <Link href={`/staff/publish-vk/${car.id}`} className="btn btn-secondary btn-sm">
                          В VK
                        </Link>
                        <Link href={`/staff/publish-avito/${car.id}`} className="btn btn-secondary btn-sm">
                          На Avito
                        </Link>
                      </>
                    ) : null}
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
                </div>
              </div>
            </article>
            );
          })}
        </div>
        )}
      </section>
      ) : null}

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

          <Link href="/messages" className="home-d-consult home-only-desktop">
            <span className="home-d-consult__icon" aria-hidden>
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
                <path
                  d="M4 6.5A2.5 2.5 0 0 1 6.5 4h11A2.5 2.5 0 0 1 20 6.5v8A2.5 2.5 0 0 1 17.5 17H9l-4 3v-3.5A2.5 2.5 0 0 1 4 14.5v-8Z"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinejoin="round"
                />
              </svg>
            </span>
            <span className="home-d-consult__text">
              <strong>Есть вопрос?</strong>
              <span>Ответит менеджер в чате</span>
            </span>
          </Link>

        </div>
      </main>
    </div>
    </>
  );
}

/**
 * SSR витрины: марки + свежие лоты. Listing-query с `/` уводим на `/catalog`.
 */
export async function getServerSideProps({ query }) {
  if (homeHasListingQuery(query)) {
    const params = new URLSearchParams();
    for (const [key, raw] of Object.entries(query || {})) {
      if (raw == null) continue;
      const values = Array.isArray(raw) ? raw : [raw];
      for (const v of values) {
        if (String(v).trim() === "") continue;
        params.append(key, String(v));
      }
    }
    const qs = params.toString();
    return {
      redirect: {
        destination: qs ? `/catalog?${qs}` : "/catalog",
        permanent: false,
      },
    };
  }

  const api = getServerApiBase();
  const params = new URLSearchParams();
  params.set("photo_limit", "8");
  params.set("limit", String(HOME_FRESH_LOTS_LIMIT));
  params.set("sort", "date_desc");

  const popularParams = new URLSearchParams();
  popularParams.set("is_popular", "true");
  popularParams.set("photo_limit", "8");
  popularParams.set("limit", String(HOME_POPULAR_CARS_LIMIT));
  popularParams.set("sort", "date_desc");

  let brands = [];
  let cars = [];
  let popularCars = [];
  let total = 0;
  let cbr = null;
  let cbrError = null;
  let tree = [];
  try {
    const [bRes, cRes, pRes, tRes] = await Promise.all([
      fetch(`${api}/catalog/brands`, { headers: { Accept: "application/json" } }),
      fetch(`${api}/cars?${params.toString()}`, { headers: { Accept: "application/json" } }),
      fetch(`${api}/cars?${popularParams.toString()}`, { headers: { Accept: "application/json" } }),
      fetch(`${api}/catalog/tree`, { headers: { Accept: "application/json" } }),
    ]);
    if (bRes.ok) brands = await bRes.json();
    if (cRes.ok) {
      const d = await cRes.json();
      cars = d.items || [];
      total = Number(d.total) || 0;
      cbr = d.cbr || null;
      cbrError = d.cbr_error || null;
    }
    if (pRes.ok) {
      const p = await pRes.json();
      popularCars = p.items || [];
    }
    if (tRes.ok) {
      const t = await tRes.json();
      tree = Array.isArray(t) ? t : [];
    }
  } catch {
    /* API недоступен на сервере — клиент догрузит */
  }

  return {
    props: {
      initialData: {
        brands,
        cars,
        popularCars,
        total,
        cbr,
        cbrError,
        tree: trimCatalogTreeForSsr(tree),
        treeComplete: false,
        listSort: "date_desc",
      },
    },
  };
}
