import Head from "next/head";
import Link from "next/link";

import { absoluteUrl } from "../lib/siteUrl";

export default function DeliveryFromKoreaPage() {
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: [
      {
        "@type": "Question",
        name: "Можно ли заказать автомобиль из Кореи под ключ?",
        acceptedAnswer: {
          "@type": "Answer",
          text: "Да. Помогаем подобрать модель, согласуем условия заказа, организуем выкуп и доставку в РФ, а также сопровождаем этапы ввоза.",
        },
      },
      {
        "@type": "Question",
        name: "Какой срок доставки из Кореи?",
        acceptedAnswer: {
          "@type": "Answer",
          text: "Срок зависит от выбранного автомобиля и логистики. После согласования мы даём прогноз и план по этапам.",
        },
      },
      {
        "@type": "Question",
        name: "Сколько стоит заказ под ключ?",
        acceptedAnswer: {
          "@type": "Answer",
          text: "Мы формируем ориентировочную стоимость с учётом доставки и платежей. Перед подтверждением заказа даём сводку по этапам и суммам.",
        },
      },
      {
        "@type": "Question",
        name: "Помогаете ли вы с растаможкой?",
        acceptedAnswer: {
          "@type": "Answer",
          text: "Сопровождаем по этапам и помогаем разобраться с документами. Окончательные требования зависят от ситуации и выбранного формата оформления.",
        },
      },
    ],
  };

  return (
    <div className="layout">
      <Head>
        <title>Доставка автомобилей из Кореи под ключ | avtovozom</title>
        <meta
          name="description"
          content="Доставка автомобилей из Кореи под ключ: подбор марки и модели, организация выкупа, транспортировка в РФ, помощь с растаможкой и расчёт ориентировочной цены."
        />
        <link rel="canonical" href={absoluteUrl("/dostavka-avto-iz-korei")} />
        <meta property="og:title" content="Доставка автомобилей из Кореи под ключ | avtovozom" />
        <meta
          property="og:description"
          content="Доставка автомобилей из Кореи под ключ: подбор, выкуп, доставка в РФ и помощь с растаможкой."
        />
        <meta property="og:url" content={absoluteUrl("/dostavka-avto-iz-korei")} />
        <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />
      </Head>

      <header className="site-header">
        <div className="container site-header__inner">
          <div className="site-header__brand">
            <Link href="/" className="site-logo">
              avtovozom
            </Link>
            <span className="site-tagline">Доставка автомобилей из Кореи</span>
          </div>

          <div className="auth-bar">
            <Link href="/catalog" className="btn btn-ghost btn-sm">
              Каталог
            </Link>
            <Link href="/customs-calculator" className="btn btn-secondary btn-sm">
              Калькулятор растаможки
            </Link>
          </div>
        </div>
      </header>

      <main className="site-main">
        <div className="container page-narrow">
          <h1 className="section-title">Доставка автомобилей из Кореи под ключ</h1>
          <p className="muted">
            Закажите автомобиль из Кореи с нашей помощью: подбор, организация покупки и{" "}
            <b>доставка в Россию</b> с сопровождением по этапам ввоза и растаможки.
          </p>

          <section className="panel" style={{ marginTop: "1.25rem" }}>
            <h2 className="section-title section-title--flush-top" style={{ marginBottom: "0.5rem" }}>
              Как проходит заказ
            </h2>
            <ol style={{ margin: 0, paddingLeft: "1.25rem" }}>
              <li style={{ marginBottom: "0.5rem" }}>Вы оставляете запрос: марка/модель и параметры.</li>
              <li style={{ marginBottom: "0.5rem" }}>Мы подбираем варианты и согласуем условия заказа.</li>
              <li style={{ marginBottom: "0.5rem" }}>Организуем выкуп и отправку до РФ.</li>
              <li>Помогаем по этапам оформления и растаможки.</li>
            </ol>
          </section>

          <section className="panel" style={{ marginTop: "1rem" }}>
            <h2 className="section-title section-title--flush-top" style={{ marginBottom: "0.5rem" }}>
              Что входит в услугу
            </h2>
            <ul style={{ margin: 0, paddingLeft: "1.25rem" }}>
              <li style={{ marginBottom: "0.35rem" }}>Подбор и проверка доступности модели.</li>
              <li style={{ marginBottom: "0.35rem" }}>Согласование условий покупки и выкупа.</li>
              <li style={{ marginBottom: "0.35rem" }}>Логистика и доставка в РФ.</li>
              <li>Сводка по ориентировочной стоимости под запрос.</li>
            </ul>
          </section>

          <div style={{ display: "flex", gap: "0.75rem", flexWrap: "wrap", marginTop: "1.25rem" }}>
            <Link href="/" className="btn btn-primary">
              Подобрать автомобиль
            </Link>
            <Link href="/catalog" className="btn btn-secondary">
              Смотреть каталог
            </Link>
          </div>
        </div>
      </main>
    </div>
  );
}

