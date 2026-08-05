import Head from "next/head";
import Link from "next/link";
import { useRouter } from "next/router";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";

import Breadcrumbs from "./Breadcrumbs";
import CarPhotoLightbox from "./CarPhotoLightbox";
import HomeCarCard from "./HomeCarCard";
import ListingFavoriteButton from "./ListingFavoriteButton";
import ListingShareActions from "./ListingShareActions";
import RequestConfirmModal from "./RequestConfirmModal";
import SiteHeaderDesktopNav from "./SiteHeaderDesktopNav";
import TrimConfigModal from "./TrimConfigModal";
import { fetchAuthMe, getStoredToken, resolveAuthSessionFailure } from "../lib/auth";
import { publicCarHref } from "../lib/carRoutes";
import {
  consumeListingReturnPath,
  handleListingDetailRouteChangeStart,
  peekListingReturnPath,
} from "../lib/listingNavigation";
import { mediaSrc } from "../lib/media";
import MediaImage from "./MediaImage";
import { absoluteUrl } from "../lib/siteUrl";
import { seoDescription } from "../lib/seoText";
import { breadcrumbListJsonLd, jsonLdScriptProps } from "../lib/schema";
import { canCreateListings, isAdminRole, isStaffRole } from "../lib/roles";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

const DEFAULT_REQUEST_COMMENT =
  "Нужен расчёт под ключ до РФ. Прошу уточнить сроки и стоимость доставки.";
const DEFAULT_CHAT_COMMENT = "Хочу уточнить по этому авто в чате — без обязательств.";

const TRUST_CHECKS = [
  {
    title: "Отчет о состоянии авто",
    meta: "Состояние ЛКП, салон, приборы",
    metaDesktop: "Состояние ЛКП, салон, приборы",
    action: "По заявке",
    actionKind: "request",
  },
  {
    title: "История авто в Китае",
    meta: "Пробег по АТС, владельцы, ДТП",
    metaDesktop: "Пробег по АТС, владельцы, ДТП",
    action: "По заявке",
    actionKind: "request",
  },
  {
    title: "Видео-осмотр по запросу",
    meta: "Живой обход авто на площадке",
    metaDesktop: "Живой обход авто на площадке",
    action: "По заявке",
    actionKind: "request",
  },
  {
    title: "Онлайн-трекинг доставки",
    meta: "Статус и файлы — в чате сделки",
    metaDesktop: "Статус и файлы — в чате сделки",
    action: "После сделки",
    actionKind: "muted",
  },
];

const DESKTOP_THUMB_SLOTS = 4;
const CUSTOMS_BREAKDOWN_KEYS = ["clearance_fee", "duty", "utilization_fee"];

function sumBreakdownKeys(components, keys) {
  const set = new Set(keys);
  return (components || [])
    .filter((item) => set.has(item.key))
    .reduce((acc, item) => acc + Number(item.amount_rub || 0), 0);
}

/** Строки детализации цены: labels из API (админка), таможенные — группой с подытогом. */
function buildBreakdownDisplayRows(components) {
  if (!components?.length) return [];
  const customsKeys = new Set(CUSTOMS_BREAKDOWN_KEYS);
  const rows = [];
  let customsInserted = false;
  for (const item of components) {
    if (customsKeys.has(item.key)) {
      if (!customsInserted) {
        const children = components.filter((c) => customsKeys.has(c.key));
        rows.push({
          type: "group",
          key: "customs",
          label: "Таможенные платежи",
          amount: sumBreakdownKeys(components, CUSTOMS_BREAKDOWN_KEYS),
          children: children.map((c) => ({
            key: c.key,
            label: c.label,
            amount: c.amount_rub,
          })),
        });
        customsInserted = true;
      }
      continue;
    }
    rows.push({
      type: "row",
      key: item.key,
      label: item.label,
      amount: item.amount_rub,
    });
  }
  return rows;
}

function formatRubInt(n) {
  if (n == null || Number.isNaN(Number(n))) return "—";
  return Math.round(Number(n)).toLocaleString("ru-RU");
}

function trimParamItems(trim) {
  const out = [];
  for (const sec of trim?.param_sections || []) {
    for (const item of sec.items || []) {
      if (item?.name && item?.value) out.push(item);
    }
  }
  return out;
}

function pickTrimParam(trim, name) {
  return trimParamItems(trim).find((it) => it.name === name);
}

function formatRuDate(iso) {
  if (!iso) return null;
  const m = String(iso).match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return iso;
  return `${m[3]}.${m[2]}.${m[1]}`;
}

/** Дата регистрации в карточке: MM.YYYY (макет 03/34). */
function formatRuMonthYear(iso) {
  if (!iso) return null;
  const m = String(iso).match(/^(\d{4})-(\d{2})/);
  if (!m) return iso;
  return `${m[2]}.${m[1]}`;
}

/** Не показываем «поколение», если в данных заглушка вроде «Поколение не указано». */
function hasMeaningfulGeneration(gen) {
  const s = (gen == null ? "" : String(gen)).trim();
  if (!s) return false;
  const low = s.toLowerCase();
  if (low === "поколение не указано" || low === "не указано") return false;
  return true;
}

/**
 * @param {{ carId: string, pathBrandSlug?: string | null, pathModelSlug?: string | null }} props
 */
export default function CarDetailView({
  carId,
  pathBrandSlug = null,
  pathModelSlug = null,
  initialCar = null,
}) {
  const router = useRouter();
  const [car, setCar] = useState(initialCar);
  const [error, setError] = useState("");
  const [activePhoto, setActivePhoto] = useState(0);
  const [authError, setAuthError] = useState("");
  const [token, setToken] = useState("");
  const [me, setMe] = useState(null);
  const [profileReady, setProfileReady] = useState(false);
  const [requestModalOpen, setRequestModalOpen] = useState(false);
  const [requestModalComment, setRequestModalComment] = useState("");
  const [requestModalBusy, setRequestModalBusy] = useState(false);
  const [requestOkMessage, setRequestOkMessage] = useState("");
  const [photoLightboxOpen, setPhotoLightboxOpen] = useState(false);
  const [photoLightboxIndex, setPhotoLightboxIndex] = useState(0);
  const [similarCars, setSimilarCars] = useState([]);
  const [similarError, setSimilarError] = useState("");
  const [trimModalOpen, setTrimModalOpen] = useState(false);
  const [breakdownExpanded, setBreakdownExpanded] = useState(false);
  const galleryTouchRef = useRef(null);
  const gallerySwipedRef = useRef(false);

  const isListingOwner =
    car != null &&
    me != null &&
    car.created_by_user_id != null &&
    Number(car.created_by_user_id) === Number(me.id);
  const canEditThisListing =
    me != null &&
    (isAdminRole(me.role) || (canCreateListings(me.role) && isListingOwner));

  const sortedPhotos = useMemo(() => {
    if (!car?.photos) return [];
    return [...car.photos].sort((a, b) => a.sort_order - b.sort_order);
  }, [car]);

  const nPhotos = sortedPhotos.length;
  const safeIndex = nPhotos ? Math.min(activePhoto, nPhotos - 1) : 0;
  const hero = sortedPhotos[safeIndex];
  const trimEngine = pickTrimParam(car?.trim, "Двигатель");
  const trimDrive = pickTrimParam(car?.trim, "Привод");
  const driveDisplay = (car?.drive_type || "").trim() || trimDrive?.value || "—";
  const breakdownRows = useMemo(
    () => buildBreakdownDisplayRows(car?.price_breakdown?.components),
    [car?.price_breakdown?.components]
  );

  const engineLabel = useMemo(() => {
    if (!car) return "—";
    return (
      trimEngine?.value ||
      (car.engine_volume_cc ? `${car.engine_volume_cc.toLocaleString("ru-RU")} см³` : null) ||
      car.fuel_type ||
      "—"
    );
  }, [car, trimEngine]);

  const powerLabel = useMemo(() => {
    if (!car) return "—";
    return car.horsepower != null && car.horsepower > 0
      ? `${car.horsepower.toLocaleString("ru-RU")} л.с.`
      : "—";
  }, [car]);

  const mileageLabel = useMemo(() => {
    if (!car) return "—";
    return car.mileage_km ? `${car.mileage_km.toLocaleString("ru-RU")} км` : "—";
  }, [car]);

  const registrationLabel = useMemo(() => {
    if (!car) return "—";
    return formatRuMonthYear(car.registration_date) || "—";
  }, [car]);

  const stockBadge = useMemo(() => {
    if (!car) return "Под заказ";
    const city = String(car.location_city || "").trim();
    return city ? `Под заказ · ${city}` : "Под заказ";
  }, [car]);

  const thumbSlots = useMemo(() => {
    if (!nPhotos) return { visible: [], overflow: 0 };
    const visible = sortedPhotos.slice(0, DESKTOP_THUMB_SLOTS);
    const overflow = Math.max(0, nPhotos - DESKTOP_THUMB_SLOTS);
    return { visible, overflow };
  }, [sortedPhotos, nPhotos]);

  const onGalleryTouchStart = useCallback((e) => {
    if (nPhotos <= 1 || e.touches.length !== 1) return;
    gallerySwipedRef.current = false;
    galleryTouchRef.current = {
      x: e.touches[0].clientX,
      y: e.touches[0].clientY,
    };
  }, [nPhotos]);

  const onGalleryTouchEnd = useCallback(
    (e) => {
      const start = galleryTouchRef.current;
      galleryTouchRef.current = null;
      if (!start || nPhotos <= 1 || e.changedTouches.length !== 1) return;
      const dx = e.changedTouches[0].clientX - start.x;
      const dy = e.changedTouches[0].clientY - start.y;
      if (Math.abs(dx) < 40 || Math.abs(dx) < Math.abs(dy)) return;
      gallerySwipedRef.current = true;
      if (dx > 0) {
        setActivePhoto((i) => Math.max(0, i - 1));
      } else {
        setActivePhoto((i) => Math.min(nPhotos - 1, i + 1));
      }
    },
    [nPhotos]
  );

  const openGalleryLightbox = useCallback(() => {
    if (gallerySwipedRef.current) {
      gallerySwipedRef.current = false;
      return;
    }
    setPhotoLightboxIndex(safeIndex);
    setPhotoLightboxOpen(true);
  }, [safeIndex]);

  const keySpecRows = useMemo(() => {
    if (!car) return [];
    return [
      { label: "Двигатель", value: engineLabel },
      { label: "Мощность", value: powerLabel },
      { label: "Дата регистрации", value: registrationLabel },
      { label: "Топливо", value: car.fuel_type || "—" },
      { label: "Пробег", value: mileageLabel },
      { label: "Цвет кузова", value: car.body_color_label || "—" },
      { label: "Привод", value: driveDisplay },
      { label: "КПП", value: car.transmission || "—" },
    ];
  }, [car, engineLabel, powerLabel, registrationLabel, mileageLabel, driveDisplay]);

  const hasTrimConfig = Boolean(car?.trim?.sections?.length || car?.trim?.param_sections?.length);

  const priceCourseLine = useMemo(() => {
    if (!car || car.price_cny == null) return "";
    const cny = `${Math.round(Number(car.price_cny)).toLocaleString("ru-RU")} ¥`;
    const guide = car.pricing_guide;
    if (!guide?.cbr_date || guide.cbr_rub_per_cny == null) return cny;
    const dateLabel = formatRuDate(guide.cbr_date) || guide.cbr_date;
    const rate = Number(guide.cbr_rub_per_cny);
    const rateLabel = Number.isFinite(rate)
      ? rate.toLocaleString("ru-RU", { maximumFractionDigits: 2 })
      : String(guide.cbr_rub_per_cny);
    return `${cny} · курс на ${dateLabel}: 1 ¥ = ${rateLabel} ₽`;
  }, [car]);

  async function loadMe(accessToken) {
    if (!accessToken) return;
    const res = await fetch(`${API_URL}/auth/me`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok) return;
    const data = await res.json();
    setMe(data);
  }

  async function deleteListing() {
    setAuthError("");
    if (!token) {
      setAuthError("Нужно войти под администратором.");
      return;
    }
    if (!carId) return;
    if (!confirm("Удалить это объявление из каталога?")) return;
    const res = await fetch(`${API_URL}/admin/cars/${carId}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) {
      setAuthError("Не удалось удалить (нужны права администратора или модератора).");
      return;
    }
    router.push("/catalog");
  }

  function openRequestModal() {
    setAuthError("");
    setRequestOkMessage("");
    if (!token) {
      const next = car ? publicCarHref(car) : `/cars/${carId}`;
      router.push(`/request-quote?car_id=${carId}&next=${encodeURIComponent(next)}`);
      return;
    }
    setRequestModalOpen(true);
    setRequestModalComment(DEFAULT_REQUEST_COMMENT);
  }

  function openChatCta() {
    setAuthError("");
    setRequestOkMessage("");
    if (!token) {
      const path = car ? publicCarHref(car) : `/cars/${carId}`;
      const carLabel = car
        ? [car.brand, car.model].filter(Boolean).join(" ") + (car.year ? `, ${car.year}` : "")
        : `авто #${carId}`;
      const draft = `Здравствуйте! Хочу уточнить по авто: ${carLabel} — ${absoluteUrl(path)}`;
      router.push(`/messages?draft=${encodeURIComponent(draft)}`);
      return;
    }
    // Авторизован: без промежуточной модалки — сразу создаём заявку и уходим в чат.
    sendChatRequest();
  }

  async function sendChatRequest() {
    if (!token || !carId) return;
    try {
      const res = await fetch(`${API_URL}/requests`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ car_id: Number(carId), comment: DEFAULT_CHAT_COMMENT }),
      });
      if (res.status === 401) {
        const kind = await resolveAuthSessionFailure();
        setToken("");
        setMe(null);
        if (kind === "pin-lock") return;
        const next = car ? publicCarHref(car) : `/cars/${carId}`;
        router.push(`/request-quote?car_id=${carId}&next=${encodeURIComponent(next)}`);
        return;
      }
      if (res.status === 403) {
        const next = car ? publicCarHref(car) : `/cars/${carId}`;
        router.push(`/request-quote?car_id=${carId}&next=${encodeURIComponent(next)}`);
        return;
      }
      if (!res.ok) {
        setAuthError("Не удалось открыть чат. Попробуйте ещё раз.");
        return;
      }
      const body = await res.json().catch(() => ({}));
      const chatId = body.platform_chat_id;
      router.push(chatId != null ? `/messages?chat=${encodeURIComponent(String(chatId))}` : "/messages");
    } catch {
      setAuthError("Сбой связи с сервером. Попробуйте ещё раз.");
    }
  }

  function closeRequestModal() {
    if (requestModalBusy) return;
    setRequestModalOpen(false);
  }

  async function confirmRequestFromModal() {
    setAuthError("");
    setRequestOkMessage("");
    if (!token || !carId || !car) return;
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
          car_id: Number(carId),
          comment,
        }),
      });
      if (!res.ok) {
      if (res.status === 401) {
        const kind = await resolveAuthSessionFailure();
        setToken("");
        setMe(null);
        setRequestModalOpen(false);
        if (kind === "pin-lock") return;
        const next = car ? publicCarHref(car) : `/cars/${carId}`;
        router.push(`/request-quote?car_id=${carId}&next=${encodeURIComponent(next)}`);
        return;
      }
      if (res.status === 403) {
        setRequestModalOpen(false);
        const next = car ? publicCarHref(car) : `/cars/${carId}`;
        router.push(`/request-quote?car_id=${carId}&next=${encodeURIComponent(next)}`);
        return;
      }
        setAuthError("Не удалось отправить заявку. Попробуйте еще раз.");
        return;
      }
      setRequestModalOpen(false);
      const body = await res.json().catch(() => ({}));
      const chatId = body.platform_chat_id;
      if (chatId != null) {
        router.push(`/messages?chat=${encodeURIComponent(String(chatId))}`);
        return;
      }
      setRequestOkMessage("Заявка отправлена. Переписка — в разделе «Сообщения».");
    } finally {
      setRequestModalBusy(false);
    }
  }

  useEffect(() => {
    if (!carId) return;
    if (initialCar != null && String(initialCar.id) === String(carId)) {
      setCar(initialCar);
      return;
    }
    setCar((prev) => (prev != null && String(prev.id) !== String(carId) ? null : prev));
  }, [carId, initialCar]);

  useEffect(() => {
    if (!carId) return;
    if (initialCar != null && String(initialCar.id) === String(carId)) return;
    let cancelled = false;
    (async () => {
      setError("");
      const res = await fetch(`${API_URL}/cars/${carId}`);
      if (cancelled) return;
      if (!res.ok) {
        setError("Не удалось загрузить карточку автомобиля.");
        return;
      }
      const data = await res.json();
      if (cancelled) return;
      setCar(data);
    })();
    return () => {
      cancelled = true;
    };
  }, [carId, initialCar]);

  useEffect(() => {
    setSimilarCars([]);
    setSimilarError("");
  }, [carId]);

  useEffect(() => {
    if (!car?.id || car.price_cny == null) return;
    const c = Number(car.price_cny);
    if (!Number.isFinite(c) || c <= 0) return;
    const band = 0.15;
    const cnyFrom = Math.max(0, c * (1 - band));
    const cnyTo = c * (1 + band);
    let cancelled = false;
    setSimilarError("");
    (async () => {
      const params = new URLSearchParams({
        cny_from: String(Math.floor(cnyFrom)),
        cny_to: String(Math.ceil(cnyTo)),
        exclude_id: String(car.id),
        limit: "8",
        page: "1",
        include_breakdown: "false",
        sort: "date_desc",
        photo_limit: "6",
      });
      const res = await fetch(`${API_URL}/cars?${params.toString()}`);
      if (cancelled) return;
      if (!res.ok) {
        setSimilarCars([]);
        setSimilarError("Не удалось подобрать похожие объявления.");
        return;
      }
      const data = await res.json();
      if (cancelled) return;
      setSimilarCars(Array.isArray(data.items) ? data.items : []);
    })();
    return () => {
      cancelled = true;
    };
  }, [car?.id, car?.price_cny]);

  useEffect(() => {
    if (!car || !router.isReady || !carId) return;
    if (String(car.id) !== String(carId)) return;
    const bs = car.brand_slug;
    const ms = car.model_slug;
    if (!bs || !ms) return;
    const canonical = `/catalog/${bs}/${ms}/${car.id}`;
    const basePath = router.asPath.split("?")[0];
    if (basePath === canonical) return;
    if (pathBrandSlug != null && pathModelSlug != null) {
      if (pathBrandSlug !== bs || pathModelSlug !== ms) {
        router.replace(canonical);
      }
    }
  }, [car, carId, router, pathBrandSlug, pathModelSlug]);

  useLayoutEffect(() => {
    if (typeof window === "undefined") return;
    const html = document.documentElement;
    const previous = html.style.scrollBehavior;
    html.style.scrollBehavior = "auto";
    try {
      window.scrollTo({ top: 0, left: 0, behavior: "instant" });
    } catch {
      window.scrollTo(0, 0);
    }
    html.style.scrollBehavior = previous;
  }, [carId]);

  useEffect(() => {
    setActivePhoto(0);
  }, [car?.id]);

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

  useEffect(() => {
    if (!router.isReady) return undefined;

    const onRouteChangeStart = (url) => {
      handleListingDetailRouteChangeStart(url);
    };

    router.events.on("routeChangeStart", onRouteChangeStart);
    return () => {
      router.events.off("routeChangeStart", onRouteChangeStart);
    };
  }, [router.events, router.isReady]);

  useEffect(() => {
    function onKey(e) {
      if (nPhotos <= 1) return;
      if (e.key === "ArrowLeft") {
        e.preventDefault();
        setActivePhoto((i) => Math.max(0, i - 1));
      }
      if (e.key === "ArrowRight") {
        e.preventDefault();
        setActivePhoto((i) => Math.min(nPhotos - 1, i + 1));
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [nPhotos]);

  const catalogFallbackHref = useMemo(() => {
    if (!car) return "/catalog";
    if (car.brand_slug && car.model_slug) {
      return `/catalog/${car.brand_slug}/${car.model_slug}`;
    }
    return "/catalog";
  }, [car]);

  const handleBack = useCallback(() => {
    // Не consume до навигации и не consume при history.back():
    // иначе async popstate увидит пустой return path и раньше мог сбросить scroll-restore.
    // Target скролла чистится после успешного restore на списке.
    const returnPath = peekListingReturnPath();
    if (returnPath) {
      if (typeof window !== "undefined" && window.history.length > 1) {
        router.back();
      } else {
        router.push(returnPath, undefined, { scroll: false });
        consumeListingReturnPath();
      }
      return;
    }
    if (typeof window !== "undefined" && window.history.length > 1) {
      router.back();
      return;
    }
    router.push(catalogFallbackHref, undefined, { scroll: false });
  }, [router, catalogFallbackHref]);

  const detailBreadcrumbItems = useMemo(() => {
    if (!car) return [];
    const showGen = hasMeaningfulGeneration(car.generation);
    const genStep =
      showGen && car.generation_slug
        ? [
            {
              label: car.generation,
              href: `/catalog/${car.brand_slug}/${car.model_slug}/${car.generation_slug}`,
            },
          ]
        : [];
    if (car.brand_slug && car.model_slug) {
      return [
        { label: "Главная", href: "/" },
        { label: car.brand, href: `/catalog/${car.brand_slug}` },
        { label: car.model, href: `/catalog/${car.brand_slug}/${car.model_slug}` },
        ...genStep,
        { label: car.title || `Объявление №${car.id}` },
      ];
    }
    return [{ label: "Главная", href: "/" }, { label: car.title || `Объявление №${car.id}` }];
  }, [car]);

  if (error) {
    return (
      <div className="layout">
        <main className="site-main">
          <div className="container">
            <button type="button" className="detail-back" onClick={handleBack}>
              ← Назад
            </button>
            <p>
              <strong>{error}</strong>
            </p>
          </div>
        </main>
      </div>
    );
  }

  if (!car) {
    return (
      <div className="layout">
        <main className="site-main">
          <div className="container">
            <button type="button" className="detail-back" onClick={handleBack}>
              ← Назад
            </button>
            <p className="muted">Загрузка…</p>
          </div>
        </main>
      </div>
    );
  }

  const canonicalPath = publicCarHref(car);
  const canonical = absoluteUrl(canonicalPath);
  const metaDesc = seoDescription(
    car.description || `${car.brand} ${car.model}, ${car.year} год — цена в ¥, доставка в Россию.`
  );
  const ogImage = hero?.storage_url ? mediaSrc(hero.storage_url) : "";

  const totalRubRf =
    car.price_breakdown?.total_rub != null
      ? car.price_breakdown.total_rub
      : car.estimated_total_rub != null
        ? car.estimated_total_rub
        : null;

  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "Vehicle",
    name: car.title,
    brand: { "@type": "Brand", name: car.brand },
    model: car.model,
    ...(car.year ? { modelDate: `${car.year}-01-01` } : {}),
    ...(ogImage ? { image: [ogImage] } : {}),
    ...(totalRubRf != null
      ? {
          offers: {
            "@type": "Offer",
            priceCurrency: "RUB",
            price: Math.round(Number(totalRubRf)),
            availability: "https://schema.org/PreOrder",
            url: canonical,
          },
        }
      : {}),
  };

  return (
    <>
      <Head>
        <title>{`${car.title} — купить из Китая | avtovozom`}</title>
        <meta name="description" content={metaDesc} />
        <link rel="canonical" href={canonical} />
        <meta property="og:type" content="product" />
        <meta property="og:title" content={car.title} />
        <meta property="og:description" content={metaDesc} />
        <meta property="og:url" content={canonical} />
        {ogImage ? <meta property="og:image" content={ogImage} /> : null}
        <meta name="twitter:title" content={car.title} />
        <meta name="twitter:description" content={metaDesc} />
        {ogImage ? <meta name="twitter:image" content={ogImage} /> : null}
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
        />
        {detailBreadcrumbItems.length ? (
          <script {...jsonLdScriptProps(breadcrumbListJsonLd(detailBreadcrumbItems))} />
        ) : null}
      </Head>
      <div
        className={`layout layout--car-detail${
          me?.role !== "dealer" ? " layout--car-detail-cta" : ""
        }`}
      >
      <SiteHeaderDesktopNav active="catalog" token={token} me={me} />

      <main className="site-main site-main--car-detail">
        <div className="container">
          <div className="detail-top detail-top--desktop">
            {detailBreadcrumbItems.length ? (
              <Breadcrumbs className="breadcrumbs--car-detail" items={detailBreadcrumbItems} />
            ) : null}
          </div>

          <div className="detail-layout">
            <div className="detail-gallery">
              <div className="photo-gallery photo-gallery--lead">
                {hero?.storage_url ? (
                  <div
                    className="photo-gallery__stage-wrap photo-gallery__stage-wrap--openable"
                    role="button"
                    tabIndex={0}
                    onClick={openGalleryLightbox}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        openGalleryLightbox();
                      }
                    }}
                    onTouchStart={onGalleryTouchStart}
                    onTouchEnd={onGalleryTouchEnd}
                  >
                    <MediaImage
                      className="photo-gallery__stage"
                      src={mediaSrc(hero.storage_url)}
                      alt={`${car.title} — фото ${safeIndex + 1}`}
                      fill
                      sizes="(max-width: 767px) 100vw, 900px"
                      priority
                      draggable={false}
                      style={{ objectFit: "cover" }}
                    />
                    <button
                      type="button"
                      className="photo-gallery__back"
                      aria-label="Назад"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleBack();
                      }}
                    >
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                        <path
                          d="M15 5.5 8.5 12 15 18.5"
                          stroke="currentColor"
                          strokeWidth="2.25"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        />
                      </svg>
                    </button>
                    <span className="photo-gallery__stock" aria-hidden>
                      {stockBadge}
                    </span>
                    {nPhotos > 1 ? (
                      <>
                        <button
                          type="button"
                          className="photo-gallery__nav photo-gallery__nav--prev"
                          aria-label="Предыдущее фото"
                          disabled={safeIndex <= 0}
                          onClick={(e) => {
                            e.stopPropagation();
                            setActivePhoto((i) => Math.max(0, i - 1));
                          }}
                        >
                          ‹
                        </button>
                        <button
                          type="button"
                          className="photo-gallery__nav photo-gallery__nav--next"
                          aria-label="Следующее фото"
                          disabled={safeIndex >= nPhotos - 1}
                          onClick={(e) => {
                            e.stopPropagation();
                            setActivePhoto((i) => Math.min(nPhotos - 1, i + 1));
                          }}
                        >
                          ›
                        </button>
                        <div className="photo-gallery__counter">
                          {safeIndex + 1} / {nPhotos}
                        </div>
                      </>
                    ) : null}
                  </div>
                ) : (
                  <div className="photo-gallery__stage-wrap photo-gallery__stage-wrap--empty">
                    <button
                      type="button"
                      className="photo-gallery__back"
                      aria-label="Назад"
                      onClick={handleBack}
                    >
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                        <path
                          d="M15 5.5 8.5 12 15 18.5"
                          stroke="currentColor"
                          strokeWidth="2.25"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        />
                      </svg>
                    </button>
                    <span className="muted">Нет фотографий</span>
                  </div>
                )}
                {nPhotos > 0 ? (
                  <div className="photo-gallery__thumbs photo-gallery__thumbs--rail" aria-label="Миниатюры">
                    {thumbSlots.visible.map((photo, idx) => (
                      <button
                        key={photo.id}
                        type="button"
                        className={`photo-gallery__thumb ${idx === safeIndex ? "photo-gallery__thumb--active" : ""}`}
                        onClick={() => setActivePhoto(idx)}
                        aria-label={`Миниатюра ${idx + 1}`}
                      >
                        <MediaImage
                          src={mediaSrc(photo.storage_url)}
                          alt=""
                          width={96}
                          height={72}
                          loading="lazy"
                          style={{ objectFit: "cover", width: "100%", height: "100%" }}
                        />
                      </button>
                    ))}
                    {thumbSlots.overflow > 0 ? (
                      <button
                        type="button"
                        className="photo-gallery__thumb-more"
                        onClick={() => {
                          setPhotoLightboxIndex(DESKTOP_THUMB_SLOTS);
                          setPhotoLightboxOpen(true);
                        }}
                        aria-label={`Ещё ${thumbSlots.overflow} фото`}
                      >
                        +{thumbSlots.overflow}
                      </button>
                    ) : null}
                  </div>
                ) : null}
              </div>

              <CarPhotoLightbox
                open={photoLightboxOpen}
                onClose={(lastIdx) => {
                  setPhotoLightboxOpen(false);
                  if (typeof lastIdx === "number" && sortedPhotos.length) {
                    setActivePhoto(Math.min(sortedPhotos.length - 1, Math.max(0, lastIdx)));
                  }
                }}
                urls={sortedPhotos.map((p) => p.storage_url)}
                title={car.title}
                initialIndex={photoLightboxIndex}
              />
            </div>

            <aside className="detail-sidebar">
              <div className="detail-sidebar__card">
                <div className="detail-sidebar__hero">
                  <div className="detail-sidebar__hero-main">
                    <div className="detail-sidebar__price-block">
                      {totalRubRf != null ? (
                        <p className="detail-price detail-price--rf">
                          {formatRubInt(totalRubRf)} ₽
                        </p>
                      ) : (
                        <p className="detail-price">
                          {Math.round(car.price_cny).toLocaleString("ru-RU")} ¥
                        </p>
                      )}
                      {totalRubRf != null ? (
                        <p className="detail-price__hint detail-price__hint--block">
                          Под ключ до Москвы, с растаможкой
                        </p>
                      ) : null}
                    </div>

                    <h1 className="detail-title">{car.title}</h1>
                  </div>
                  <div className="detail-sidebar__hero-actions" aria-label="Избранное и поделиться">
                    <ListingFavoriteButton carId={car.id} car={car} />
                    <ListingShareActions car={car} totalRubRf={totalRubRf} />
                  </div>
                </div>

                {/* На мобилке характеристики в сайдбаре; на десктопе — только в блоке «Характеристики». */}
                <dl className="detail-facts" aria-label="Ключевые характеристики">
                  {keySpecRows.map((row) => (
                    <div className="detail-facts__item" key={row.label}>
                      <dt>{row.label}</dt>
                      <dd>{row.value}</dd>
                    </div>
                  ))}
                </dl>
                {hasTrimConfig ? (
                  <button
                    type="button"
                    className="btn btn-secondary detail-facts__trim-btn"
                    onClick={() => setTrimModalOpen(true)}
                  >
                    Полная комплектация
                  </button>
                ) : null}

                {car.has_public_dealer_profile && car.created_by_user_id ? (
                  <p className="detail-dealer-link muted">
                    <Link href={`/dealers/${car.created_by_user_id}`}>Профиль дилера</Link>
                  </p>
                ) : null}

                {car.rub_china == null ? (
                  <p className="detail-sidebar__note muted">
                    Пересчёт в рубли по расчётному курсу сейчас недоступен. В карточке указана ориентировочная цена в
                    юанях.
                  </p>
                ) : null}

                {me?.role !== "dealer" ? (
                  <div className="detail-cta-pair detail-cta-pair--sidebar">
                    <button type="button" className="btn btn-primary" onClick={openRequestModal}>
                      Оставить заявку
                    </button>
                    <button type="button" className="btn btn-outline-accent" onClick={openChatCta}>
                      Задать вопрос
                    </button>
                    <p className="detail-cta-pair__hint muted">
                      Вы можете оставить заявку на подбор и расчёт или задать свой вопрос в чате
                    </p>
                  </div>
                ) : null}

                {me?.role !== "dealer" && (requestOkMessage || authError) ? (
                  <div className="detail-hero-cta">
                    {requestOkMessage ? (
                      <div className="alert alert--success detail-hero-cta__message">{requestOkMessage}</div>
                    ) : null}
                    {authError ? <p className="muted detail-hero-cta__message">{authError}</p> : null}
                  </div>
                ) : null}

                <div className="detail-sidebar__actions detail-sidebar__actions--desktop">
                  <ListingFavoriteButton carId={car.id} car={car} variant="labeled" />
                  <ListingShareActions car={car} totalRubRf={totalRubRf} variant="labeled" />
                </div>

                {car.price_breakdown?.components?.length ? (
                  <div
                    className={`detail-breakdown${breakdownExpanded ? " detail-breakdown--expanded" : " detail-breakdown--collapsed"}`}
                  >
                    <button
                      type="button"
                      className="detail-breakdown__toggle"
                      aria-expanded={breakdownExpanded}
                      onClick={() => setBreakdownExpanded((v) => !v)}
                    >
                      <span className="detail-breakdown__toggle-text">
                        <span className="detail-breakdown__title">Детализация цены в России</span>
                        {priceCourseLine && !breakdownExpanded ? (
                          <span className="detail-breakdown__toggle-meta muted">{priceCourseLine}</span>
                        ) : null}
                      </span>
                      <span className="detail-breakdown__chevron" aria-hidden>
                        {breakdownExpanded ? "Свернуть" : "Показать"}
                      </span>
                    </button>
                    {breakdownExpanded ? (
                      <>
                        {priceCourseLine ? (
                          <p className="detail-calc-cny muted detail-calc-cny--compact">{priceCourseLine}</p>
                        ) : null}
                        <div className="price-breakdown-card price-breakdown-card--sidebar">
                          <div className="price-breakdown-card__rows price-breakdown-card__rows--summary">
                            {breakdownRows.map((row) =>
                              row.type === "group" ? (
                                <div className="price-breakdown-card__group" key={row.key}>
                                  <div className="price-breakdown-card__row">
                                    <div className="price-breakdown-card__label">{row.label}</div>
                                    <div className="price-breakdown-card__amount">{formatRubInt(row.amount)} ₽</div>
                                  </div>
                                  <div className="price-breakdown-card__subs">
                                    {row.children.map((child) => (
                                      <div className="price-breakdown-card__sub" key={child.key}>
                                        <span>{child.label}</span>
                                        <span>{formatRubInt(child.amount)} ₽</span>
                                      </div>
                                    ))}
                                  </div>
                                </div>
                              ) : (
                                <div className="price-breakdown-card__row" key={row.key}>
                                  <div className="price-breakdown-card__label">{row.label}</div>
                                  <div className="price-breakdown-card__amount">{formatRubInt(row.amount)} ₽</div>
                                </div>
                              )
                            )}
                          </div>
                          <div className="price-breakdown-card__total">
                            <span>Итого</span>
                            <strong>{formatRubInt(car.price_breakdown.total_rub)} ₽</strong>
                          </div>
                        </div>
                      </>
                    ) : (
                      <div className="detail-breakdown__summary">
                        <span>Итого в Москве</span>
                        <strong>{formatRubInt(car.price_breakdown.total_rub)} ₽</strong>
                      </div>
                    )}
                  </div>
                ) : car.rub_china != null ? (
                  <div className="detail-breakdown">
                    <h2 className="detail-breakdown__title">Детализация цены в России</h2>
                    {priceCourseLine ? <p className="detail-calc-cny muted">{priceCourseLine}</p> : null}
                  </div>
                ) : null}
              </div>

              {me?.role !== "dealer" ? (
                <section className="detail-seller-card detail-seller-card--sidebar" aria-label="Продавец">
                  <span className="detail-seller-card__avatar" aria-hidden>
                    AV
                  </span>
                  <div className="detail-seller-card__body">
                    <p className="detail-seller-card__name">Avtovozom</p>
                    <p className="detail-seller-card__tagline">Проверка, выкуп и доставка под ключ</p>
                  </div>
                </section>
              ) : null}

              {me?.role !== "dealer" ? (
                <section className="detail-consult-card" aria-label="ИИ-консультант">
                  <p className="detail-consult-card__title">Сомневаетесь?</p>
                  <p className="detail-consult-card__text">
                    Спросите ИИ-консультанта — ответит сразу, без регистрации.
                  </p>
                  <Link href="/messages" className="detail-consult-card__btn">
                    Открыть чат с ботом
                  </Link>
                </section>
              ) : null}
            </aside>

            <div className="detail-main">
              {profileReady && token && me && isStaffRole(me?.role) && (
                <div className="alert alert--danger">
                  <span style={{ fontWeight: 700, display: "block", marginBottom: 8 }}>
                    Управление объявлением
                  </span>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 10, alignItems: "center" }}>
                    {canEditThisListing && carId != null && (
                      <Link href={`/staff/edit-listing?id=${carId}`} className="btn btn-secondary">
                        Редактировать объявление
                      </Link>
                    )}
                    {isAdminRole(me.role) && carId != null && (
                      <>
                        <Link href={`/staff/publish-telegram/${carId}`} className="btn btn-secondary">
                          Пост в Telegram
                        </Link>
                        <Link href={`/staff/publish-vk/${carId}`} className="btn btn-secondary">
                          В VK
                        </Link>
                        <Link href={`/staff/publish-avito/${carId}`} className="btn btn-secondary">
                          На Avito
                        </Link>
                      </>
                    )}
                    <button type="button" className="btn btn-danger" onClick={deleteListing}>
                      Удалить из каталога
                    </button>
                  </div>
                </div>
              )}

              {profileReady && token && me && canCreateListings(me.role) && isListingOwner && !isStaffRole(me.role) && (
                <div className="alert alert--success">
                  <span style={{ fontWeight: 700, display: "block", marginBottom: 8 }}>Ваше объявление</span>
                  <Link href={`/staff/edit-listing?id=${carId}`} className="btn btn-secondary">
                    Редактировать объявление
                  </Link>
                </div>
              )}

              <section className="panel detail-panel detail-panel--specs">
                <h2 className="detail-panel__title">Характеристики</h2>
                <dl className="detail-spec-table">
                  {keySpecRows.map((row) => (
                    <div className="detail-spec-table__row" key={row.label}>
                      <dt>{row.label}</dt>
                      <dd>{row.value}</dd>
                    </div>
                  ))}
                </dl>
                {hasTrimConfig ? (
                  <div className="spec-trim-footer">
                    <button
                      type="button"
                      className="btn btn-secondary spec-trim-footer__btn"
                      onClick={() => setTrimModalOpen(true)}
                    >
                      Полная комплектация
                    </button>
                  </div>
                ) : null}
              </section>

              <section className="panel detail-panel detail-trust" aria-label="Что проверяем и показываем">
                <div className="detail-trust__head">
                  <h2 className="detail-panel__title">Что проверяем и показываем</h2>
                  <span className="detail-trust__pill">
                    <span className="detail-trust__pill-full">Бесплатно по заявке</span>
                    <span className="detail-trust__pill-short">Бесплатно</span>
                  </span>
                </div>
                <ul className="detail-trust__grid">
                  {TRUST_CHECKS.map((item) => (
                    <li key={item.title} className="detail-trust__card">
                      <div className="detail-trust__copy">
                        <strong>{item.title}</strong>
                        <span className="muted detail-trust__meta-desktop">{item.metaDesktop}</span>
                        <span className="muted detail-trust__meta-mobile">{item.meta}</span>
                      </div>
                      {item.actionKind === "photos" ? (
                        <button
                          type="button"
                          className="detail-trust__action"
                          onClick={() => {
                            setPhotoLightboxIndex(0);
                            setPhotoLightboxOpen(true);
                          }}
                        >
                          {item.action}
                        </button>
                      ) : item.actionKind === "request" ? (
                        <button type="button" className="detail-trust__action" onClick={openRequestModal}>
                          {item.action}
                        </button>
                      ) : (
                        <span className="detail-trust__action detail-trust__action--muted">{item.action}</span>
                      )}
                    </li>
                  ))}
                </ul>
              </section>

              {car.description ? (
                <section className="panel detail-panel detail-panel--desc">
                  <h2 className="detail-panel__title">Описание</h2>
                  <p className="description-text">{car.description}</p>
                </section>
              ) : null}

              {(similarError || similarCars.length > 0) && (
                <section className="car-detail-similar" aria-label="Рекомендуем в этой цене">
                  <div className="car-detail-similar__head">
                    <h2 className="detail-panel__title car-detail-similar__title">Рекомендуем в этой цене</h2>
                    <Link href="/catalog" className="car-detail-similar__link">
                      В каталог
                    </Link>
                  </div>
                  {similarError ? <p className="muted">{similarError}</p> : null}
                  {similarCars.length > 0 ? (
                    <div className="car-detail-similar__scroller">
                      {similarCars.map((c) => (
                        <HomeCarCard
                          key={c.id}
                          car={c}
                          variant="mobile"
                          className="home-m-models__card car-detail-similar__card"
                        />
                      ))}
                    </div>
                  ) : null}
                </section>
              )}

              {me?.role !== "dealer" ? (
                <section className="detail-seller-card detail-seller-card--mobile" aria-label="Продавец">
                  <span className="detail-seller-card__avatar" aria-hidden>
                    AV
                  </span>
                  <div className="detail-seller-card__body">
                    <p className="detail-seller-card__name">Avtovozom</p>
                    <p className="detail-seller-card__tagline">Проверка, выкуп и доставка под ключ</p>
                  </div>
                </section>
              ) : null}
            </div>
          </div>

          <RequestConfirmModal
            open={requestModalOpen && !!car}
            onClose={closeRequestModal}
            onConfirm={confirmRequestFromModal}
            busy={requestModalBusy}
            car={car}
            comment={requestModalComment}
            onCommentChange={setRequestModalComment}
          />
          <TrimConfigModal
            open={trimModalOpen}
            onClose={() => setTrimModalOpen(false)}
            car={car}
            onChat={me?.role !== "dealer" ? openChatCta : undefined}
          />
        </div>
      </main>
      {me?.role !== "dealer" && car ? (
        <div className="car-detail-cta-bar" role="region" aria-label="Действия с объявлением">
          <div className="container car-detail-cta-bar__inner">
            <div className="car-detail-cta-bar__cta-row">
              <button type="button" className="btn btn-primary car-detail-cta-bar__btn" onClick={openRequestModal}>
                Оставить заявку
              </button>
              <button
                type="button"
                className="btn btn-outline-accent car-detail-cta-bar__btn"
                onClick={openChatCta}
              >
                Задать вопрос
              </button>
            </div>
            <p className="car-detail-cta-bar__note">
              Вы можете оставить заявку на подбор и расчёт или задать свой вопрос в чате
            </p>
          </div>
        </div>
      ) : null}
    </div>
    </>
  );
}
