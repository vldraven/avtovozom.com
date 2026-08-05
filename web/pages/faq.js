import Head from "next/head";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import FaqAccordion from "../components/FaqAccordion";
import SiteHeader from "../components/SiteHeader";
import { faqPageJsonLd } from "../lib/faqContent";
import {
  FAQ_SECTIONS,
  faqSectionTabLabel,
  normalizeFaqSection,
} from "../lib/faqSections";
import { jsonLdScriptProps } from "../lib/schema";
import { getServerApiBase } from "../lib/serverApiUrl";
import { absoluteUrl } from "../lib/siteUrl";

/**
 * Контент FAQ — опубликованные пункты из админки (`GET /faq`).
 * Поле `section` задаётся в `/staff/admin-faq`.
 */
export async function getServerSideProps() {
  const api = getServerApiBase();
  try {
    const res = await fetch(`${api}/faq`, {
      headers: { Accept: "application/json" },
    });
    if (res.ok) {
      const initialItems = await res.json();
      return { props: { initialItems: Array.isArray(initialItems) ? initialItems : [] } };
    }
  } catch {
    /* fallback ниже */
  }
  return { props: { initialItems: [] } };
}

export default function FaqPage({ initialItems = [] }) {
  const items = useMemo(
    () => (Array.isArray(initialItems) ? initialItems : []),
    [initialItems]
  );
  const [section, setSection] = useState("all");
  const [search, setSearch] = useState("");
  const jsonLd = faqPageJsonLd(items);

  const sectionCounts = useMemo(() => {
    const counts = Object.fromEntries(FAQ_SECTIONS.map((s) => [s.id, 0]));
    counts.all = items.length;
    for (const item of items) {
      const bucket = normalizeFaqSection(item.section);
      if (counts[bucket] != null) counts[bucket] += 1;
    }
    return counts;
  }, [items]);

  const visibleSections = useMemo(
    () =>
      FAQ_SECTIONS.filter((s) => {
        if (s.id === "all") return items.length > 0;
        return (sectionCounts[s.id] ?? 0) > 0;
      }),
    [items.length, sectionCounts]
  );

  const visibleMobileTabs = visibleSections;

  const filteredItems = useMemo(() => {
    const q = search.trim().toLowerCase();
    return items.filter((item) => {
      if (section !== "all" && normalizeFaqSection(item.section) !== section) return false;
      if (!q) return true;
      const hay = `${item?.question || ""} ${item?.answer || ""}`.toLowerCase();
      return hay.includes(q);
    });
  }, [items, section, search]);

  useEffect(() => {
    setSearch("");
  }, [section]);

  useEffect(() => {
    if (!visibleSections.some((s) => s.id === section)) {
      setSection("all");
    }
  }, [visibleSections, section]);

  const isChinaMobile = section === "china";
  const sectionMeta = visibleSections.find((s) => s.id === section);

  return (
    <div className="layout">
      <Head>
        <title>Частые вопросы — доставка авто из Китая и Кореи | avtovozom</title>
        <meta
          name="description"
          content="Ответы на частые вопросы о доставке авто из Китая и Кореи: сроки, стоимость, растаможка, документы и оплата. avtovozom."
        />
        <link rel="canonical" href={absoluteUrl("/faq")} />
        <meta property="og:title" content="Частые вопросы — avtovozom" />
        <meta
          property="og:description"
          content="Сроки, стоимость, растаможка и документы при заказе автомобиля из Китая и Кореи."
        />
        <meta property="og:url" content={absoluteUrl("/faq")} />
        {jsonLd ? <script {...jsonLdScriptProps(jsonLd)} /> : null}
      </Head>

      <SiteHeader tagline="Вопросы и ответы">
        <Link href="/catalog" className="btn btn-ghost btn-sm">
          Каталог
        </Link>
        <Link href="/request-quote" className="btn btn-secondary btn-sm">
          Заявка
        </Link>
      </SiteHeader>

      <main className="site-main site-main--faq">
        {isChinaMobile ? (
          <section className="faq-china-hero faq-only-mobile" aria-label="FAQ по Китаю">
            <p className="faq-china-hero__crumb">FAQ · Китай</p>
            <h1 className="faq-china-hero__title">Доставка авто из Китая</h1>
            <p className="faq-china-hero__lead">
              Как устроен процесс, какие ставки действуют и что нужно от вас.
            </p>
            <div className="faq-china-hero__stats" aria-label="Ключевые ориентиры">
              <div className="faq-china-hero__stat">
                <strong>6–8</strong>
                <span>недель</span>
              </div>
              <div className="faq-china-hero__stat">
                <strong>CNY</strong>
                <span>расчёт</span>
              </div>
              <div className="faq-china-hero__stat">
                <strong>1 200+</strong>
                <span>лотов</span>
              </div>
            </div>
          </section>
        ) : null}

        <div className="container faq-page">
          <div className="faq-only-mobile">
            {!isChinaMobile ? (
              <header className="faq-page-hero">
                <h1 className="faq-page__title">Частые вопросы</h1>
              </header>
            ) : null}

            <div className="faq-page-tabs" role="tablist" aria-label="Разделы FAQ">
              {visibleMobileTabs.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  role="tab"
                  aria-selected={section === t.id}
                  className={`faq-page-tabs__btn${section === t.id ? " is-active" : ""}`}
                  onClick={() => setSection(t.id)}
                >
                  {faqSectionTabLabel(t)}
                </button>
              ))}
            </div>
          </div>

          <header className="faq-page-hero faq-only-desktop">
            <h1 className="faq-page__title">Частые вопросы</h1>
            <p className="muted faq-page-hero__lead">Всё о подборе, доставке, растаможке и оплате</p>
          </header>

          <div className="faq-layout">
            <aside className="faq-sidebar faq-only-desktop" aria-label="Разделы">
              <p className="faq-sidebar__label">Разделы</p>
              <nav className="faq-sidebar__nav">
                {visibleSections.map((s) => {
                  const count = sectionCounts[s.id] ?? 0;
                  return (
                    <button
                      key={s.id}
                      type="button"
                      className={`faq-sidebar__item${section === s.id ? " is-active" : ""}`}
                      onClick={() => setSection(s.id)}
                    >
                      <span>{s.label}</span>
                      <span className="faq-sidebar__count">{count}</span>
                    </button>
                  );
                })}
              </nav>
            </aside>

            <div className="faq-main">
              <label className="faq-search faq-only-desktop">
                <span className="faq-search__icon" aria-hidden>
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <circle cx="11" cy="11" r="7" />
                    <path d="m20 20-3.5-3.5" strokeLinecap="round" />
                  </svg>
                </span>
                <input
                  type="search"
                  className="faq-search__input"
                  placeholder="Поиск по вопросам"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  aria-label="Поиск по вопросам"
                />
              </label>

              {sectionMeta && section !== "all" && !isChinaMobile ? (
                <p className="faq-main__section-label faq-only-desktop">{sectionMeta.label}</p>
              ) : null}

              <FaqAccordion items={filteredItems} resetKey={`${section}|${search}`} />

              {items.length === 0 ? (
                <p className="muted faq-page__cms-hint">
                  Вопросы появятся после публикации в{" "}
                  <Link href="/staff/admin-faq">админке FAQ</Link>.
                </p>
              ) : null}

              <div className="faq-page__links faq-only-mobile">
                {isChinaMobile ? (
                  <Link href="/catalog" className="btn btn-primary">
                    Смотреть авто из Китая
                  </Link>
                ) : (
                  <>
                    <Link href="/catalog" className="btn btn-primary">
                      Выбрать авто
                    </Link>
                    <Link href="/messages" className="btn btn-secondary">
                      Задать вопрос
                    </Link>
                  </>
                )}
              </div>

              {!isChinaMobile ? (
                <p className="faq-page__support faq-only-mobile">
                  Не нашли ответ — напишите в чат поддержки, отвечаем в рабочее время в течение часа.
                </p>
              ) : null}
            </div>
          </div>

          <section className="faq-help-bar faq-only-desktop" aria-label="Нужна помощь">
            <div className="faq-help-bar__text">
              <p className="faq-help-bar__title">Не нашли ответ?</p>
              <p className="faq-help-bar__lead">Напишите менеджеру или оставьте заявку — разберём ваш случай.</p>
            </div>
            <div className="faq-help-bar__actions">
              <Link href="/messages" className="btn btn-primary faq-help-bar__btn">
                Спросить в чате
              </Link>
              <Link href="/request-quote" className="btn faq-help-bar__btn faq-help-bar__btn--ghost">
                Оставить заявку
              </Link>
            </div>
          </section>
        </div>
      </main>
    </div>
  );
}
