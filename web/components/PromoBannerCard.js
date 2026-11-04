import Link from "next/link";

import { promoCtaHref, trackPromoClick } from "../lib/promo";
import { mediaSrc } from "../lib/media";

function imageSrc(url) {
  if (!url) return "";
  if (url.startsWith("/promo/")) return url;
  return mediaSrc(url, 960) || url;
}

/**
 * Баннер акции для сайдбара / ленты каталога и блога.
 * variant: sidebar | feed
 */
export default function PromoBannerCard({
  campaign,
  placement,
  variant = "sidebar",
  className = "",
}) {
  if (!campaign || !placement) return null;
  const href = promoCtaHref(campaign);
  const accent = campaign.accent_color || "#d9f43a";
  const badge = placement.badge || campaign.title_accent || "−30%";
  const title = placement.title || campaign.title_rest?.replace(/\n/g, " ") || "";
  const kicker = placement.kicker || campaign.eyebrow || "";
  const cta = placement.cta_label || campaign.cta_label || "Оставить заявку";
  const img = imageSrc(placement.image_url || campaign.hero_image_url);

  function onClick() {
    trackPromoClick({ id: campaign.slug || campaign.promo_code, placement: placement.placement });
  }

  return (
    <Link
      href={href}
      className={`promo-banner promo-banner--${variant} ${className}`.trim()}
      style={{ "--promo-accent": accent }}
      onClick={onClick}
    >
      {img ? (
        <span className="promo-banner__media" aria-hidden>
          <img src={img} alt="" />
          <span className="promo-banner__media-fade" />
        </span>
      ) : null}
      <span className="promo-banner__body">
        {badge ? <span className="promo-banner__badge">{badge}</span> : null}
        {title ? <span className="promo-banner__title">{title}</span> : null}
        {kicker ? <span className="promo-banner__kicker">{kicker}</span> : null}
        <span className="promo-banner__cta">{cta}</span>
      </span>
    </Link>
  );
}
