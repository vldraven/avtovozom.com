import Head from "next/head";
import Link from "next/link";

import SiteHeader from "../components/SiteHeader";
import MaxIcon from "../components/MaxIcon";
import { COMPANY, phoneHref } from "../lib/companyInfo";
import { breadcrumbListJsonLd, jsonLdScriptProps } from "../lib/schema";
import { absoluteUrl } from "../lib/siteUrl";
import { getServerApiBase } from "../lib/serverApiUrl";

const CANONICAL_PATH = "/about";
const TITLE = "О компании Автовозом — подбор и доставка авто из Китая";
const DESCRIPTION =
  "Автовозом — сервис подбора и доставки автомобилей из Китая напрямую от дилеров: проверка, выкуп, перевозка и сопровождение растаможки.";

const TG_ICON = (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <path
      d="M21 4 3 11.4c-1 .4-1 1.9.1 2.2l4.4 1.4 1.7 5.5c.3 1 1.6 1.2 2.2.4l2.4-3 4.5 3.4c.9.7 2.2.2 2.4-.9L23.9 5c.2-1.1-.9-1.9-1.9-1.5Zm-3.4 3.4-8.8 7.9-.4 3.4-1.6-5 9.7-7.6c.4-.3.9.2.5.6L9.8 14"
      fill="currentColor"
    />
  </svg>
);

const MAX_ICON = <MaxIcon size={18} />;

const PHONE_ICON = (
  <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1 1 .4 2 .7 2.9a2 2 0 0 1-.5 2.1L8 10a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.5c.9.3 1.9.6 2.9.7a2 2 0 0 1 1.7 2Z" />
  </svg>
);

const HOW_STEPS = [
  {
    n: "1",
    title: "Проверенные дилеры",
    body: "Находим предложения напрямую у дилеров в Китае и проверяем автомобиль перед покупкой.",
  },
  {
    n: "2",
    title: "Прозрачная цена",
    body: "Сразу показываем расчёт с курсом, расходами в Китае, таможенными платежами и доставкой по России.",
  },
  {
    n: "3",
    title: "Всё в личном кабинете",
    body: "Статусы, документы, фотографии и результаты осмотра автомобиля хранятся в одном защищённом чате.",
  },
];

export async function getStaticProps() {
  let listingsCount = 0;
  try {
    const api = getServerApiBase();
    const res = await fetch(`${api}/cars?limit=1`, { headers: { Accept: "application/json" } });
    if (res.ok) {
      const d = await res.json();
      listingsCount = Number(d.total) || 0;
    }
  } catch {
    /* API недоступен при сборке — покажем 0 */
  }
  return { props: { listingsCount }, revalidate: 300 };
}

export default function AboutPage({ listingsCount = 0 }) {
  const jsonLd = breadcrumbListJsonLd([
    { label: "Главная", href: "/" },
    { label: "О компании" },
  ]);

  const tel = phoneHref();

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
        <div className="container">

          {/* Hero */}
          <section className="about-hero">
            <div className="about-hero__text">
              <p className="about-hero__eyebrow">О компании</p>
              <h1 className="about-hero__h1">
                Автомобили из Китая напрямую от проверенных дилеров
              </h1>
              <p className="about-hero__lead">
                Подбираем и проверяем автомобили в Китае, рассчитываем полную стоимость до вашего
                города и сопровождаем сделку на всех этапах — от выкупа до таможенного оформления
                и доставки.
              </p>
              <div className="about-hero__cta">
                <a
                  href={COMPANY.telegramUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="btn about-btn-tg"
                >
                  {TG_ICON}
                  Написать в Telegram
                </a>
                <a
                  href={COMPANY.maxUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="btn about-btn-max"
                >
                  {MAX_ICON}
                  Написать в MAX
                </a>
                {COMPANY.phone ? (
                  <a href={`tel:${tel}`} className="btn about-btn-phone">
                    {PHONE_ICON}
                    {COMPANY.phone}
                  </a>
                ) : null}
              </div>
            </div>
            <div className="about-hero__img">
              <Link href="/" className="about-hero__logo-link" aria-label="На главную">
                <img src="/logo-hero.png" alt="" className="about-hero__logo" />
              </Link>
            </div>
          </section>

          {/* Stats */}
          <div className="about-stats">
            <div className="about-stats__item">
              <p className="about-stats__value">6–8 недель</p>
              <p className="about-stats__label">средний срок доставки</p>
            </div>
            <div className="about-stats__item">
              <p className="about-stats__value">0 ₽</p>
              <p className="about-stats__label">за подбор и расчёт</p>
            </div>
            <div className="about-stats__item">
              <p className="about-stats__value">{listingsCount > 0 ? listingsCount.toLocaleString("ru-RU") : "—"}</p>
              <p className="about-stats__label">Авто доступно в каталоге</p>
            </div>
          </div>

          {/* How we work */}
          <section className="about-how" aria-labelledby="about-how-title">
            <h2 id="about-how-title" className="about-how__title">
              Как мы работаем
            </h2>
            <div className="about-how__grid">
              {HOW_STEPS.map((s) => (
                <div key={s.n} className="about-how__card">
                  <span className="about-how__num">{s.n}</span>
                  <p className="about-how__card-title">{s.title}</p>
                  <p className="about-how__card-body">{s.body}</p>
                </div>
              ))}
            </div>
          </section>

          {/* CTA band */}
          <section className="about-cta-band" aria-label="Связаться с нами">
            <p className="about-cta-band__title">Есть вопрос — напишите нам</p>
            <div className="about-cta-band__actions">
              <a
                href={COMPANY.telegramUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="about-cta-band__btn about-cta-band__btn--tg"
              >
                {TG_ICON}
                Написать в Telegram
              </a>
              <a
                href={COMPANY.maxUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="about-cta-band__btn about-cta-band__btn--max"
              >
                {MAX_ICON}
                Написать в MAX
              </a>
              {COMPANY.phone ? (
                <a href={`tel:${tel}`} className="about-cta-band__btn about-cta-band__btn--phone">
                  {PHONE_ICON}
                  {COMPANY.phone}
                </a>
              ) : null}
            </div>
            <div className="about-cta-band__secondary">
              <Link href="/catalog" className="btn btn-ghost">
                Смотреть каталог
              </Link>
              <Link href="/request-quote" className="btn btn-ghost">
                Заявка на расчёт
              </Link>
              <Link href="/contacts" className="btn btn-ghost">
                Контакты и реквизиты
              </Link>
            </div>
          </section>

        </div>
      </main>
    </div>
  );
}
