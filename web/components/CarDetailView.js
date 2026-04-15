import Head from "next/head";
import Link from "next/link";
import { useRouter } from "next/router";
import { useEffect, useMemo, useState } from "react";

import Breadcrumbs from "./Breadcrumbs";
import CarPhotoLightbox from "./CarPhotoLightbox";
import HeaderMessagesLink from "./HeaderMessagesLink";
import HeaderProfileLink from "./HeaderProfileLink";
import RequestConfirmModal from "./RequestConfirmModal";
import { clearToken } from "../lib/auth";
import { publicCarHref } from "../lib/carRoutes";
import { mediaSrc } from "../lib/media";
import { absoluteUrl } from "../lib/siteUrl";
import { seoDescription } from "../lib/seoText";
import { canCreateListings, isAdminRole, isStaffRole } from "../lib/roles";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

const DEFAULT_REQUEST_COMMENT =
  "Нужен расчёт под ключ до РФ. Прошу уточнить сроки и стоимость доставки.";

function formatRubInt(n) {
  if (n == null || Number.isNaN(Number(n))) return "—";
  return Math.round(Number(n)).toLocaleString("ru-RU");
}

function formatRuDate(iso) {
  if (!iso) return null;
  const m = String(iso).match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return iso;
  return `${m[3]}.${m[2]}.${m[1]}`;
}

/**
 * @param {{ carId: string, pathBrandSlug?: string | null, pathModelSlug?: string | null }} props
 */
export default function CarDetailView({
  carId,
  pathBrandSlug = null,
  pathModelSlug = null,
}) {
  const router = useRouter();
  const [car, setCar] = useState(null);
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
  const customsGroupKeys = new Set(["clearance_fee", "duty", "utilization_fee"]);

  async function loadCarDetails() {
    setError("");
    const res = await fetch(`${API_URL}/cars/${carId}`);
    if (!res.ok) {
      setError("Не удалось загрузить карточку автомобиля.");
      return;
    }
    const data = await res.json();
    setCar(data);
  }

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
        if (res.status === 401 || res.status === 403) {
          clearToken();
          setToken("");
          setMe(null);
          setRequestModalOpen(false);
          const next = car ? publicCarHref(car) : `/cars/${carId}`;
          router.push(`/request-quote?car_id=${carId}&next=${encodeURIComponent(next)}`);
          return;
        }
        setAuthError("Не удалось отправить заявку. Попробуйте еще раз.");
        return;
      }
      setRequestModalOpen(false);
      setRequestOkMessage(
        "Заявка отправлена. Отклики — в разделе «Мои заявки на расчёт» в профиле; переписка с дилером — в «Сообщения» в шапке."
      );
    } finally {
      setRequestModalBusy(false);
    }
  }

  useEffect(() => {
    if (!carId) return;
    loadCarDetails();
  }, [carId]);

  useEffect(() => {
    if (!car || !router.isReady) return;
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
      return;
    }
    if (basePath === `/cars/${car.id}`) {
      router.replace(canonical);
    }
  }, [car, router, pathBrandSlug, pathModelSlug]);

  useEffect(() => {
    setActivePhoto(0);
  }, [car?.id]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const stored = localStorage.getItem("avt_token");
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

  if (error) {
    return (
      <div className="layout">
        <main className="site-main">
          <div className="container">
            <Link href="/catalog" className="detail-back">
              ← Каталог
            </Link>
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
            <Link href="/catalog" className="detail-back">
              ← Каталог
            </Link>
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

  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "Vehicle",
    name: car.title,
    brand: { "@type": "Brand", name: car.brand },
    model: car.model,
    ...(car.year ? { modelDate: `${car.year}-01-01` } : {}),
    ...(ogImage ? { image: [ogImage] } : {}),
    ...(car.price_breakdown?.total_rub != null
      ? {
          offers: {
            "@type": "Offer",
            priceCurrency: "RUB",
            price: Math.round(Number(car.price_breakdown.total_rub)),
            availability: "https://schema.org/InStock",
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
      </Head>
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
                <HeaderProfileLink token={token} userRole={me?.role} />
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  onClick={() => {
                    clearToken();
                    setToken("");
                    setMe(null);
                  }}
                >
                  Выйти
                </button>
              </>
            )}
          </div>
        </div>
      </header>

      <main className="site-main">
        <div className="container">
          {car.brand_slug && car.model_slug ? (
            <Breadcrumbs
              items={[
                { label: "Главная", href: "/" },
                { label: car.brand, href: `/catalog/${car.brand_slug}` },
                {
                  label: car.model,
                  href: `/catalog/${car.brand_slug}/${car.model_slug}`,
                },
                ...(car.generation && car.generation_slug
                  ? [
                      {
                        label: car.generation,
                        href: `/catalog/${car.brand_slug}/${car.model_slug}/${car.generation_slug}`,
                      },
                    ]
                  : []),
                { label: car.title || `Объявление №${car.id}` },
              ]}
            />
          ) : (
            <Breadcrumbs
              items={[
                { label: "Главная", href: "/" },
                { label: car.title || `Объявление №${car.id}` },
              ]}
            />
          )}
          <Link href="/catalog" className="detail-back">
            ← Каталог
          </Link>

          <div className="detail-hero">
            <h1 className="detail-title">{car.title}</h1>
            <p className="detail-subtitle">
              {car.brand} · модель <strong>{car.model}</strong>
              {car.generation ? (
                <>
                  {" "}
                  · поколение <strong>{car.generation}</strong>
                </>
              ) : null}
            </p>
            {car.has_public_dealer_profile && car.created_by_user_id ? (
              <p className="muted" style={{ marginTop: 10 }}>
                <Link href={`/dealers/${car.created_by_user_id}`}>Профиль дилера</Link>
              </p>
            ) : null}
            {car.rub_china != null ? (
              <>
                {car.price_breakdown?.total_rub ? (
                  <p className="detail-price detail-price--rf">
                    {formatRubInt(car.price_breakdown.total_rub)} ₽
                    <span className="detail-price__hint">
                      приблизительная цена в России
                    </span>
                  </p>
                ) : null}
                <p className="muted" style={{ marginTop: 8, fontSize: 15 }}>
                  {Math.round(car.price_cny).toLocaleString("ru-RU")} ¥
                  {car.pricing_guide ? (
                    <>
                      {" "}
                      · курс на {car.pricing_guide.cbr_date}: 1 ¥ ={" "}
                      <strong>{car.pricing_guide.cbr_rub_per_cny.toFixed(2)} ₽</strong>
                    </>
                  ) : null}
                </p>
              </>
            ) : (
              <p className="detail-price">
                {Math.round(car.price_cny).toLocaleString("ru-RU")} ¥{" "}
                <span className="text-muted" style={{ fontWeight: 600, fontSize: "1rem" }}>
                  CNY
                </span>
                <span className="muted" style={{ display: "block", fontSize: 14, marginTop: 8, fontWeight: 500 }}>
                  Пересчёт в ₽ по ЦБ сейчас недоступен.
                </span>
              </p>
            )}
          </div>

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

          <div className="photo-gallery">
            {hero?.storage_url ? (
              <div
                className="photo-gallery__stage-wrap photo-gallery__stage-wrap--openable"
                role="button"
                tabIndex={0}
                onClick={() => {
                  setPhotoLightboxIndex(safeIndex);
                  setPhotoLightboxOpen(true);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    setPhotoLightboxIndex(safeIndex);
                    setPhotoLightboxOpen(true);
                  }
                }}
              >
                <img
                  className="photo-gallery__stage"
                  src={mediaSrc(hero.storage_url)}
                  alt={`${car.title} — фото ${safeIndex + 1}`}
                />
                {nPhotos > 1 && (
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
                )}
              </div>
            ) : (
              <div
                className="photo-gallery__stage-wrap"
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  background: "#e2e8f0",
                  minHeight: 200,
                }}
              >
                <span className="muted">Нет фотографий</span>
              </div>
            )}
            {nPhotos > 0 && (
              <div className="photo-gallery__thumbs">
                {sortedPhotos.map((photo, idx) => (
                  <button
                    key={photo.id}
                    type="button"
                    className={`photo-gallery__thumb ${idx === safeIndex ? "photo-gallery__thumb--active" : ""}`}
                    onClick={() => setActivePhoto(idx)}
                    aria-label={`Миниатюра ${idx + 1}`}
                  >
                    <img src={mediaSrc(photo.storage_url)} alt="" />
                  </button>
                ))}
              </div>
            )}
            {nPhotos > 0 ? (
              <p className="photo-gallery__hint">Нажмите на фото для просмотра во весь экран. Свайп влево/вправо в режиме просмотра.</p>
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

          {car.pricing_guide && (
            <section className="panel" style={{ marginTop: 20 }}>
              <h2 className="section-title" style={{ fontSize: "1.15rem", marginTop: 0 }}>
                Общая информация
              </h2>
              <ul className="pricing-guide-params" style={{ margin: "12px 0", paddingLeft: "1.25rem", lineHeight: 1.55 }}>
                {car.pricing_guide.params_lines
                  .filter((line) => !line.startsWith("Для калькуляторов обычно нужны:"))
                  .map((line) => (
                  <li key={line} style={{ marginBottom: 6 }}>
                    {line}
                  </li>
                  ))}
              </ul>
            </section>
          )}

          <section className="panel">
            <h2 className="section-title" style={{ fontSize: "1.15rem", marginTop: 0 }}>
              Характеристики
            </h2>
            <dl className="spec-grid">
              <div className="spec-item">
                <dt>Год</dt>
                <dd>{car.year}</dd>
              </div>
              <div className="spec-item">
                <dt>Пробег</dt>
                <dd>{car.mileage_km ? `${car.mileage_km.toLocaleString("ru-RU")} км` : "—"}</dd>
              </div>
              <div className="spec-item">
                <dt>Двигатель</dt>
                <dd>{car.engine_volume_cc ? `${car.engine_volume_cc.toLocaleString("ru-RU")} см³` : "—"}</dd>
              </div>
              <div className="spec-item">
                <dt>Мощность</dt>
                <dd>
                  {car.horsepower != null && car.horsepower > 0
                    ? `${car.horsepower.toLocaleString("ru-RU")} л.с.`
                    : "—"}
                </dd>
              </div>
              <div className="spec-item">
                <dt>Регистрация</dt>
                <dd>{formatRuDate(car.registration_date) || "—"}</dd>
              </div>
              <div className="spec-item">
                <dt>Производство</dt>
                <dd>{formatRuDate(car.production_date) || "—"}</dd>
              </div>
              <div className="spec-item">
                <dt>Топливо</dt>
                <dd>{car.fuel_type || "—"}</dd>
              </div>
              <div className="spec-item">
                <dt>КПП</dt>
                <dd>{car.transmission || "—"}</dd>
              </div>
              <div className="spec-item">
                <dt>Город</dt>
                <dd>{car.location_city || "—"}</dd>
              </div>
            </dl>
          </section>

          <section className="panel">
            <h2 className="section-title" style={{ fontSize: "1.15rem", marginTop: 0 }}>
              Описание
            </h2>
            <p className="description-text">{car.description || "Описание отсутствует."}</p>
          </section>

          {car.price_breakdown?.components?.length ? (
            <section className="panel">
              <h2 className="section-title" style={{ fontSize: "1.15rem", marginTop: 0 }}>
                Детализация цены в России
              </h2>
              <div className="price-breakdown-card">
                <div className="price-breakdown-card__total">
                  <span>Средняя стоимость автомобиля со всеми расходами:</span>
                  <strong>{formatRubInt(car.price_breakdown.total_rub)} ₽</strong>
                </div>
                <div className="price-breakdown-card__rows">
                  {(() => {
                    const customsItems = car.price_breakdown.components.filter((item) => customsGroupKeys.has(item.key));
                    const otherItems = car.price_breakdown.components.filter((item) => !customsGroupKeys.has(item.key));
                    const customsTotal = customsItems.reduce((acc, item) => acc + Number(item.amount_rub || 0), 0);
                    return (
                      <>
                        {customsItems.length ? (
                          <>
                            <div className="price-breakdown-card__row" key="customs_total">
                              <div className="price-breakdown-card__label">Таможенные платежи</div>
                              <div className="price-breakdown-card__amount">{formatRubInt(customsTotal)} ₽</div>
                            </div>
                            {customsItems.map((item) => (
                              <div className="price-breakdown-card__row price-breakdown-card__row--sub" key={item.key}>
                                <div className="price-breakdown-card__label">{item.label}</div>
                                <div className="price-breakdown-card__amount">{formatRubInt(item.amount_rub)} ₽</div>
                              </div>
                            ))}
                          </>
                        ) : null}
                        {otherItems.map((item) => (
                          <div className="price-breakdown-card__row" key={item.key}>
                            <div>
                              <div className="price-breakdown-card__label">{item.label}</div>
                              {item.description ? (
                                <div className="price-breakdown-card__desc">{item.description}</div>
                              ) : null}
                            </div>
                            <div className="price-breakdown-card__amount">{formatRubInt(item.amount_rub)} ₽</div>
                          </div>
                        ))}
                      </>
                    );
                  })()}
                </div>
              </div>
            </section>
          ) : null}

          {me?.role !== "dealer" && (
            <section style={{ marginTop: 24 }}>
              <button type="button" className="btn btn-primary" onClick={openRequestModal}>
                Заказать расчёт
              </button>
              {requestOkMessage ? (
                <div className="alert alert--success" style={{ marginTop: 12 }}>
                  {requestOkMessage}
                </div>
              ) : null}
              {authError ? (
                <p className="muted" style={{ marginTop: 12 }}>
                  {authError}
                </p>
              ) : null}
            </section>
          )}

          <RequestConfirmModal
            open={requestModalOpen && !!car}
            onClose={closeRequestModal}
            onConfirm={confirmRequestFromModal}
            busy={requestModalBusy}
            car={car}
            comment={requestModalComment}
            onCommentChange={setRequestModalComment}
          />
        </div>
      </main>
    </div>
    </>
  );
}
