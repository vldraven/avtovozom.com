import { Head, Html, Main, NextScript } from "next/document";

/** Токены подтверждения прав в Яндекс.Вебмастере / Google Search Console (необязательно). */
const YANDEX_VERIFICATION = (process.env.NEXT_PUBLIC_YANDEX_VERIFICATION || "").trim();
const GOOGLE_VERIFICATION = (process.env.NEXT_PUBLIC_GOOGLE_VERIFICATION || "").trim();

export default function Document() {
  return (
    <Html lang="ru">
      <Head>
        <meta httpEquiv="content-language" content="ru" />
        {YANDEX_VERIFICATION ? (
          <meta name="yandex-verification" content={YANDEX_VERIFICATION} />
        ) : null}
        {GOOGLE_VERIFICATION ? (
          <meta name="google-site-verification" content={GOOGLE_VERIFICATION} />
        ) : null}
        <link rel="icon" href="/favicon.png" type="image/png" sizes="192x192" />
        <link rel="apple-touch-icon" href="/favicon.png" />
        <link rel="mask-icon" href="/favicon.png" color="#0f172a" />
      </Head>
      <body>
        <Main />
        <NextScript />
      </body>
    </Html>
  );
}
