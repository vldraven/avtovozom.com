import Link from "next/link";

/**
 * @param {{ label: string, href?: string }[]} items
 * Элемент с href — ссылка; без href — текст (обычно текущая страница).
 */
export default function Breadcrumbs({ items, className = "" }) {
  if (!items?.length) return null;
  return (
    <nav className={`breadcrumbs ${className}`.trim()} aria-label="Навигационная цепочка">
      <ol className="breadcrumbs__list">
        {items.map((it, i) => {
          const last = i === items.length - 1;
          return (
            <li key={`${i}-${it.label}`} className="breadcrumbs__item">
              {it.href ? (
                <Link href={it.href} className="breadcrumbs__link">
                  {it.label}
                </Link>
              ) : (
                <span className={last ? "breadcrumbs__current" : "breadcrumbs__text"}>{it.label}</span>
              )}
              {!last ? (
                <span className="breadcrumbs__sep" aria-hidden>
                  /
                </span>
              ) : null}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
