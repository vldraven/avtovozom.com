import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/router";

import Breadcrumbs from "../../components/Breadcrumbs";
import CarDetailView from "../../components/CarDetailView";
import HeaderMessagesLink from "../../components/HeaderMessagesLink";
import HeaderProfileLink from "../../components/HeaderProfileLink";
import { clearToken } from "../../lib/auth";
import { publicCarHref } from "../../lib/carRoutes";
import { mediaSrc } from "../../lib/media";
import { canCreateListings } from "../../lib/roles";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

function segmentsFromQuery(slug) {
  if (slug == null) return [];
  if (Array.isArray(slug)) return slug.map(String).filter(Boolean);
  return [String(slug)].filter(Boolean);
}

export default function CatalogTreePage() {
  const router = useRouter();
  const segments = router.isReady ? segmentsFromQuery(router.query.slug) : null;

  const [tree, setTree] = useState([]);
  const [cars, setCars] = useState([]);
  const [total, setTotal] = useState(0);
  const [token, setToken] = useState("");
  const [me, setMe] = useState(null);

  const { brand, model, unknownSlug, badModelSlug } = useMemo(() => {
    if (segments == null || !tree.length) {
      return { brand: null, model: null, unknownSlug: false, badModelSlug: false };
    }
    const [bSlug, mSlug] = segments;
    if (!bSlug) return { brand: null, model: null, unknownSlug: false, badModelSlug: false };
    const b = tree.find((x) => x.slug === bSlug);
    if (!b) return { brand: null, model: null, unknownSlug: true, badModelSlug: false };
    if (!mSlug) return { brand: b, model: null, unknownSlug: false, badModelSlug: false };
    const m = b.models.find((x) => x.slug === mSlug);
    if (!m) return { brand: b, model: null, unknownSlug: false, badModelSlug: true };
    return { brand: b, model: m, unknownSlug: false, badModelSlug: false };
  }, [segments, tree]);

  const loadTree = useCallback(async () => {
    const res = await fetch(`${API_URL}/catalog/tree`);
    if (res.ok) setTree(await res.json());
  }, []);

  useEffect(() => {
    loadTree();
  }, [loadTree]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const stored = localStorage.getItem("avt_token");
      if (stored) {
        setToken(stored);
        const res = await fetch(`${API_URL}/auth/me`, {
          headers: { Authorization: `Bearer ${stored}` },
        });
        if (!cancelled && res.ok) setMe(await res.json());
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!router.isReady || segments == null) return;
    if (unknownSlug) {
      setCars([]);
      setTotal(0);
      return;
    }
    /* badModelSlug: показываем объявления по марке */
    const params = new URLSearchParams();
    if (brand) params.set("brand_id", String(brand.id));
    if (model) params.set("model_id", String(model.id));
    let cancelled = false;
    (async () => {
      const res = await fetch(`${API_URL}/cars?${params.toString()}`);
      const data = await res.json();
      if (!cancelled) {
        setCars(data.items || []);
        setTotal(data.total || 0);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [router.isReady, segments, brand, model, unknownSlug, badModelSlug]);

  function logout() {
    clearToken();
    setToken("");
    setMe(null);
  }

  const breadcrumbItems = useMemo(() => {
    const items = [{ label: "Главная", href: "/" }, { label: "Каталог", href: "/catalog" }];
    if (brand) items.push({ label: brand.name, href: `/catalog/${brand.slug}` });
    if (model) items.push({ label: model.name, href: `/catalog/${brand.slug}/${model.slug}` });
    return items;
  }, [brand, model]);

  if (!router.isReady) {
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

  if (
    segments != null &&
    segments.length === 3 &&
    /^\d+$/.test(String(segments[2]))
  ) {
    return (
      <CarDetailView
        carId={String(segments[2])}
        pathBrandSlug={segments[0]}
        pathModelSlug={segments[1]}
      />
    );
  }

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
          <Breadcrumbs items={breadcrumbItems} />

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
                {model ? `${brand.name} · ${model.name}` : brand ? `Марка ${brand.name}` : "Каталог автомобилей"}
              </h1>
              <p className="catalog-page-intro">
                {model
                  ? `Объявления по модели «${model.name}». Выберите другую модель или марку в дереве.`
                  : brand
                    ? `Все модели марки «${brand.name}» и объявления по марке. Откройте марку, чтобы перейти к модели.`
                    : "Выберите марку и модель в дереве слева — как в иерархии каталога на крупных площадках."}
              </p>

              {badModelSlug ? (
                <div className="alert alert--warn" style={{ marginBottom: "1rem" }}>
                  Такой модели в каталоге нет — показаны объявления по марке «{brand.name}».
                </div>
              ) : null}

              <div className="catalog-layout">
                <aside className="catalog-tree-panel" aria-label="Дерево каталога">
                  <h2 className="catalog-tree-panel__title">Марки и модели</h2>
                  {tree.map((b) => (
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
                            className={`catalog-tree-model-link${brand?.id === b.id && !model ? " catalog-tree-model-link--active" : ""}`}
                          >
                            <span>Все модели марки</span>
                            <span className="catalog-tree-model-link__count">{b.listings_count || "—"}</span>
                          </Link>
                        </li>
                        {b.models.map((m) => (
                          <li key={m.id}>
                            <Link
                              href={`/catalog/${b.slug}/${m.slug}`}
                              className={`catalog-tree-model-link${
                                model?.id === m.id ? " catalog-tree-model-link--active" : ""
                              }`}
                            >
                              <span>{m.name}</span>
                              <span className="catalog-tree-model-link__count">
                                {m.listings_count > 0 ? m.listings_count : "—"}
                              </span>
                            </Link>
                          </li>
                        ))}
                      </ul>
                    </details>
                  ))}
                </aside>

                <div className="catalog-main-panel">
                  <h2 className="section-title section-title--flush-top">
                    Объявления{" "}
                    <span className="text-muted">
                      · {total}{" "}
                      {brand || model ? "в этом разделе" : "в каталоге"}
                    </span>
                  </h2>

                  <section className="catalog-section">
                    <div className="catalog-grid">
                      {cars.map((car) => (
                        <article key={car.id} className="catalog-card">
                          <Link href={publicCarHref(car)} className="catalog-card__main">
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
                                    <span className="text-muted catalog-price-cny-note"> CNY</span>
                                  </>
                                )}
                              </p>
                            </div>
                          </Link>
                          <div className="catalog-card__actions">
                            <Link href={publicCarHref(car)} className="btn btn-secondary btn-sm">
                              Подробнее
                            </Link>
                          </div>
                        </article>
                      ))}
                    </div>
                  </section>
                </div>
              </div>
            </>
          )}
        </div>
      </main>
    </div>
  );
}
