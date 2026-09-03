import Head from "next/head";
import Link from "next/link";

import SiteHeader from "../components/SiteHeader";
import MaxIcon from "../components/MaxIcon";
import { COMPANY, hasLegalRequisites, phoneHref } from "../lib/companyInfo";
import { breadcrumbListJsonLd, jsonLdScriptProps, organizationContactJsonLd } from "../lib/schema";
import { absoluteUrl } from "../lib/siteUrl";

const CANONICAL_PATH = "/contacts";
const TITLE = "Контакты Автовозом — связаться и реквизиты";
const DESCRIPTION =
  "Контакты сервиса Автовозом: телефон, email, Telegram, MAX и юридические реквизиты ООО «АВТОВОЗОМ». Оставьте заявку на расчёт доставки авто из Китая.";

function TgIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M21 4 3 11.4c-1 .4-1 1.9.1 2.2l4.4 1.4 1.7 5.5c.3 1 1.6 1.2 2.2.4l2.4-3 4.5 3.4c.9.7 2.2.2 2.4-.9L23.9 5c.2-1.1-.9-1.9-1.9-1.5Zm-3.4 3.4-8.8 7.9-.4 3.4-1.6-5 9.7-7.6c.4-.3.9.2.5.6L9.8 14"
        fill="currentColor"
      />
    </svg>
  );
}

function PhoneIcon({ color = "currentColor" }) {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1 1 .4 2 .7 2.9a2 2 0 0 1-.5 2.1L8 10a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.5c.9.3 1.9.6 2.9.7a2 2 0 0 1 1.7 2Z" />
    </svg>
  );
}

function EmailIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M4 6h16v12H4z" />
      <path d="m4 7 8 6 8-6" />
    </svg>
  );
}

function PinIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 22s7-6.5 7-12a7 7 0 1 0-14 0c0 5.5 7 12 7 12Z" />
      <circle cx="12" cy="10" r="2.5" />
    </svg>
  );
}

function ChevronRight() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="m9 18 6-6-6-6" />
    </svg>
  );
}

export default function ContactsPage() {
  const tel = phoneHref();
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
        <div className="container">

          <div className="contacts-page">
            {/* Left column */}
            <div className="contacts-channels">
              <div className="contacts-page__head">
                <h1 className="contacts-page__h1">Контакты</h1>
                <p className="contacts-page__lead">
                  Свяжитесь с нами удобным способом — ответим быстро
                </p>
              </div>

              <div className="contacts-cards">
                {/* Telegram */}
                <a
                  href={COMPANY.telegramUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="contacts-card contacts-card--tg"
                >
                  <span className="contacts-card__icon"><TgIcon /></span>
                  <span className="contacts-card__body">
                    <span className="contacts-card__title">Telegram</span>
                    <span className="contacts-card__sub">{COMPANY.telegramHandle} · отвечаем быстро</span>
                  </span>
                  <span className="contacts-card__arrow"><ChevronRight /></span>
                </a>

                {/* MAX */}
                <a
                  href={COMPANY.maxUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="contacts-card contacts-card--max"
                >
                  <span className="contacts-card__icon"><MaxIcon size={22} /></span>
                  <span className="contacts-card__body">
                    <span className="contacts-card__title">MAX</span>
                    <span className="contacts-card__sub">{COMPANY.maxHandle} · канал в мессенджере</span>
                  </span>
                  <span className="contacts-card__arrow"><ChevronRight /></span>
                </a>

                {/* Phone */}
                {COMPANY.phone ? (
                  <a href={`tel:${tel}`} className="contacts-card contacts-card--white">
                    <span className="contacts-card__icon contacts-card__icon--dark"><PhoneIcon /></span>
                    <span className="contacts-card__body">
                      <span className="contacts-card__title contacts-card__title--dark">{COMPANY.phone}</span>
                      {COMPANY.workingHours ? (
                        <span className="contacts-card__sub">{COMPANY.workingHours}</span>
                      ) : null}
                    </span>
                    <span className="contacts-card__arrow contacts-card__arrow--muted"><ChevronRight /></span>
                  </a>
                ) : null}

                {/* Email */}
                <a href={`mailto:${COMPANY.email}`} className="contacts-card contacts-card--white">
                  <span className="contacts-card__icon contacts-card__icon--dark"><EmailIcon /></span>
                  <span className="contacts-card__body">
                    <span className="contacts-card__title contacts-card__title--dark">{COMPANY.email}</span>
                    <span className="contacts-card__sub">Ответ в течение дня</span>
                  </span>
                  <span className="contacts-card__arrow contacts-card__arrow--muted"><ChevronRight /></span>
                </a>

                {/* Address */}
                {COMPANY.address ? (
                  <div className="contacts-card contacts-card--white">
                    <span className="contacts-card__icon contacts-card__icon--dark"><PinIcon /></span>
                    <span className="contacts-card__body">
                      <span className="contacts-card__title contacts-card__title--dark">{COMPANY.address}</span>
                    </span>
                  </div>
                ) : null}
              </div>

              <Link href="/request-quote" className="btn contacts-cta-btn">
                Оставить заявку
              </Link>
            </div>

            {/* Right column — requisites */}
            <div className="contacts-aside">
              {hasLegalRequisites() ? (
                <div className="contacts-req">
                  <p className="contacts-req__label">Реквизиты</p>
                  <div className="contacts-req__grid">
                    <div className="contacts-req__item">
                      <p className="contacts-req__key">Наименование</p>
                      <p className="contacts-req__val">{COMPANY.legalName}</p>
                    </div>
                    <div className="contacts-req__item">
                      <p className="contacts-req__key">ИНН / КПП</p>
                      <p className="contacts-req__val">{COMPANY.inn}{COMPANY.kpp ? ` / ${COMPANY.kpp}` : ""}</p>
                    </div>
                    {COMPANY.ogrn ? (
                      <div className="contacts-req__item">
                        <p className="contacts-req__key">ОГРН</p>
                        <p className="contacts-req__val">{COMPANY.ogrn}</p>
                      </div>
                    ) : null}
                    {COMPANY.address ? (
                      <div className="contacts-req__item contacts-req__item--full">
                        <p className="contacts-req__key">Юридический адрес</p>
                        <p className="contacts-req__val">{COMPANY.address}</p>
                      </div>
                    ) : null}
                  </div>
                </div>
              ) : null}

              <p className="contacts-about-link muted">
                Подробнее о сервисе — на странице <Link href="/about">О компании</Link>.
              </p>
            </div>
          </div>

        </div>
      </main>
    </div>
  );
}
