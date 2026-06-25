import Link from "next/link";

import { TELEGRAM_CHANNEL_URL } from "../lib/telegramChannel";

const FOOTER_LINKS = [
  { href: "/catalog", label: "Каталог" },
  { href: "/dostavka-avto-iz-kitaya", label: "Доставка из Китая" },
  { href: "/dostavka-avto-iz-korei", label: "Доставка из Кореи" },
  { href: "/customs-calculator", label: "Калькулятор растаможки" },
  { href: "/faq", label: "Вопросы и ответы" },
  { href: "/request-quote", label: "Заявка на расчёт" },
];

/** Сквозной футер с внутренними ссылками (SEO-перелинковка). */
export default function SiteFooter() {
  const year = new Date().getFullYear();

  return (
    <footer className="site-footer">
      <div className="container site-footer__inner">
        <div className="site-footer__brand">
          <Link href="/" className="site-footer__logo">
            avtovozom
          </Link>
        </div>
        <nav className="site-footer__nav" aria-label="Разделы сайта">
          <ul className="site-footer__links">
            {FOOTER_LINKS.map((item) => (
              <li key={item.href}>
                <Link href={item.href}>{item.label}</Link>
              </li>
            ))}
            <li>
              <a href={TELEGRAM_CHANNEL_URL} target="_blank" rel="noopener noreferrer">
                Telegram-канал
              </a>
            </li>
          </ul>
        </nav>
        <p className="site-footer__copy muted">© {year} avtovozom.com</p>
      </div>
    </footer>
  );
}
