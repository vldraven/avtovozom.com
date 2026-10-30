import Link from "next/link";
import HomeCarCard from "./HomeCarCard";

/** V2 highlight panel, with the shared homepage car cards and horizontal rail. */
export default function NewCarsShowcase({ cars = [], total = 0, variant = "mobile", onCarClick }) {
  if (!cars.length) return null;
  const desktop = variant === "desktop";
  const sectionClass = desktop ? "home-d-models" : "home-m-models";

  const countLabel = { one: "предложение", few: "предложения", many: "предложений", other: "предложения" }[new Intl.PluralRules("ru").select(total)];

  return (
    <section className={`${sectionClass} home-new-cars home-new-cars--${variant}`} aria-label="Новые автомобили">
      <div className={`${sectionClass}__head`}>
        <div>
          <h2 className={`${sectionClass}__title`}>Новые автомобили</h2>
          {desktop && <p className="home-new-cars__subtitle">Без пробега, из Китая под заказ{total > 0 ? ` · ${total} ${countLabel}` : ""}</p>}
        </div>
        <Link href="/catalog?is_new=true" className={`${sectionClass}__link`}>
          В каталог
        </Link>
      </div>
      {!desktop && <p className="home-new-cars__subtitle">Без пробега, из Китая под заказ</p>}
      <div className={desktop ? "home-d-carousel" : "home-m-models__scroller"} role="list">
        {cars.map((car, index) => (
          <HomeCarCard
            key={car.id}
            car={car}
            variant={variant}
            className={desktop ? "" : "home-m-models__card"}
            role="listitem"
            draggable={false}
            imagePriority={index < (desktop ? 4 : 2)}
            onClickCapture={(event) => onCarClick?.(event, car.id)}
          />
        ))}
      </div>
    </section>
  );
}
