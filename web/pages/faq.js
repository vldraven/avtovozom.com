import Head from "next/head";
import Link from "next/link";

import FaqAccordion from "../components/FaqAccordion";
import { faqPageJsonLd } from "../lib/faqContent";
import { jsonLdScriptProps } from "../lib/schema";
import { getServerApiBase } from "../lib/serverApiUrl";
import { absoluteUrl } from "../lib/siteUrl";

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
  const jsonLd = faqPageJsonLd(initialItems);

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

      <header className="site-header">
        <div className="container site-header__inner">
          <div className="site-header__brand">
            <Link href="/" className="site-logo">
              avtovozom
            </Link>
            <span className="site-tagline">Вопросы и ответы</span>
          </div>
          <div className="auth-bar">
            <Link href="/catalog" className="btn btn-ghost btn-sm">
              Каталог
            </Link>
            <Link href="/" className="btn btn-secondary btn-sm">
              На главную
            </Link>
          </div>
        </div>
      </header>

      <main className="site-main">
        <div className="container page-narrow">
          <h1 className="faq-page__title">Частые вопросы</h1>

          <FaqAccordion items={initialItems} />

          <div className="faq-page__links">
            <Link href="/catalog" className="btn btn-primary">
              Выбрать авто
            </Link>
            <Link href="/customs-calculator" className="btn btn-secondary">
              Калькулятор растаможки
            </Link>
          </div>
        </div>
      </main>
    </div>
  );
}
