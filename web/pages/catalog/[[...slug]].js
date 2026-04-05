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
  const [treeError, setTreeError] = useState(null);
  const [carsError, setCarsError] = useState(null);

  const { brand, model, generation, unknownSlug, badModelSlug, badGenSlug } = useMemo(() => {
    if (segments == null || !tree.length) {
      return {
        brand: null,
        model: null,
        generation: null,
        unknownSlug: false,
        badModelSlug: false,
        badGenSlug: false,
      };
    }
    const [bSlug, mSlug, gSlug] = segments;
    if (!bSlug) {
      return {
        brand: null,
        model: null,
        generation: null,
        unknownSlug: false,
        badModelSlug: false,
        badGenSlug: false,
      };
    }
    const b = tree.find((x) => x.slug === bSlug);
    if (!b) {
      return {
        brand: null,
        model: null,
        generation: null,
        unknownSlug: true,
        badModelSlug: false,
        badGenSlug: false,
      };
    }
    if (!mSlug) {
      return {
        brand: b,
        model: null,
        generation: null,
        unknownSlug: false,
        badModelSlug: false,
        badGenSlug: false,
      };
    }
    const m = b.models.find((x) => x.slug === mSlug);
    if (!m) {
      return {
        brand: b,
        model: null,
        generation: null,
        unknownSlug: false,
        badModelSlug: true,
        badGenSlug: false,
      };
    }
    if (!gSlug) {
      return {
        brand: b,
        model: m,
        generation: null,
        unknownSlug: false,
        badModelSlug: false,
        badGenSlug: false,
      };
    }
    const gen = (m.generations || []).find((x) => x.slug === gSlug);
    if (!gen) {
      return {
        brand: b,
        model: m,
        generation: null,
        unknownSlug: false,
        badModelSlug: false,
        badGenSlug: true,
      };
    }
    return {
      brand: b,
      model: m,
      generation: gen,
      unknownSlug: false,
      badModelSlug: false,
      badGenSlug: false,
    };
  }, [segments, tree]);

  const isBrandFocus = Boolean(brand && !unknownSlug);

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
    loadTree();
  }, [loadTree]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const stored = localStorage.getItem("avt_token");
      if (!stored) return;
      setToken(stored);
      try {
        const res = await fetch(`${API_URL}/auth/me`, {
          headers: { Authorization: `Bearer ${stored}` },
        });
        if (!cancelled && res.ok) setMe(await res.json());
      } catch {
        /* API недоступен — не падаем красным экраном Next */
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
    /* badModelSlug: объявления по марке; badGenSlug — по модели без фильтра поколения */
    const params = new URLSearchParams();
    if (brand) params.set("brand_id", String(brand.id));
    if (model) params.set("model_id", String(model.id));
    if (generation && !badGenSlug) params.set("generation_id", String(generation.id));
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
  }, [
    router.isReady,
    segments,
    brand,
    model,
    unknownSlug,
    badModelSlug,
    badGenSlug,
    generation,
  ]);

  function logout() {
    clearToken();
    setToken("");
    setMe(null);
  }

  const breadcrumbItems = useMemo(() => {
    const items = [{ label: "Главная", href: "/" }];
    if (brand) items.push({ label: brand.name, href: `/catalog/${brand.slug}` });
    if (model) items.push({ label: model.name, href: `/catalog/${brand.slug}/${model.slug}` });
    if (generation) {
      items.push({
        label: generation.name,
        href: `/catalog/${brand.slug}/${model.slug}/${generation.slug}`,
      });
    }
    return items;
  }, [brand, model, generation]);

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
            <span className="site-tagline">Каталог и подбор автомобилей</span>
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
                          <label className="catalog-tree-field">
                            <span className="catalog-tree-field__label">Модель</span>
                            <select
                              className="catalog-tree-native-select"
                              value={String(model.id)}
                              onChange={(e) => {
                                const v = e.target.value;
                                if (v === "") {
                                  router.push(`/catalog/${brand.slug}`);
                                  return;
                                }
                                const m = brand.models.find((x) => String(x.id) === v);
                                if (m) router.push(`/catalog/${brand.slug}/${m.slug}`);
                              }}
                              aria-label="Выбор модели"
                            >
                              <option value="">Все модели марки</option>
                              {brand.models.map((m) => (
                                <option key={m.id} value={String(m.id)}>
                                  {m.name}
                                  {m.listings_count > 0 ? ` · ${m.listings_count}` : ""}
                                </option>
                              ))}
                            </select>
                          </label>
                          {(model.generations || []).length > 0 ? (
                            <div className="catalog-tree-generation-step">
                              <label className="catalog-tree-field catalog-tree-field--tight">
                                <span className="catalog-tree-field__label">Поколение</span>
                                <select
                                  className="catalog-tree-native-select"
                                  value={generation ? String(generation.id) : ""}
                                  onChange={(e) => {
                                    const v = e.target.value;
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
                                  aria-label="Выбор поколения"
                                >
                                  <option value="">Все поколения</option>
                                  {(model.generations || []).map((g) => (
                                    <option key={g.id} value={String(g.id)}>
                                      {g.name}
                                      {g.listings_count > 0 ? ` · ${g.listings_count}` : ""}
                                    </option>
                                  ))}
                                </select>
                              </label>
                            </div>
                          ) : null}
                        </>
                      ) : (
                        <label className="catalog-tree-field">
                          <span className="catalog-tree-field__label">Модель</span>
                          <select
                            className="catalog-tree-native-select"
                            value=""
                            onChange={(e) => {
                              const v = e.target.value;
                              if (v === "") return;
                              const m = brand.models.find((x) => String(x.id) === v);
                              if (m) router.push(`/catalog/${brand.slug}/${m.slug}`);
                            }}
                            aria-label="Выбор модели марки"
                          >
                            <option value="">Все модели марки</option>
                            {brand.models.map((m) => (
                              <option key={m.id} value={String(m.id)}>
                                {m.name}
                                {m.listings_count > 0 ? ` · ${m.listings_count}` : ""}
                              </option>
                            ))}
                          </select>
                        </label>
                      )}
                    </>
                  ) : (
                    <>
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
                    </>
                  )}
                </aside>

                <div className="catalog-main-panel">
                  <h2 className="section-title section-title--flush-top">
                    Объявления <span className="text-muted">· {total}</span>
                  </h2>

                  {carsError ? (
                    <div className="alert alert--warn" style={{ marginBottom: "1rem" }}>
                      {carsError}
                    </div>
                  ) : null}

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
