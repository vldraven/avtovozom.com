import {
  carBaseTotalRub,
  carOfferDiscountPercent,
  carSpecialOfferRub,
  formatRubInt,
} from "../lib/carCardMeta";

/**
 * Цена «под ключ»: при спецпредложении — зачёркнутая база + акция + бейдж.
 * variant: "catalog" | "home" | "detail" | "dealer"
 */
export default function CarTurnkeyPrice({
  car,
  variant = "catalog",
  className = "",
  showSuffix = true,
  cnyFallback = true,
}) {
  if (!car) return null;

  const base = carBaseTotalRub(car);
  const offer = carSpecialOfferRub(car);
  const discount = carOfferDiscountPercent(car);
  const hasOffer = offer != null;
  const display = hasOffer ? offer : base;
  const showStrike = hasOffer && base != null && Math.round(Number(base)) !== Math.round(Number(offer));

  if (display == null) {
    if (!cnyFallback || car.price_cny == null) return null;
    const cny = Math.round(Number(car.price_cny)).toLocaleString("ru-RU");
    if (variant === "home") {
      return (
        <p className={className || undefined}>
          <strong>{cny} ¥</strong>
        </p>
      );
    }
    if (variant === "detail") {
      return <p className={["detail-price", className].filter(Boolean).join(" ")}>{cny} ¥</p>;
    }
    if (variant === "dealer") {
      return <span className={className}>{cny} ¥</span>;
    }
    return (
      <p className={["catalog-card__price", className].filter(Boolean).join(" ")}>
        {cny} ¥
        <span className="text-muted catalog-price-cny-note"> CNY</span>
      </p>
    );
  }

  const rubLabel = `${formatRubInt(display)} ₽`;
  const badgeLabel = discount != null ? `−${discount}%` : "Спецпредложение";
  const rootCls = ["car-price", `car-price--${variant}`, hasOffer ? "car-price--offer" : "", className]
    .filter(Boolean)
    .join(" ");

  const badge = hasOffer ? <span className="car-price__badge">{badgeLabel}</span> : null;
  const was = showStrike ? (
    <span className="car-price__was">{formatRubInt(base)} ₽</span>
  ) : null;
  const nowWithBadge = (
    <span className="car-price__main">
      <strong className="car-price__now">{rubLabel}</strong>
      {badge}
    </span>
  );

  if (variant === "home") {
    return (
      <p className={rootCls}>
        {was}
        {nowWithBadge}
        {showSuffix ? <span className="car-price__suffix">под ключ</span> : null}
      </p>
    );
  }

  if (variant === "detail") {
    return (
      <div className={rootCls}>
        <div className="car-price__row">
          {was}
          <p className="detail-price detail-price--rf car-price__now">{rubLabel}</p>
          {badge}
        </div>
      </div>
    );
  }

  if (variant === "dealer") {
    return (
      <span className={rootCls}>
        {was}
        {nowWithBadge}
        {showSuffix ? <span className="car-price__suffix"> (РФ)</span> : null}
      </span>
    );
  }

  return (
    <p className={["catalog-card__price", rootCls].filter(Boolean).join(" ")}>
      {was}
      <span className="car-price__main">
        <strong className="catalog-price-rub car-price__now">{rubLabel}</strong>
        {badge}
      </span>
      {showSuffix ? <span className="text-muted catalog-price-sub car-price__suffix">под ключ</span> : null}
    </p>
  );
}
