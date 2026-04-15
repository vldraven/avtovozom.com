import Head from "next/head";
import { useRouter } from "next/router";

import MobileBottomNav from "../components/MobileBottomNav";
import "../styles/globals.css";

/** Личные кабинеты и админка — не индексируем (дублирует robots.txt Disallow). */
function useSeoNoIndex() {
  const router = useRouter();
  const path = router.pathname || "";
  return /^(?:\/auth|\/profile|\/messages)(?:\/|$)/.test(path) || path.startsWith("/staff/");
}

export default function App({ Component, pageProps }) {
  const noindex = useSeoNoIndex();

  return (
    <>
      <Head>
        <title>avtovozom — каталог автомобилей</title>
        <meta
          name="viewport"
          content="width=device-width, initial-scale=1, viewport-fit=cover"
        />
        <meta name="theme-color" content="#0f172a" />
        <meta
          name="description"
          content="Каталог автомобилей из Китая: подбор, доставка и сопровождение сделки."
        />
        {noindex ? <meta name="robots" content="noindex, nofollow" /> : null}
        <meta property="og:site_name" content="avtovozom" />
        <meta property="og:locale" content="ru_RU" />
        <meta property="og:type" content="website" />
        <meta name="twitter:card" content="summary_large_image" />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Manrope:wght@400;500;600;700&display=swap"
          rel="stylesheet"
        />
      </Head>
      <div className="app-chrome">
        <Component {...pageProps} />
        <MobileBottomNav />
      </div>
    </>
  );
}
