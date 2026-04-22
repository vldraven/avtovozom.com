import Head from "next/head";
import Link from "next/link";
import { useRouter } from "next/router";
import { useEffect, useState } from "react";

import { publicCarHref } from "../../lib/carRoutes";
import { mediaSrc } from "../../lib/media";
import { absoluteUrl } from "../../lib/siteUrl";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

function formatRub(n) {
  if (n == null || Number.isNaN(Number(n))) return "—";
  return `${Math.round(Number(n)).toLocaleString("ru-RU")} ₽`;
}

export default function DealerPublicPage() {
  const router = useRouter();
  const { id } = router.query;
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!router.isReady || id == null) return;
    const raw = Array.isArray(id) ? id[0] : id;
    const num = Number(raw);
    if (!Number.isFinite(num)) {
      setError("Некорректная ссылка");
      setLoading(false);
      return;
    }
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError("");
      const res = await fetch(`${API_URL}/public/dealers/${num}`);
      if (cancelled) return;
      if (!res.ok) {
        setError(res.status === 404 ? "Страница дилера не найдена." : "Не удалось загрузить профиль.");
        setData(null);
        setLoading(false);
        return;
      }
      setData(await res.json());
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [router.isReady, id]);

  const dealerIdStr = router.isReady && id != null ? String(Array.isArray(id) ? id[0] : id) : "";

  return (
    <div className="layout">
      {data && !error && dealerIdStr ? (
        <Head>
          <title>{`${data.headline} — дилер | avtovozom`}</title>
          <meta
            name="description"
            content={`Профиль дилера на avtovozom: ${data.listings_total} объявлений в каталоге.`}
          />
          <link rel="canonical" href={absoluteUrl(`/dealers/${dealerIdStr}`)} />
          <meta property="og:title" content={`${data.headline} — дилер`} />
          <meta
            property="og:description"
            content={`Объявления дилера в каталоге avtovozom (${data.listings_total}).`}
          />
          <meta property="og:url" content={absoluteUrl(`/dealers/${dealerIdStr}`)} />
        </Head>
      ) : null}
      <header className="site-header">
        <div className="container site-header__inner">
          <div className="site-header__brand">
            <Link href="/" className="site-logo">
              avtovozom
            </Link>
            <span className="site-tagline">Дилер</span>
          </div>
          <div className="auth-bar">
            <Link href="/" className="btn btn-ghost btn-sm">
              Каталог
            </Link>
            <Link href="/auth" className="btn btn-primary btn-sm">
              Войти
            </Link>
          </div>
        </div>
      </header>

      <main className="site-main">
        <div className="container">
          <Link href="/" className="detail-back">
            ← Назад в каталог
          </Link>

          {loading ? (
            <p className="muted">Загрузка…</p>
          ) : error ? (
            <div className="alert alert--danger">{error}</div>
          ) : data ? (
            <>
              <section className="panel dealer-public-head">
                <h1 className="section-title" style={{ marginTop: 0 }}>
                  {data.headline}
                </h1>
                {data.company_name ? (
                  <p className="muted" style={{ marginTop: 0 }}>
                    Компания: <strong>{data.company_name}</strong>
                  </p>
                ) : null}
                {data.display_name ? (
                  <p className="muted" style={{ marginTop: 8 }}>
                    Имя в сервисе: {data.display_name}
                  </p>
                ) : null}
                <p className="muted" style={{ marginTop: 12 }}>
                  Объявлений в каталоге: <strong>{data.listings_total}</strong>
                </p>
              </section>

              {data.cars.length === 0 ? (
                <p className="muted">У дилера пока нет активных объявлений.</p>
              ) : (
                <ul className="dealer-public-grid">
                  {data.cars.map((c) => {
                    const ph = [...(c.photos || [])].sort((a, b) => a.sort_order - b.sort_order)[0];
                    const totalRub =
                      c.price_breakdown?.total_rub != null
                        ? c.price_breakdown.total_rub
                        : c.estimated_total_rub != null
                          ? c.estimated_total_rub
                          : null;
                    return (
                      <li key={c.id} className="dealer-public-card">
                        <Link href={publicCarHref(c)} className="dealer-public-card__link">
                          {ph ? (
                            <img
                              className="dealer-public-card__img"
                              src={mediaSrc(ph.storage_url)}
                              alt=""
                            />
                          ) : (
                            <div className="dealer-public-card__img dealer-public-card__img--empty" />
                          )}
                          <div className="dealer-public-card__body">
                            <div className="dealer-public-card__title">{c.title}</div>
                            <div className="dealer-public-card__meta muted">
                              {c.brand} {c.model} · {c.year}
                            </div>
                            <div className="dealer-public-card__price">
                              {totalRub != null
                                ? `${formatRub(totalRub)} (РФ)`
                                : `${Math.round(c.price_cny)} ¥`}
                            </div>
                          </div>
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              )}
            </>
          ) : null}
        </div>
      </main>
    </div>
  );
}
