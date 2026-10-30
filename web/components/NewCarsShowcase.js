import Link from "next/link";
import HomeCarCard from "./HomeCarCard";

/** The same section and card layout as the popular-models showcase. */
export default function NewCarsShowcase({ cars = [], variant = "mobile", onCarClick }) {
  if (!cars.length) return null;
  const desktop = variant === "desktop";
  const sectionClass = desktop ? "home-d-models" : "home-m-models";

  return (
    <section className={sectionClass} aria-label="Новые автомобили">
      <div className={`${sectionClass}__head`}>
        <h2 className={`${sectionClass}__title`}>Новые автомобили</h2>
        <Link href="/catalog?is_new=true" className={`${sectionClass}__link`}>
          Все новые
        </Link>
      </div>
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
