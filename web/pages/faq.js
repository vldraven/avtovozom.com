import Head from "next/head";
import Link from "next/link";

import LeadForm from "../components/LeadForm";
import { FAQ_ITEMS, faqPageJsonLd } from "../lib/faqContent";
import { jsonLdScriptProps } from "../lib/schema";
import { absoluteUrl } from "../lib/siteUrl";

export default function FaqPage() {
  const jsonLd = faqPageJsonLd();

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
        <script {...jsonLdScriptProps(jsonLd)} />
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
          <h1 className="section-title">Частые вопросы</h1>
          <p className="muted faq-page__lead">
            Ответы о доставке автомобилей из Китая и Кореи в Россию. Не нашли ответ —{" "}
            <a href="#lead-form">оставьте заявку</a>, мы свяжемся с вами.
          </p>

          <div className="faq-list">
            {FAQ_ITEMS.map((item) => (
              <details key={item.question} className="faq-item panel">
                <summary className="faq-item__question">{item.question}</summary>
                <p className="faq-item__answer">{item.answer}</p>
              </details>
            ))}
          </div>

          <LeadForm
            title="Не нашли ответ?"
            lead="Опишите ваш вопрос и контакты — менеджер ответит и поможет с расчётом."
            className="faq-page__lead-form"
          />

          <div className="faq-page__links">
            <Link href="/catalog" className="btn btn-primary">
              Смотреть каталог
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
