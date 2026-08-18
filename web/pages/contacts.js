import Head from "next/head";
import Link from "next/link";

import SiteHeader from "../components/SiteHeader";
import { COMPANY, hasLegalRequisites, phoneHref } from "../lib/companyInfo";
import { breadcrumbListJsonLd, jsonLdScriptProps, organizationContactJsonLd } from "../lib/schema";
import { absoluteUrl } from "../lib/siteUrl";

const CANONICAL_PATH = "/contacts";
const TITLE = "Контакты Автовозом — связаться и реквизиты";
const DESCRIPTION =
  "Контакты сервиса Автовозом: email, Telegram и юридические реквизиты ООО «АВТОВОЗОМ». Оставьте заявку на расчёт доставки авто из Китая.";

export default function ContactsPage() {
  const telHref = phoneHref();
  const jsonLd = [
    breadcrumbListJsonLd([
      { label: "Главная", href: "/" },
      { label: "Контакты" },
    ]),
    organizationContactJsonLd(),
  ].filter(Boolean);

  return (
    <div className="layout">
      <Head>
        <title>{TITLE}</title>
        <meta name="description" content={DESCRIPTION} />
        <link rel="canonical" href={absoluteUrl(CANONICAL_PATH)} />
        <meta property="og:title" content={TITLE} />
        <meta property="og:description" content={DESCRIPTION} />
        <meta property="og:url" content={absoluteUrl(CANONICAL_PATH)} />
        {jsonLd.length ? <script {...jsonLdScriptProps(jsonLd)} /> : null}
      </Head>

      <SiteHeader tagline="Контакты">
        <Link href="/about" className="btn btn-ghost btn-sm">
          О компании
        </Link>
        <Link href="/request-quote" className="btn btn-secondary btn-sm">
          Заявка
        </Link>
      </SiteHeader>

      <main className="site-main">
        <div className="container page-narrow">
          <h1 className="section-title">Контакты</h1>
          <p className="muted">
            Напишите {COMPANY.brandName} на почту, в Telegram или оставьте заявку — поможем с
            подбором и расчётом доставки авто из Китая.
          </p>

          <section className="panel landing-section" aria-labelledby="contacts-channels-title">
            <h2
              id="contacts-channels-title"
              className="section-title section-title--flush-top landing-section__title"
            >
              Как связаться
            </h2>
            <dl className="company-contacts">
              {COMPANY.phone ? (
                <>
                  <dt>Телефон</dt>
                  <dd>
                    <a href={`tel:${telHref}`}>{COMPANY.phone}</a>
                  </dd>
                </>
              ) : null}
              <dt>Email</dt>
              <dd>
                <a href={`mailto:${COMPANY.email}`}>{COMPANY.email}</a>
              </dd>
              <dt>Telegram</dt>
              <dd>
                <a href={COMPANY.telegramUrl} target="_blank" rel="noopener noreferrer">
                  @avtovozom
                </a>
              </dd>
              {COMPANY.workingHours ? (
                <>
                  <dt>График</dt>
                  <dd>{COMPANY.workingHours}</dd>
                </>
              ) : null}
              {COMPANY.city ? (
                <>
                  <dt>Город</dt>
                  <dd>{COMPANY.city}</dd>
                </>
              ) : null}
            </dl>
            <div className="landing-cta-row">
              <Link href="/request-quote" className="btn btn-primary">
                Заявка на расчёт
              </Link>
              <Link href="/faq" className="btn btn-ghost">
                Частые вопросы
              </Link>
            </div>
          </section>

          {hasLegalRequisites() ? (
            <section className="panel landing-section" aria-labelledby="contacts-legal-title">
              <h2
                id="contacts-legal-title"
                className="section-title section-title--flush-top landing-section__title"
              >
                Реквизиты
              </h2>
              <dl className="company-contacts">
                <dt>Юридическое лицо</dt>
                <dd>{COMPANY.legalName}</dd>
                <dt>ИНН</dt>
                <dd>{COMPANY.inn}</dd>
                {COMPANY.ogrn ? (
                  <>
                    <dt>ОГРН</dt>
                    <dd>{COMPANY.ogrn}</dd>
                  </>
                ) : null}
                {COMPANY.kpp ? (
                  <>
                    <dt>КПП</dt>
                    <dd>{COMPANY.kpp}</dd>
                  </>
                ) : null}
                {COMPANY.address ? (
                  <>
                    <dt>Юридический адрес</dt>
                    <dd>{COMPANY.address}</dd>
                  </>
                ) : null}
              </dl>
            </section>
          ) : null}

          <p className="muted landing-section--tight">
            Подробнее о сервисе — на странице <Link href="/about">О компании</Link>.
          </p>
        </div>
      </main>
    </div>
  );
}
