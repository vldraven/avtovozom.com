import Head from "next/head";
import Link from "next/link";
import { useRouter } from "next/router";
import { useCallback, useEffect, useState } from "react";

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
import { publicCarHref } from "../lib/carRoutes";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

export default function FavoritesPage() {
  const router = useRouter();
  const [token, setToken] = useState("");
  const [me, setMe] = useState(null);
  const [cars, setCars] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

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
      return;
    }
    const data = await res.json();
    setCars(Array.isArray(data.items) ? data.items : []);
    setTotal(Number(data.total) || 0);
    setLoading(false);
  }, []);

  const bootstrap = useCallback(async () => {
    setLoading(true);
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
    const reload = () => loadFavorites(token);
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
                      <article key={car.id} className="catalog-card">
                        <Link href={publicCarHref(car)} className="catalog-card__main">
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
                          <Link href={publicCarHref(car)} className="btn btn-secondary btn-sm">
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
