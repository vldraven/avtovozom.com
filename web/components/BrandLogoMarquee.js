import Link from "next/link";

import { mediaSrc } from "../lib/media";

function BrandLogoItem({ brand, eager, tile }) {
  return (
    <Link
      href={`/catalog/${brand.slug}`}
      className={tile ? "brand-logo-marquee__tile" : "brand-logo-marquee__item"}
      title={brand.name}
    >
      <img
        src={mediaSrc(brand.logo_storage_url)}
        alt=""
        width={tile ? 48 : 48}
        height={tile ? 48 : 48}
        loading={eager ? "eager" : "lazy"}
        decoding="async"
        draggable={false}
      />
      {tile ? null : <span className="brand-logo-marquee__name">{brand.name}</span>}
    </Link>
  );
}

/**
 * Горизонтальная бегущая строка логотипов марок (быстрые фильтры → каталог).
 * variant="home" — плитки нового дизайна (только лого, без подписи).
 */
export default function BrandLogoMarquee({ brands, variant = "default" }) {
  if (!brands?.length) return null;
  const tile = variant === "home";

  return (
    <div
      className={`brand-logo-marquee${tile ? " brand-logo-marquee--home" : ""}`}
      aria-label="Популярные марки"
    >
      <div className="brand-logo-marquee__viewport">
        <div className="brand-logo-marquee__track">
          <div className="brand-logo-marquee__group">
            {brands.map((brand) => (
              <BrandLogoItem key={brand.id} brand={brand} eager tile={tile} />
            ))}
          </div>
          <div className="brand-logo-marquee__group" aria-hidden="true">
            {brands.map((brand) => (
              <BrandLogoItem key={`dup-${brand.id}`} brand={brand} tile={tile} />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
