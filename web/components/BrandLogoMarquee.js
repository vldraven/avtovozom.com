import Link from "next/link";

import { mediaSrc } from "../lib/media";

function BrandLogoItem({ brand, eager }) {
  return (
    <Link
      href={`/catalog/${brand.slug}`}
      className="brand-logo-marquee__item"
      title={brand.name}
    >
      <img
        src={mediaSrc(brand.logo_storage_url)}
        alt=""
        width={40}
        height={40}
        loading={eager ? "eager" : "lazy"}
        decoding="async"
        draggable={false}
      />
      <span className="brand-logo-marquee__name">{brand.name}</span>
    </Link>
  );
}

/**
 * Горизонтальная бегущая строка логотипов марок (быстрые фильтры → каталог).
 */
export default function BrandLogoMarquee({ brands }) {
  if (!brands?.length) return null;

  return (
    <div className="brand-logo-marquee" aria-label="Популярные марки">
      <div className="brand-logo-marquee__viewport">
        <div className="brand-logo-marquee__track">
          <div className="brand-logo-marquee__group">
            {brands.map((brand) => (
              <BrandLogoItem key={brand.id} brand={brand} eager />
            ))}
          </div>
          <div className="brand-logo-marquee__group" aria-hidden="true">
            {brands.map((brand) => (
              <BrandLogoItem key={`dup-${brand.id}`} brand={brand} />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
