import Head from "next/head";
import Link from "next/link";

import SiteHeader from "./SiteHeader";
import { LEGAL_DOCS_UPDATED } from "../lib/legalDocs";
import { breadcrumbListJsonLd, jsonLdScriptProps } from "../lib/schema";
import { absoluteUrl } from "../lib/siteUrl";

/**
 * @param {{
 *   meta: { path: string, title: string, description: string, h1: string },
 *   sections: { title: string, paragraphs: string[], list?: string[] }[],
 * }} props
 */
export default function LegalDocLayout({ meta, sections }) {
  const jsonLd = breadcrumbListJsonLd([
    { label: "Главная", href: "/" },
    { label: meta.h1 },
  ]);

  return (
    <div className="layout">
      <Head>
        <title>{meta.title}</title>
        <meta name="description" content={meta.description} />
        <link rel="canonical" href={absoluteUrl(meta.path)} />
        <meta property="og:title" content={meta.title} />
        <meta property="og:description" content={meta.description} />
        <meta property="og:url" content={absoluteUrl(meta.path)} />
        <script {...jsonLdScriptProps(jsonLd)} />
      </Head>
      <SiteHeader />
      <main className="container legal-doc">
        <nav className="legal-doc__crumbs" aria-label="Хлебные крошки">
          <Link href="/">Главная</Link>
          <span aria-hidden> / </span>
          <span>{meta.h1}</span>
        </nav>
        <h1 className="legal-doc__h1">{meta.h1}</h1>
        <p className="legal-doc__updated muted">Редакция от {LEGAL_DOCS_UPDATED}</p>
        {sections.map((section) => (
          <section key={section.title} className="legal-doc__section">
            <h2>{section.title}</h2>
            {(section.paragraphs || []).map((p) => (
              <p key={p.slice(0, 48)}>{p}</p>
            ))}
            {section.list?.length ? (
              <ul>
                {section.list.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            ) : null}
          </section>
        ))}
        <p className="legal-doc__nav muted">
          См. также:{" "}
          {meta.path === "/privacy" ? (
            <Link href="/terms">Пользовательское соглашение</Link>
          ) : (
            <Link href="/privacy">Политика обработки персональных данных</Link>
          )}
          {" · "}
          <Link href="/contacts">Контакты</Link>
        </p>
      </main>
    </div>
  );
}
