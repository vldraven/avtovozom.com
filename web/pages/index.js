import Head from "next/head";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/router";

import CatalogCardImageScrub from "../components/CatalogCardImageScrub";
import CatalogSortDropdown from "../components/CatalogSortDropdown";
import DealerOpenRequests from "../components/DealerOpenRequests";
import SiteSelectDropdown from "../components/SiteSelectDropdown";
import HeaderMessagesLink from "../components/HeaderMessagesLink";
import HeaderProfileLink from "../components/HeaderProfileLink";
import RequestConfirmModal from "../components/RequestConfirmModal";
import { clearToken, getStoredToken } from "../lib/auth";
import { publicCarHref } from "../lib/carRoutes";
import { canCreateListings, isAdminRole, isStaffRole } from "../lib/roles";
import { absoluteUrl } from "../lib/siteUrl";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

/** Иначе GET справочников может отдаваться из HTTP-кэша без только что созданной записи. */
const STAFF_GET_INIT = { cache: "no-store" };

const DEFAULT_REQUEST_COMMENT =
  "Нужен расчёт под ключ до РФ. Прошу уточнить сроки и стоимость доставки.";
const HOME_SCROLL_STORAGE_PREFIX = "avt_home_scroll:";

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

export default function Home() {
  const router = useRouter();
  const homePathRef = useRef("");
  const lastExplicitHomeScrollSaveRef = useRef({ path: "", at: 0 });
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
  /** Полный справочник марок/моделей для админа в виджете парсера */
  const [staffBrandsParser, setStaffBrandsParser] = useState([]);
  const [staffModelsParser, setStaffModelsParser] = useState([]);
  const [staffGensParser, setStaffGensParser] = useState([]);
  const [parserAdminGenId, setParserAdminGenId] = useState("");
  const [parserCatalogBusy, setParserCatalogBusy] = useState(false);
  const [parserCatalogNotice, setParserCatalogNotice] = useState("");
  const [importListingBusy, setImportListingBusy] = useState(false);
  /** Защита от гонки: ответ старого GET не перезаписывает список после POST+свежего GET. */
  const staffBrandsLoadGen = useRef(0);
  const staffModelsLoadGen = useRef(0);
  const staffGensLoadGen = useRef(0);
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
    params.set("photo_limit", "8");
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
      writeHomeScrollPosition(router.asPath, carId, rect ? rect.top : null);
      lastExplicitHomeScrollSaveRef.current = { path: router.asPath, at: Date.now() };
    },
    [router.asPath, writeHomeScrollPosition]
  );

  useEffect(() => {
    if (typeof window === "undefined" || !("scrollRestoration" in window.history)) return;
    const previous = window.history.scrollRestoration;
    window.history.scrollRestoration = "manual";
    return () => {
      window.history.scrollRestoration = previous;
    };
  }, []);

  useEffect(() => {
    if (!router.isReady) return;
    homePathRef.current = router.asPath;

    const saveCurrentHomeScroll = () => {
      const explicit = lastExplicitHomeScrollSaveRef.current;
      if (explicit.path === homePathRef.current && Date.now() - explicit.at < 1000) return;
      writeHomeScrollPosition(homePathRef.current);
    };

    router.events.on("routeChangeStart", saveCurrentHomeScroll);
    window.addEventListener("pagehide", saveCurrentHomeScroll);

    return () => {
      router.events.off("routeChangeStart", saveCurrentHomeScroll);
      window.removeEventListener("pagehide", saveCurrentHomeScroll);
    };
  }, [router.events, router.isReady, router.asPath, writeHomeScrollPosition]);

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
      const res = await fetch(`${API_URL}/catalog/brands`);
      if (res.ok) setCatalogBrands(await res.json());
    } catch {
      /* ignore */
    }
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

  const loadHomeCatalogParallel = useCallback(async () => {
    if (!router.isReady) {
      await loadCatalogBrandsOnly();
      return;
    }
    await Promise.all([loadCatalogBrandsOnly(), loadCars()]);
  }, [router.isReady, loadCatalogBrandsOnly, loadCars]);

  useEffect(() => {
    loadHomeCatalogParallel();
  }, [loadHomeCatalogParallel]);

  useEffect(() => {
    if (typeof window === "undefined" || !router.isReady || cars.length === 0) return;

    const storageKey = `${HOME_SCROLL_STORAGE_PREFIX}${router.asPath}`;
    const raw = sessionStorage.getItem(storageKey);
    if (!raw) return;

    let saved;
    try {
      saved = JSON.parse(raw);
    } catch {
      sessionStorage.removeItem(storageKey);
      return;
    }

    sessionStorage.removeItem(storageKey);
    const timeoutIds = [];
    let frameId = null;
    let nestedFrameId = null;

    const restore = () => {
      const fallbackY = Number(saved?.y);
      let targetY = Number.isFinite(fallbackY) ? fallbackY : 0;
      const savedCardTop = Number(saved?.cardTop);
      if (saved?.carId != null && Number.isFinite(savedCardTop)) {
        const card = document.querySelector(`[data-home-car-id="${String(saved.carId)}"]`);
        if (card) {
          card.scrollIntoView({ block: "center", behavior: "auto" });
          targetY = window.scrollY + card.getBoundingClientRect().top - savedCardTop;
        }
      }
      window.scrollTo({ top: Math.max(0, targetY), behavior: "auto" });
    };

    frameId = window.requestAnimationFrame(() => {
      nestedFrameId = window.requestAnimationFrame(() => {
        restore();
        [100, 300, 700, 1200].forEach((delay) => {
          timeoutIds.push(window.setTimeout(restore, delay));
        });
      });
    });

    return () => {
      if (frameId != null) window.cancelAnimationFrame(frameId);
      if (nestedFrameId != null) window.cancelAnimationFrame(nestedFrameId);
      timeoutIds.forEach((timeoutId) => window.clearTimeout(timeoutId));
    };
  }, [router.isReady, router.asPath, cars.length]);

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
        <title>Доставка автомобилей из Китая и Кореи в Россию | avtovozom</title>
        <meta
          name="description"
          content="Заказ автомобилей под ключ из Китая и Кореи: подбор марки и модели, выкуп, доставка в РФ, помощь с растаможкой и оценка ориентировочной цены в России."
        />
        <link rel="canonical" href={absoluteUrl("/")} />
        <meta property="og:title" content="Доставка автомобилей из Китая и Кореи в Россию | avtovozom" />
        <meta
          property="og:description"
          content="Заказ автомобилей под ключ из Китая и Кореи: подбор марки и модели, выкуп, доставка в РФ, помощь с растаможкой и оценка ориентировочной цены в России."
        />
        <meta property="og:url" content={absoluteUrl("/")} />
      </Head>
      <div className="layout">
      <header className="site-header">
        <div className="container site-header__inner">
          <button
            type="button"
            className="site-header__burger site-header__burger--desktop"
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
            <Link href="/" className="site-logo">
              avtovozom
            </Link>
            <span className="site-tagline">Доставка автомобилей из Китая и Кореи</span>
          </div>
          <button
            type="button"
            className="site-header__burger site-header__burger--mobile"
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
              <nav className="site-header-desktop-menu" aria-label="Меню сайта">
                <div className="site-header-desktop-menu__column">
                  <Link href="/catalog" className="site-header-desktop-menu__lead">
                    Каталог
                  </Link>
                  <Link href="/customs-calculator">Калькулятор растаможки</Link>
                  <Link href="/dostavka-avto-iz-kitaya">Доставка авто из Китая</Link>
                  <Link href="/dostavka-avto-iz-korei">Доставка авто из Кореи</Link>
                </div>
                <div className="site-header-desktop-menu__column">
                  <p className="site-header-desktop-menu__title">Покупателю</p>
                  <Link href="/catalog">Автомобили под заказ</Link>
                  <Link href="/request-quote">Заказать расчёт</Link>
                  <Link href="/customs-calculator">Рассчитать стоимость</Link>
                </div>
                <div className="site-header-desktop-menu__column">
                  <p className="site-header-desktop-menu__title">Направления</p>
                  <Link href="/dostavka-avto-iz-kitaya">Авто из Китая</Link>
                  <Link href="/dostavka-avto-iz-korei">Авто из Кореи</Link>
                </div>
                <div className="site-header-desktop-menu__column">
                  <p className="site-header-desktop-menu__title">Аккаунт</p>
                  {!token ? (
                    <Link href="/auth">Войти</Link>
                  ) : (
                    <>
                      <Link href="/profile">Профиль</Link>
                      {canCreateListings(me?.role) ? <Link href="/staff/new-listing">Добавить объявление</Link> : null}
                      <button type="button" className="site-header-desktop-menu__btn" onClick={logout}>
                        Выйти
                      </button>
                    </>
                  )}
                </div>
              </nav>
              <nav className="site-header-mobile-menu" aria-label="Меню сайта">
                <Link href="/customs-calculator" className="site-header-mobile-menu__link">
                  Калькулятор растаможки
                </Link>
                <Link href="/dostavka-avto-iz-kitaya" className="site-header-mobile-menu__link">
                  Доставка авто из Китая
                </Link>
                <Link href="/dostavka-avto-iz-korei" className="site-header-mobile-menu__link">
                  Доставка авто из Кореи
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
            <h1 className="home-hero__title">Доставка автомобилей из Китая и Кореи</h1>
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

            <div className="home-hero__delivery-links">
              <Link href="/dostavka-avto-iz-kitaya" className="btn btn-ghost btn-sm">
                Доставка авто из Китая
              </Link>
              <Link href="/dostavka-avto-iz-korei" className="btn btn-ghost btn-sm">
                Доставка авто из Кореи
              </Link>
            </div>

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

      {token && isStaffRole(me?.role) && (whitelistCatalog.length > 0 || isAdminRole(me?.role)) && (
        <section className="panel admin-parser-panel">
          <h2 className="section-title panel-heading-sm">Импорт объявления с che168</h2>
          {parserCatalogNotice ? (
            <p className="muted" style={{ margin: "0 0 0.75rem", fontSize: "0.9rem" }}>
              {parserCatalogNotice}
            </p>
          ) : null}
          <div className="admin-parser-picker admin-parser-picker--import">
            <div className="admin-parser-label">
              <SiteSelectDropdown
                className="site-dropdown--block"
                label="1. Марка"
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
                label="2. Модель"
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
                  label="3. Поколение (необязательно)"
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
                    {isAdminRole(me?.role) ? "4." : "3."} Ссылка на объявление che168
                  </span>
                  <div className="input-with-clear-wrap">
                    <input
                      className="input input-with-clear"
                      type="url"
                      inputMode="url"
                      autoComplete="off"
                      placeholder="https://www.che168.com/dealer/…/….html"
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
                href={publicCarHref(car)}
                className="catalog-card__main"
                target="_blank"
                rel="noopener noreferrer"
                onClickCapture={(e) => saveHomeScrollPosition(e, car.id)}
              >
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
                      {car.mileage_km != null
                        ? ` · ${Number(car.mileage_km).toLocaleString("ru-RU")} км`
                        : ""}
                      {car.engine_volume_cc ? ` · ${car.engine_volume_cc} см³` : ""}
                      {car.horsepower != null && car.horsepower > 0
                        ? ` · ${car.horsepower} л.с.`
                        : ""}
                      {car.fuel_type ? ` · ${car.fuel_type}` : ""}
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
                <Link
                  href={publicCarHref(car)}
                  className="btn btn-secondary btn-sm"
                  target="_blank"
                  rel="noopener noreferrer"
                  onClickCapture={(e) => saveHomeScrollPosition(e, car.id)}
                >
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
            );
          })}
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
