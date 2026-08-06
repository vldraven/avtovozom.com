import Link from "next/link";

import { TELEGRAM_CHANNEL_URL } from "../lib/telegramChannel";

/** Сквозной футер по макету «35 · Главная · авторизован» (SEO-перелинковка). */
export default function SiteFooter() {
  return (
    <footer className="site-footer">
      <div className="container site-footer__inner">
        <div className="site-footer__brand">
          <Link href="/" className="site-footer__logo">
            avtovozom
          </Link>
          <p className="site-footer__tagline">
            Платформа подбора и доставки автомобилей из Китая напрямую от дилеров
          </p>
        </div>

        <div className="site-footer__cols">
          <div className="site-footer__col">
            <p className="site-footer__col-title">Платформа</p>
            <Link href="/catalog">Каталог</Link>
            <Link href="/customs-calculator">Калькулятор</Link>
          </div>
          <div className="site-footer__col">
            <p className="site-footer__col-title">Помощь</p>
            <Link href="/faq">FAQ общий</Link>
            <Link href="/dostavka-avto-iz-kitaya">Доставка из Китая</Link>
            <Link href="/dostavka-avtovozom-iz-kitaya">Доставка автовозом</Link>
          </div>
          <div className="site-footer__col">
            <p className="site-footer__col-title">Контакты</p>
            <a href="mailto:hello@avtovozom.com">hello@avtovozom.com</a>
            <a href={TELEGRAM_CHANNEL_URL} target="_blank" rel="noopener noreferrer">
              Telegram
            </a>
          </div>
        </div>
      </div>
    </footer>
  );
}
