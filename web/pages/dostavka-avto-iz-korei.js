import Head from "next/head";
import Link from "next/link";

import LeadForm from "../components/LeadForm";
import { absoluteUrl } from "../lib/siteUrl";
import SiteHeader from "../components/SiteHeader";

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
        <title>Доставка автомобилей из Кореи под ключ | Автовозом</title>
        <meta
          name="description"
          content="Доставка авто из Кореи (Kia, Hyundai, Genesis): подбор, выкуп и доставка в РФ. Сроки, маршрут и расчёт под ключ — оставьте заявку."
        />
        <link rel="canonical" href={absoluteUrl("/dostavka-avto-iz-korei")} />
        <meta property="og:title" content="Доставка автомобилей из Кореи под ключ | Автовозом" />
        <meta
          property="og:description"
          content="Доставка автомобилей из Кореи под ключ: подбор, выкуп, доставка в РФ и помощь с растаможкой."
        />
        <meta property="og:url" content={absoluteUrl("/dostavka-avto-iz-korei")} />
        <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />
      </Head>

      <SiteHeader tagline="Доставка автомобилей из Кореи">
          <Link href="/catalog" className="btn btn-ghost btn-sm">
            Каталог
          </Link>
          <Link href="/customs-calculator" className="btn btn-secondary btn-sm">
            Калькулятор растаможки
          </Link>
        </SiteHeader>

      <main className="site-main">
        <div className="container page-narrow">
          <h1 className="section-title">Доставка автомобилей из Кореи под ключ</h1>
          <p className="muted">
            Закажите автомобиль из Кореи с нашей помощью: подбор, организация покупки и{" "}
            <b>доставка в Россию</b> с сопровождением по этапам ввоза и растаможки.
          </p>

          <section className="panel landing-section">
            <h2 className="section-title section-title--flush-top landing-section__title">
              Как проходит заказ
            </h2>
            <ol className="landing-list">
              <li>Вы оставляете запрос: марка/модель и параметры.</li>
              <li>Мы подбираем варианты и согласуем условия заказа.</li>
              <li>Организуем выкуп и отправку до РФ.</li>
              <li>Помогаем по этапам оформления и растаможки.</li>
            </ol>
          </section>

          <section className="panel landing-section--tight">
            <h2 className="section-title section-title--flush-top landing-section__title">
              Что входит в услугу
            </h2>
            <ul className="landing-list landing-list--compact">
              <li>Подбор и проверка доступности модели.</li>
              <li>Согласование условий покупки и выкупа.</li>
              <li>Логистика и доставка в РФ.</li>
              <li>Сводка по ориентировочной стоимости под запрос.</li>
            </ul>
          </section>

          <LeadForm
            title="Заказать расчёт доставки из Кореи"
            lead="Kia, Hyundai, Genesis и другие модели — оставьте заявку, мы свяжемся и уточним детали."
          />

          <div className="landing-cta-row">
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

