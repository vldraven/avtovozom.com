import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import HomeCarCard from "./HomeCarCard";

export default function NewCarsShowcase({ cars = [], total = 0, variant = "mobile", onCarClick }) {
  const rail = useRef(null);
  const [canPrev, setCanPrev] = useState(false);
  const [canNext, setCanNext] = useState(false);
  const updateArrows = () => {
    const el = rail.current;
    if (!el) return;
    setCanPrev(el.scrollLeft > 2);
    setCanNext(el.scrollLeft + el.clientWidth < el.scrollWidth - 2);
  };

  useEffect(() => {
    const el = rail.current;
    if (!el) return undefined;
    updateArrows();
    const observer = new ResizeObserver(updateArrows);
    observer.observe(el);
    return () => observer.disconnect();
  }, [cars]);

  if (!cars.length) return null;
  const scroll = (direction) => rail.current?.scrollBy({
    left: direction * rail.current.clientWidth * 0.85,
    behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth",
  });

  return (
    <section className={`new-cars-showcase new-cars-showcase--${variant}`} aria-label="Новые автомобили">
      <div className="new-cars-showcase__head">
        <div>
          <h2>Новые автомобили</h2>
          <p>Из Китая под заказ{total > 0 ? ` · ${Number(total).toLocaleString("ru-RU")} авто` : ""}</p>
        </div>
        <div className="new-cars-showcase__actions">
          <Link href="/catalog?is_new=true">Все новые</Link>
          <button type="button" disabled={!canPrev} onClick={() => scroll(-1)} aria-label="Предыдущие новые автомобили">‹</button>
          <button type="button" disabled={!canNext} onClick={() => scroll(1)} aria-label="Следующие новые автомобили">›</button>
        </div>
      </div>
      <div className="new-cars-showcase__rail" ref={rail} onScroll={updateArrows} role="list">
        {cars.map((car) => (
          <HomeCarCard key={car.id} car={car} variant={variant} role="listitem"
            onClickCapture={(event) => onCarClick?.(event, car.id)} />
        ))}
      </div>
    </section>
  );
}
