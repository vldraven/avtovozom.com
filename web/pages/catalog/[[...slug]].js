import Head from "next/head";
import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/router";

import Breadcrumbs from "../../components/Breadcrumbs";
import CatalogCardImageScrub from "../../components/CatalogCardImageScrub";
import CatalogSortDropdown from "../../components/CatalogSortDropdown";
import SiteSelectDropdown from "../../components/SiteSelectDropdown";
import CarDetailView from "../../components/CarDetailView";
import HeaderMessagesLink from "../../components/HeaderMessagesLink";
import HeaderProfileLink from "../../components/HeaderProfileLink";
import RequestConfirmModal from "../../components/RequestConfirmModal";
import { clearToken } from "../../lib/auth";
import { publicCarHref } from "../../lib/carRoutes";
import { canCreateListings } from "../../lib/roles";
import { absoluteUrl } from "../../lib/siteUrl";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

const DEFAULT_REQUEST_COMMENT =
  "Нужен расчёт под ключ до РФ. Прошу уточнить сроки и стоимость доставки.";

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
  const [listSort, setListSort] = useState("date_desc");
  const [requestModalCar, setRequestModalCar] = useState(null);
  const [requestModalComment, setRequestModalComment] = useState("");
  const [requestModalBusy, setRequestModalBusy] = useState(false);

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
    if (listSort && listSort !== "date_desc") {
      params.set("sort", listSort);
    }
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
    listSort,
  ]);

  useEffect(() => {
    if (!router.isReady) return;
    const rawS = router.query.sort;
    const sv = Array.isArray(rawS) ? rawS[0] : rawS;
    if (sv && ["date_desc", "date_asc", "price_asc", "price_desc"].includes(String(sv))) {
      setListSort(String(sv));
    }
  }, [router.isReady, router.query.sort]);

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

  const catalogCanon = useMemo(() => {
    if (segments == null || segments.length === 0) return "/catalog";
    return `/catalog/${segments.join("/")}`;
  }, [segments]);

  const catalogSeo = useMemo(() => {
    if (unknownSlug) {
      return {
        title: "Раздел не найден — avtovozom",
        desc: "Проверьте адрес каталога или вернитесь к списку марок.",
      };
    }
    if (generation && brand && model) {
      return {
        title: `${brand.name} ${model.name} ${generation.name} — авто из Китая | avtovozom`,
        desc: `Объявления ${brand.name} ${model.name}, поколение ${generation.name}. Доставка из Китая в Россию.`,
      };
    }
    if (model && brand) {
      return {
        title: `${brand.name} ${model.name} — купить из Китая | avtovozom`,
        desc: `Каталог ${brand.name} ${model.name}: цены, расчёт под ключ до РФ.`,
      };
    }
    if (brand) {
      return {
        title: `${brand.name} — автомобили из Китая | avtovozom`,
        desc: `Модели ${brand.name}: подбор, доставка и растаможка автомобиля из Китая.`,
      };
    }
    return {
      title: "Каталог автомобилей из Китая | avtovozom",
      desc: "Подбор марок и моделей, цены, доставка в Россию и сопровождение сделки.",
    };
  }, [unknownSlug, brand, model, generation]);

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
      <Head>
        <title>{catalogSeo.title}</title>
        <meta name="description" content={catalogSeo.desc} />
        <link rel="canonical" href={absoluteUrl(catalogCanon)} />
        <meta property="og:title" content={catalogSeo.title} />
        <meta property="og:description" content={catalogSeo.desc} />
        <meta property="og:url" content={absoluteUrl(catalogCanon)} />
      </Head>
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
                                Заказать расчёт
                              </button>
                            ) : null}
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
