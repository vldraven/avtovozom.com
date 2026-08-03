import { Head, Html, Main, NextScript } from "next/document";

/** Токены подтверждения прав в Яндекс.Вебмастере / Google Search Console (необязательно). */
const YANDEX_VERIFICATION = (process.env.NEXT_PUBLIC_YANDEX_VERIFICATION || "").trim();
const GOOGLE_VERIFICATION = (process.env.NEXT_PUBLIC_GOOGLE_VERIFICATION || "").trim();

/** Глушит ошибки расширений (MetaMask и т.п.) до регистрации Next.js overlay. */
const EXTENSION_NOISE_GUARD = `
(function () {
  if (window.__AVTOVOZOM_EXTENSION_ERROR_GUARD__) return;
  window.__AVTOVOZOM_EXTENSION_ERROR_GUARD__ = true;

  function textOf(value) {
    if (!value) return "";
    return String(
      value.message ||
        (value.error && value.error.message) ||
        (value.reason && value.reason.message) ||
        value.error ||
        value.reason ||
        value
    );
  }

  function stackOf(value) {
    if (!value) return "";
    return String(
      value.stack ||
        (value.error && value.error.stack) ||
        (value.reason && value.reason.stack) ||
        ""
    );
  }

  function fileOf(eventOrFilename) {
    if (!eventOrFilename) return "";
    if (typeof eventOrFilename === "string") return eventOrFilename;
    return String(
      eventOrFilename.filename ||
        (eventOrFilename.target && eventOrFilename.target.src) ||
        ""
    );
  }

  function isNoise(value, eventOrFilename) {
    try {
      var msg = textOf(value);
      var stack = stackOf(value);
      var file = fileOf(eventOrFilename);
      return (
        /MetaMask|Failed to connect to MetaMask/i.test(msg) ||
        /chrome-extension:\\/\\//i.test(msg + stack + file)
      );
    } catch (e) {
      return false;
    }
  }
  window.addEventListener(
    "error",
    function (event) {
      if (!isNoise(event.error || event.message || event, event)) return;
      event.preventDefault();
      event.stopImmediatePropagation();
    },
    true
  );
  window.addEventListener(
    "unhandledrejection",
    function (event) {
      if (!isNoise(event.reason || event, event)) return;
      event.preventDefault();
      event.stopImmediatePropagation();
    },
    true
  );
})();
`;

export default function Document() {
  return (
    <Html lang="ru">
      <Head>
        <script dangerouslySetInnerHTML={{ __html: EXTENSION_NOISE_GUARD }} />
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
