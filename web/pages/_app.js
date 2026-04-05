import Head from "next/head";

import MobileBottomNav from "../components/MobileBottomNav";
import "../styles/globals.css";

export default function App({ Component, pageProps }) {
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
