import Head from "next/head";
import Link from "next/link";

import LeadForm from "../components/LeadForm";
import { absoluteUrl } from "../lib/siteUrl";
import SiteHeader from "../components/SiteHeader";

const CANONICAL_PATH = "/dostavka-avtovozom-iz-kitaya";
const TITLE = "Доставка авто автовозом из Китая | Автовозом";
const DESCRIPTION =
  "Автовозом — доставка авто из Китая под заказ: подбор, выкуп, перевозка до вашего города и помощь с растаможкой. Оставьте заявку на расчёт.";

export default function DeliveryByCarCarrierPage() {
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: [
      {
        "@type": "Question",
        name: "Что значит доставка авто автовозом?",
        acceptedAnswer: {
          "@type": "Answer",
          text: "Автовоз — это грузовик для перевозки нескольких машин сразу. Автомобиль едет на платформе, а не своим ходом, поэтому не набирает пробег и меньше подвержен повреждениям в пути. На наземных участках маршрута из Китая и по России это обычный способ перевозки.",
        },
      },
      {
        "@type": "Question",
        name: "Можно ли привезти авто из Китая автовозом?",
        acceptedAnswer: {
          "@type": "Answer",
          text: "Да. Маршрут складывается из нескольких этапов, и наземные участки проходят автовозом или автомобильным транспортом. Конкретную схему перевозки мы согласуем под ваш заказ и город доставки.",
        },
      },
      {
        "@type": "Question",
        name: "Сколько стоит доставка авто автовозом из Китая?",
        acceptedAnswer: {
          "@type": "Answer",
          text: "Стоимость зависит от модели, маршрута и города доставки. Мы считаем ориентировочную сумму под ключ вместе с платежами и показываем разбивку по этапам до согласования заказа.",
        },
      },
      {
        "@type": "Question",
        name: "Чем Автовозом отличается от самостоятельного перегона?",
        acceptedAnswer: {
          "@type": "Answer",
          text: "Вам не нужно ехать в Китай, искать продавца и договариваться напрямую. Автовозом берёт на себя подбор, проверку и выкуп автомобиля, перевозку до РФ и сопровождение по этапам оформления.",
        },
      },
    ],
  };

  return (
    <div className="layout">
      <Head>
        <title>{TITLE}</title>
        <meta name="description" content={DESCRIPTION} />
        <link rel="canonical" href={absoluteUrl(CANONICAL_PATH)} />
        <meta property="og:title" content={TITLE} />
        <meta property="og:description" content={DESCRIPTION} />
        <meta property="og:url" content={absoluteUrl(CANONICAL_PATH)} />
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
          <h1 className="section-title">Доставка авто автовозом из Китая</h1>
          <p className="muted">
            <b>Автовозом</b> — сервис заказа автомобилей из Китая под ключ. Подбираем и проверяем
            машину, выкупаем её у продавца и организуем перевозку до вашего города, а затем
            помогаем пройти этапы ввоза и растаможки.
          </p>

          <section className="panel landing-section">
            <h2 className="section-title section-title--flush-top landing-section__title">
              Почему автовозом, а не своим ходом
            </h2>
            <ul className="landing-list landing-list--compact">
              <li>Автомобиль едет на платформе и не набирает пробег в дороге.</li>
              <li>Меньше риска повреждений, чем при перегоне своим ходом.</li>
              <li>Не нужны транзитные номера, страховки и водитель на весь маршрут.</li>
              <li>Несколько машин идут одной отправкой — перевозка выходит дешевле.</li>
            </ul>
          </section>

          <section className="panel landing-section">
            <h2 className="section-title section-title--flush-top landing-section__title">
              Как проходит заказ
            </h2>
            <ol className="landing-list">
              <li>Вы оставляете запрос: марка, модель и желаемые параметры.</li>
              <li>Подбираем варианты, согласуем условия и готовим расчёт под ключ.</li>
              <li>Организуем выкуп автомобиля и перевозку до РФ.</li>
              <li>Помогаем с этапами оформления и ориентируем по срокам.</li>
            </ol>
            <p className="muted">
              Маршрут складывается из нескольких этапов, наземные участки проходят автовозом или
              автомобильным транспортом. Схему перевозки согласуем под ваш заказ и город доставки.
            </p>
          </section>

          <section className="panel landing-section--tight">
            <h2 className="section-title section-title--flush-top landing-section__title">
              Что входит в стоимость
            </h2>
            <ul className="landing-list landing-list--compact">
              <li>Подбор и проверка модели перед заказом.</li>
              <li>Выкуп автомобиля на согласованных условиях.</li>
              <li>Перевозка до России и помощь по этапам ввоза.</li>
              <li>
                Сводка по стоимости: цена автомобиля, доставка и платежи. Прикинуть платежи
                самостоятельно можно в{" "}
                <Link href="/customs-calculator">калькуляторе растаможки</Link>.
              </li>
            </ul>
          </section>

          <LeadForm
            title="Рассчитать доставку автовозом"
            lead="Опишите желаемый автомобиль — подготовим ориентировочный расчёт под ключ до вашего города."
          />

          <div className="landing-cta-row">
            <Link href="/catalog" className="btn btn-primary">
              Смотреть каталог
            </Link>
            <Link href="/dostavka-avto-iz-kitaya" className="btn btn-secondary">
              Доставка из Китая под ключ
            </Link>
          </div>
        </div>
      </main>
    </div>
  );
}
