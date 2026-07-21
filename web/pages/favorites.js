import Head from "next/head";
import Link from "next/link";
import { useRouter } from "next/router";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

import CatalogCardMedia from "../components/CatalogCardMedia";
import HeaderFavoritesLink from "../components/HeaderFavoritesLink";
import HeaderMessagesLink from "../components/HeaderMessagesLink";
import HeaderProfileLink from "../components/HeaderProfileLink";
import TelegramChannelHeaderLink from "../components/TelegramChannelHeaderLink";
import {
  ensureFreshAccessToken,
  getStoredToken,
  hasPinLock,
  lockApp,
  resolveAuthSessionFailure,
  tryRefreshAccessToken,
} from "../lib/auth";
import { listingCarHref } from "../lib/carRoutes";
import { scheduleListScrollRestore } from "../lib/listScrollRestore";
import {
  clearListingPageCache,
  getListingPageCache,
  setListingPageCache,
} from "../lib/listingPageCache";
import { isListingBackNavigation, saveListingReturnPath, markScrollRestoreTarget } from "../lib/listingNavigation";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";
const FAVORITES_SCROLL_STORAGE_PREFIX = "avt_favorites_scroll:";
const FAVORITES_LIST_CACHE_NS = "favorites";
const FAVORITES_CACHE_KEY = "default";

function readFavoritesCacheSeed() {
  if (typeof window === "undefined") return null;
  if (!isListingBackNavigation("/favorites") && !isListingBackNavigation(window.location.pathname)) {
    return null;
  }
  const cached = getListingPageCache(FAVORITES_LIST_CACHE_NS, FAVORITES_CACHE_KEY);
  if (!cached?.cars) return null;
  return cached;
}

export default function FavoritesPage() {
  const router = useRouter();
  const cacheSeed = readFavoritesCacheSeed();
  const skipFavoritesFetchOnceRef = useRef(Boolean(cacheSeed));
  const [token, setToken] = useState(cacheSeed?.token ?? "");
  const [me, setMe] = useState(cacheSeed?.me ?? null);
  const [cars, setCars] = useState(cacheSeed?.cars ?? []);
  const [total, setTotal] = useState(cacheSeed?.total ?? 0);
  const [loading, setLoading] = useState(!cacheSeed);
  const [error, setError] = useState("");

  const saveFavoritesScrollPosition = useCallback(
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
      const card = event.currentTarget?.closest?.("[data-favorites-car-id]");
      const rect = card?.getBoundingClientRect?.();
      saveListingReturnPath(router.asPath);
      markScrollRestoreTarget(router.asPath);
      setListingPageCache(FAVORITES_LIST_CACHE_NS, FAVORITES_CACHE_KEY, {
        cars,
        total,
        token,
        me,
      });
      const storageKey = `${FAVORITES_SCROLL_STORAGE_PREFIX}${router.asPath}`;
      sessionStorage.setItem(
        storageKey,
        JSON.stringify({
          y: window.scrollY,
          carId,
          cardTop: rect ? rect.top : null,
          savedAt: Date.now(),
        })
      );
    },
    [router.asPath, cars, total, token, me]
  );

  const scrollRestorePathRef = useRef("");

  const tryRestoreFavoritesScroll = useCallback(() => {
    if (typeof window === "undefined" || !router.isReady || cars.length === 0) {
      return () => {};
    }
    if (scrollRestorePathRef.current === router.asPath) {
      return () => {};
    }
    scrollRestorePathRef.current = router.asPath;
    return scheduleListScrollRestore({
      storagePrefix: FAVORITES_SCROLL_STORAGE_PREFIX,
      path: router.asPath,
      cardDataAttr: "data-favorites-car-id",
    });
  }, [router.isReady, router.asPath, cars.length]);

  // useLayoutEffect — позиция до paint, без заметного автоскролла.
  useLayoutEffect(() => {
    scrollRestorePathRef.current = "";
    return tryRestoreFavoritesScroll();
  }, [tryRestoreFavoritesScroll]);

  // Next.js после client transition часто скроллит наверх уже после mount —
  // повторяем restore на routeChangeComplete (мгновенно, без анимации).
  useEffect(() => {
    if (!router.isReady) return undefined;
    let cleanup = () => {};
    const handler = () => {
      cleanup();
      scrollRestorePathRef.current = "";
      cleanup = tryRestoreFavoritesScroll() || (() => {});
    };
    router.events.on("routeChangeComplete", handler);
    return () => {
      router.events.off("routeChangeComplete", handler);
      cleanup();
    };
  }, [router.events, router.isReady, tryRestoreFavoritesScroll]);

  const loadFavorites = useCallback(async (accessToken) => {
    setLoading(true);
    setError("");
    const res = await fetch(
      `${API_URL}/favorites?limit=48&photo_limit=6&include_breakdown=false`,
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );
    if (!res.ok) {
      setError("Не удалось загрузить избранное.");
      setCars([]);
      setTotal(0);
      setLoading(false);
      clearListingPageCache(FAVORITES_LIST_CACHE_NS, FAVORITES_CACHE_KEY);
      return;
    }
    const data = await res.json();
    const nextCars = Array.isArray(data.items) ? data.items : [];
    const nextTotal = Number(data.total) || 0;
    setCars(nextCars);
    setTotal(nextTotal);
    setLoading(false);
    setListingPageCache(FAVORITES_LIST_CACHE_NS, FAVORITES_CACHE_KEY, {
      cars: nextCars,
      total: nextTotal,
      token: accessToken,
    });
  }, []);

  const bootstrap = useCallback(async () => {
    const reuseCachedList = skipFavoritesFetchOnceRef.current;
    if (reuseCachedList) {
      skipFavoritesFetchOnceRef.current = false;
      setLoading(false);
    } else {
      setLoading(true);
    }
    setError("");
    await ensureFreshAccessToken().catch(() => null);
    let access = getStoredToken();
    if (!access) {
      if (await hasPinLock()) {
        lockApp();
        window.dispatchEvent(new Event("avt-app-lock-changed"));
        setLoading(false);
        return;
      }
      router.replace(`/auth?next=${encodeURIComponent("/favorites")}`);
      return;
    }
    setToken(access);
    let res = await fetch(`${API_URL}/auth/me`, {
      headers: { Authorization: `Bearer ${access}` },
    });
    if (res.status === 401) {
      if (await tryRefreshAccessToken()) {
        access = getStoredToken();
        res = await fetch(`${API_URL}/auth/me`, {
          headers: { Authorization: `Bearer ${access}` },
        });
      }
    }
    if (!res.ok) {
      const kind = await resolveAuthSessionFailure();
      if (kind === "pin-lock") {
        setToken(getStoredToken());
        setLoading(false);
        return;
      }
      router.replace(`/auth?next=${encodeURIComponent("/favorites")}`);
      return;
    }
    const profile = await res.json();
    setMe(profile);
    setToken(access);
    setListingPageCache(FAVORITES_LIST_CACHE_NS, FAVORITES_CACHE_KEY, {
      me: profile,
      token: access,
    });
    if (reuseCachedList) {
      setLoading(false);
      return;
    }
    await loadFavorites(access);
  }, [router, loadFavorites]);

  useEffect(() => {
    bootstrap();
  }, [bootstrap]);

  useEffect(() => {
    const onTok = () => {
      const t = getStoredToken();
      if (t) bootstrap();
    };
    window.addEventListener("avt-token-changed", onTok);
    return () => window.removeEventListener("avt-token-changed", onTok);
  }, [bootstrap]);

  useEffect(() => {
    if (typeof window === "undefined" || !token) return undefined;
    const reload = () => {
      clearListingPageCache(FAVORITES_LIST_CACHE_NS, FAVORITES_CACHE_KEY);
      loadFavorites(token);
    };
    window.addEventListener("avt-favorites-changed", reload);
    return () => window.removeEventListener("avt-favorites-changed", reload);
  }, [token, loadFavorites]);

  return (
    <div className="layout">
      <Head>
        <title>Избранное — avtovozom</title>
        <meta name="robots" content="noindex" />
      </Head>
      <header className="site-header">
        <div className="container site-header__inner">
          <Link href="/" className="site-logo">
            avtovozom
          </Link>
          <div className="auth-bar">
            <HeaderMessagesLink token={token} />
            <HeaderProfileLink token={token} userRole={me?.role} />
            <HeaderFavoritesLink token={token} />
            <TelegramChannelHeaderLink />
          </div>
        </div>
      </header>
      <main className="site-main">
        <div className="container">
          <h1 className="section-title">Избранное</h1>
          <p className="muted favorites-page__lead">
            Сохранённые объявления. Нажмите на сердечко на карточке, чтобы убрать из списка.
          </p>
          {error ? <div className="alert alert--danger">{error}</div> : null}
          {loading ? (
            <p className="muted">Загрузка…</p>
          ) : cars.length === 0 ? (
            <div className="panel favorites-page__empty">
              <p className="muted">Пока нет объявлений в избранном.</p>
              <Link href="/catalog" className="btn btn-primary">
                Перейти в каталог
              </Link>
            </div>
          ) : (
            <>
              <p className="muted favorites-page__count">
                {total} {total === 1 ? "объявление" : total >= 2 && total <= 4 ? "объявления" : "объявлений"}
              </p>
              <section className="catalog-section">
                <div className="catalog-grid">
                  {cars.map((car) => {
                    const totalRub =
                      car.estimated_total_rub != null ? car.estimated_total_rub : null;
                    return (
                      <article key={car.id} className="catalog-card" data-favorites-car-id={car.id}>
                        <Link
                          href={listingCarHref(car)}
                          className="catalog-card__main"
                          onClickCapture={(e) => saveFavoritesScrollPosition(e, car.id)}
                        >
                          <CatalogCardMedia photos={car.photos} carId={car.id} car={car} />
                          <div className="catalog-card__content">
                            <h2 className="catalog-card__title">{car.title}</h2>
                            <p className="catalog-card__meta">
                              {car.brand} · <strong>{car.model}</strong>
                              {car.generation ? (
                                <>
                                  {" "}
                                  · <span className="catalog-card__generation">{car.generation}</span>
                                </>
                              ) : null}
                              {" "}
                              · {car.year}
                            </p>
                            <p className="catalog-card__price">
                              {totalRub != null ? (
                                <strong className="catalog-price-rub">
                                  {Math.round(totalRub).toLocaleString("ru-RU")} ₽
                                </strong>
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
                          <Link
                            href={listingCarHref(car)}
                            className="btn btn-secondary btn-sm"
                            onClickCapture={(e) => saveFavoritesScrollPosition(e, car.id)}
                          >
                            Открыть
                          </Link>
                        </div>
                      </article>
                    );
                  })}
                </div>
              </section>
            </>
          )}
        </div>
      </main>
    </div>
  );
}
