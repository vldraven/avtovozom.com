import Link from "next/link";

import CatalogCardMedia from "./CatalogCardMedia";
import { carListingTitle, carSpecMetaBits, carTotalRub } from "../lib/carCardMeta";
import { listingCarHref } from "../lib/carRoutes";

/**
 * Карточка авто как в блоке «Популярные модели» на главной.
 * variant: "mobile" (home-m-card) | "desktop" (home-d-card)
 */
export default function HomeCarCard({
  car,
  variant = "mobile",
  className = "",
  onClickCapture,
  draggable = false,
  role,
  "data-home-car-id": dataHomeCarId,
}) {
  if (!car) return null;

  const totalRub = carTotalRub(car);
  const title = carListingTitle(car);
  const metaBits = carSpecMetaBits(car);
  const isDesktop = variant === "desktop";
  const rootCls = ["catalog-card", isDesktop ? "home-d-card" : "home-m-card", className]
    .filter(Boolean)
    .join(" ");

  return (
    <article className={rootCls} role={role} data-home-car-id={dataHomeCarId ?? car.id}>
      <Link
        href={listingCarHref(car)}
        className={isDesktop ? "catalog-card__main home-d-card__main" : "catalog-card__main home-m-card__main"}
        draggable={draggable}
        onClickCapture={onClickCapture}
      >
        <CatalogCardMedia photos={car.photos} carId={car.id} car={car} />
        <div className={isDesktop ? "catalog-card__content home-d-card__body" : "catalog-card__content home-m-card__body"}>
          <p className={isDesktop ? "home-d-card__price" : "home-m-card__price"}>
            {totalRub != null ? (
              <>
                <strong>{Math.round(totalRub).toLocaleString("ru-RU")} ₽</strong>
                <span>под ключ</span>
              </>
            ) : (
              <strong>{Math.round(car.price_cny).toLocaleString("ru-RU")} ¥</strong>
            )}
          </p>
          <p className={isDesktop ? "home-d-card__title" : "home-m-card__title"}>{title}</p>
          {metaBits.length ? (
            <p className={isDesktop ? "home-d-card__meta" : "home-m-card__meta"}>{metaBits.join(" · ")}</p>
          ) : null}
        </div>
      </Link>
    </article>
  );
}
