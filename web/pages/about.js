import Head from "next/head";
import Link from "next/link";

import SiteHeader from "../components/SiteHeader";
import { COMPANY } from "../lib/companyInfo";
import { breadcrumbListJsonLd, jsonLdScriptProps } from "../lib/schema";
import { absoluteUrl } from "../lib/siteUrl";

const CANONICAL_PATH = "/about";
const TITLE = "О компании Автовозом — подбор и доставка авто из Китая";
const DESCRIPTION =
  "Автовозом — сервис подбора и доставки автомобилей из Китая напрямую от дилеров: проверка, выкуп, перевозка и сопровождение растаможки.";

export default function AboutPage() {
  const jsonLd = breadcrumbListJsonLd([
    { label: "Главная", href: "/" },
    { label: "О компании" },
  ]);

  return (
    <div className="layout">
      <Head>
        <title>{TITLE}</title>
        <meta name="description" content={DESCRIPTION} />
        <link rel="canonical" href={absoluteUrl(CANONICAL_PATH)} />
        <meta property="og:title" content={TITLE} />
        <meta property="og:description" content={DESCRIPTION} />
        <meta property="og:url" content={absoluteUrl(CANONICAL_PATH)} />
        {jsonLd ? <script {...jsonLdScriptProps(jsonLd)} /> : null}
      </Head>

      <SiteHeader tagline="О компании">
        <Link href="/catalog" className="btn btn-ghost btn-sm">
          Каталог
        </Link>
        <Link href="/contacts" className="btn btn-secondary btn-sm">
          Контакты
        </Link>
      </SiteHeader>

      <main className="site-main">
        <div className="container page-narrow">
          <h1 className="section-title">О компании {COMPANY.brandName}</h1>
          <p className="muted">
            <b>{COMPANY.brandName}</b> — сервис заказа автомобилей из Китая под ключ. Мы помогаем
            подобрать машину у проверенных дилеров, согласовать комплектацию и бюджет, организовать
            выкуп и доставку до России, а также пройти этапы ввоза и растаможки.
          </p>

          <section className="panel landing-section" aria-labelledby="about-what-title">
            <h2 id="about-what-title" className="section-title section-title--flush-top landing-section__title">
              Что мы делаем
            </h2>
            <ul className="landing-list landing-list--compact">
              <li>Публикуем актуальные предложения дилеров в каталоге с ценой «под ключ» до Москвы.</li>
              <li>Считаем ориентировочную стоимость ввоза и растаможки в калькуляторе.</li>
              <li>Сопровождаем заявку от первого запроса до передачи автомобиля клиенту.</li>
              <li>Отвечаем на вопросы по срокам, документам и оплате в разделе FAQ.</li>
            </ul>
          </section>

          <section className="panel landing-section" aria-labelledby="about-how-title">
            <h2 id="about-how-title" className="section-title section-title--flush-top landing-section__title">
              Как устроен сервис
            </h2>
            <ol className="landing-list">
              <li>Вы выбираете авто в каталоге или оставляете заявку с параметрами.</li>
              <li>Мы уточняем комплектацию, проверяем продавца и согласуем итоговую смету.</li>
              <li>После оплаты организуем выкуп, перевозку и таможенное оформление.</li>
              <li>Передаём автомобиль с комплектом документов в согласованном городе.</li>
            </ol>
          </section>

          <section className="panel landing-section" aria-labelledby="about-trust-title">
            <h2 id="about-trust-title" className="section-title section-title--flush-top landing-section__title">
              Прозрачность и поддержка
            </h2>
            <p className="muted">
              На сайте показаны расчётные цены с учётом доставки и таможенных платежей — без скрытых
              доплат на этапе знакомства с предложением. По каждому заказу остаётся персональный
              контакт: можно написать в Telegram или оставить заявку на расчёт.
            </p>
            <p className="muted landing-section--tight">
              Юридические реквизиты и способы связи — на странице{" "}
              <Link href="/contacts">Контакты</Link>.
            </p>
          </section>

          <div className="landing-cta-row">
            <Link href="/catalog" className="btn btn-primary">
              Смотреть каталог
            </Link>
            <Link href="/request-quote" className="btn btn-secondary">
              Заявка на расчёт
            </Link>
            <Link href="/customs-calculator" className="btn btn-ghost">
              Калькулятор растаможки
            </Link>
          </div>
        </div>
      </main>
    </div>
  );
}
