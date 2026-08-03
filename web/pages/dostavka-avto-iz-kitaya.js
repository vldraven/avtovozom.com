import Head from "next/head";
import Link from "next/link";

import LeadForm from "../components/LeadForm";
import { absoluteUrl } from "../lib/siteUrl";
import SiteHeader from "../components/SiteHeader";

export default function DeliveryFromChinaPage() {
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: [
      {
        "@type": "Question",
        name: "Что входит в доставку авто из Китая под ключ?",
        acceptedAnswer: {
          "@type": "Answer",
          text: "Подбор марки и модели, согласование условий покупки, организация выкупа, доставка в РФ и помощь с подготовкой к растаможке.",
        },
      },
      {
        "@type": "Question",
        name: "Можно ли заказать конкретную модель, если её нет в каталоге?",
        acceptedAnswer: {
          "@type": "Answer",
          text: "Да. Опишите марку/модель и желаемые параметры — поможем подобрать и организуем заказ автомобиля под ваши условия.",
        },
      },
      {
        "@type": "Question",
        name: "Как формируется итоговая стоимость?",
        acceptedAnswer: {
          "@type": "Answer",
          text: "Мы рассчитываем ориентировочную стоимость и учитываем доставку и платежи. Перед согласованием даём сводку по этапам и суммам.",
        },
      },
      {
        "@type": "Question",
        name: "Нужно ли вам заниматься документами для ввоза?",
        acceptedAnswer: {
          "@type": "Answer",
          text: "Мы подсказываем, какие документы нужны, и помогаем пройти этапы. Окончательные требования зависят от вашей ситуации и выбранного формата оформления.",
        },
      },
    ],
  };

  return (
    <div className="layout">
      <Head>
        <title>Доставка автомобилей из Китая под ключ | avtovozom</title>
        <meta
          name="description"
          content="Доставка авто из Китая под ключ: подбор, выкуп, логистика и помощь с растаможкой. Узнайте ориентировочную цену в РФ — оставьте заявку."
        />
        <link rel="canonical" href={absoluteUrl("/dostavka-avto-iz-kitaya")} />
        <meta property="og:title" content="Доставка автомобилей из Китая под ключ | avtovozom" />
        <meta
          property="og:description"
          content="Доставка автомобилей из Китая под ключ: подбор, выкуп, доставка в РФ и помощь с растаможкой."
        />
        <meta property="og:url" content={absoluteUrl("/dostavka-avto-iz-kitaya")} />
        <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />
      </Head>

      <SiteHeader tagline="Доставка автомобилей из Китая">
          <Link href="/catalog" className="btn btn-ghost btn-sm">
            Каталог
          </Link>
          <Link href="/customs-calculator" className="btn btn-secondary btn-sm">
            Калькулятор растаможки
          </Link>
        </SiteHeader>

      <main className="site-main">
        <div className="container page-narrow">
          <h1 className="section-title">Доставка автомобилей из Китая под ключ</h1>
          <p className="muted">
            Закажите автомобиль из Китая с нашей помощью: подбор марки и модели, организация покупки и{" "}
            <b>доставка в Россию</b>, а также сопровождение по этапам ввоза и растаможки.
          </p>

          <section className="panel landing-section">
            <h2 className="section-title section-title--flush-top landing-section__title">
              Как проходит заказ
            </h2>
            <ol className="landing-list">
              <li>
                Вы оставляете запрос: марка/модель и желаемые параметры.
              </li>
              <li>
                Подбираем варианты, согласуем условия и подготавливаем расчёт.
              </li>
              <li>
                Организуем выкуп и перевозку до РФ.
              </li>
              <li>Помогаем с этапами оформления и ориентируем по срокам.</li>
            </ol>
          </section>

          <section className="panel landing-section--tight">
            <h2 className="section-title section-title--flush-top landing-section__title">
              Что вы получаете
            </h2>
            <ul className="landing-list landing-list--compact">
              <li>Подбор и проверка модели перед заказом.</li>
              <li>Выкуп автомобиля под согласованные условия.</li>
              <li>Доставка в РФ и помощь по этапам ввоза.</li>
              <li>Сводка по стоимости: доставка + платежи (в формате ориентировочной цены).</li>
            </ul>
          </section>

          <LeadForm
            title="Заказать расчёт доставки из Китая"
            lead="Опишите желаемый автомобиль — подготовим ориентировочный расчёт под ключ до РФ."
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

