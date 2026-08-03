import Head from "next/head";
import Link from "next/link";
import { useMemo, useState } from "react";

import FaqAccordion from "../components/FaqAccordion";
import { faqPageJsonLd } from "../lib/faqContent";
import { jsonLdScriptProps } from "../lib/schema";
import { getServerApiBase } from "../lib/serverApiUrl";
import { absoluteUrl } from "../lib/siteUrl";
import SiteHeader from "../components/SiteHeader";

const FAQ_TABS = [
  { id: "all", label: "Все" },
  { id: "general", label: "Общие" },
  { id: "china", label: "Китай" },
  { id: "korea", label: "Корея" },
];

function faqBucket(item) {
  const text = `${item?.question || ""} ${item?.answer || ""}`.toLowerCase();
  if (/китай|китае|китая|юан|che168|\bcny\b/.test(text)) return "china";
  if (/коре|hyundai|kia|genesis/.test(text)) return "korea";
  return "general";
}

export async function getServerSideProps() {
  const api = getServerApiBase();
  try {
    const res = await fetch(`${api}/faq`, {
      headers: { Accept: "application/json" },
    });
    if (res.ok) {
      return { props: { initialItems: await res.json() } };
    }
  } catch {
    /* fallback ниже */
  }
  return { props: { initialItems: [] } };
}

export default function FaqPage({ initialItems = [] }) {
  const [tab, setTab] = useState("all");
  const jsonLd = faqPageJsonLd(initialItems);

  const filteredItems = useMemo(() => {
    if (tab === "all") return initialItems;
    return (initialItems || []).filter((item) => faqBucket(item) === tab);
  }, [initialItems, tab]);

  const tabCounts = useMemo(() => {
    const counts = { all: initialItems.length, general: 0, china: 0, korea: 0 };
    for (const item of initialItems || []) {
      counts[faqBucket(item)] += 1;
    }
    return counts;
  }, [initialItems]);

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

      <main className="site-main">
        <div className="container page-narrow">
          <header className="faq-page-hero">
            <h1 className="faq-page__title">Частые вопросы</h1>
            <p className="muted faq-page-hero__lead">
              Сроки, растаможка, оплата и доставка из Китая и Кореи — коротко по делу.
            </p>
          </header>

          <div className="faq-stats" aria-label="Ключевые ориентиры">
            <div className="faq-stats__item">
              <strong>18–25 дней</strong>
              <span>типичный срок до РФ</span>
            </div>
            <div className="faq-stats__item">
              <strong>CNY</strong>
              <span>оплата в юанях</span>
            </div>
            <div className="faq-stats__item">
              <strong>1 200+</strong>
              <span>авто в каталоге</span>
            </div>
          </div>

          <div className="faq-page-tabs" role="tablist" aria-label="Разделы FAQ">
            {FAQ_TABS.map((t) => {
              const count = tabCounts[t.id] ?? 0;
              const disabled = t.id !== "all" && count === 0;
              return (
                <button
                  key={t.id}
                  type="button"
                  role="tab"
                  aria-selected={tab === t.id}
                  className={`faq-page-tabs__btn${tab === t.id ? " is-active" : ""}`}
                  disabled={disabled}
                  onClick={() => setTab(t.id)}
                >
                  {t.label}
                  {t.id !== "all" ? (
                    <span className="faq-page-tabs__count">{count}</span>
                  ) : null}
                </button>
              );
            })}
          </div>

          <FaqAccordion items={filteredItems} />

          <div className="faq-page__links">
            <Link href="/catalog" className="btn btn-primary">
              Выбрать авто
            </Link>
            <Link href="/customs-calculator" className="btn btn-secondary">
              Калькулятор растаможки
            </Link>
            <Link href="/request-quote" className="btn btn-ghost">
              Заявка на подбор
            </Link>
          </div>
        </div>
      </main>
    </div>
  );
}
