import { useEffect } from "react";
import { useRouter } from "next/router";
import Script from "next/script";

/**
 * Номер счётчика из кабинета Метрики (только цифры).
 * @see https://metrika.yandex.ru/
 */
function getCounterId() {
  const raw = process.env.NEXT_PUBLIC_YANDEX_METRIKA_ID;
  if (raw == null || String(raw).trim() === "") return null;
  const s = String(raw).trim();
  return /^\d+$/.test(s) ? s : null;
}

export default function YandexMetrika() {
  const router = useRouter();
  const counterId = getCounterId();

  useEffect(() => {
    if (!counterId || typeof window === "undefined" || !window.ym) return;

    const onRouteChangeComplete = () => {
      try {
        window.ym(Number(counterId), "hit", window.location.href, {
          title: document.title,
        });
      } catch {
        /* ignore */
      }
    };

    router.events.on("routeChangeComplete", onRouteChangeComplete);
    return () => {
      router.events.off("routeChangeComplete", onRouteChangeComplete);
    };
  }, [router.events, counterId]);

  if (!counterId) return null;

  const inline = `
(function(m,e,t,r,i,k,a){m[i]=m[i]||function(){(m[i].a=m[i].a||[]).push(arguments)};
m[i].l=1*new Date();
for (var j = 0; j < document.scripts.length; j++) {if (document.scripts[j].src === r) { return; }}
k=e.createElement(t),a=e.getElementsByTagName(t)[0],k.async=1,k.src=r,a.parentNode.insertBefore(k,a)})
(window, document, "script", "https://mc.yandex.ru/metrika/tag.js", "ym");

ym(${counterId}, "init", {
  ssr:true,
  webvisor:true,
  clickmap:true,
  ecommerce:"dataLayer",
  referrer: document.referrer,
  url: location.href,
  trackLinks:true,
  accurateTrackBounce:true
});
`;

  return (
    <>
      <Script id="yandex-metrika" strategy="afterInteractive" dangerouslySetInnerHTML={{ __html: inline }} />
      <noscript>
        <div>
          <img
            src={`https://mc.yandex.ru/watch/${counterId}`}
            style={{ position: "absolute", left: "-9999px" }}
            alt=""
          />
        </div>
      </noscript>
    </>
  );
}
