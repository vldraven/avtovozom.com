import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";

export const PRICE_MOSCOW_HINT_TITLE = "Что входит в стоимость";
export const PRICE_MOSCOW_HINT_BODY =
  "Включает все расходы: цену автомобиля в Китае, расходы по Китаю, международную логистику, таможенные платежи и доставку до Москвы.";
export const PRICE_MOSCOW_HINT_BODY_EXTRA =
  "Расчет стоимости доставки в другие города РФ по запросу.";

function stopCardNav(e) {
  e.preventDefault();
  e.stopPropagation();
}

function popoverCoordsFor(el) {
  if (!el || typeof window === "undefined") return null;
  const r = el.getBoundingClientRect();
  if (r.width < 1 || r.height < 1) return null;
  const width = Math.min(300, window.innerWidth - 24);
  let left = r.left + r.width / 2 - width / 2;
  left = Math.max(12, Math.min(left, window.innerWidth - width - 12));
  const estimatedH = 190;
  let top = r.bottom + 8;
  if (top + estimatedH > window.innerHeight - 12) {
    top = Math.max(12, r.top - estimatedH - 8);
  }
  return { top, left, width };
}

/**
 * Подпись «итого в Москве» + ⓘ с пояснением.
 * Безопасно внутри <Link>: клик не уводит на карточку.
 */
export default function CarPriceMoscowLabel({ className = "", textClassName = "" }) {
  const [open, setOpen] = useState(false);
  const [coords, setCoords] = useState(null);
  const btnRef = useRef(null);
  const panelRef = useRef(null);
  const titleId = useId();
  const bodyId = useId();

  useEffect(() => {
    if (!open) return undefined;

    const place = () => {
      const next = popoverCoordsFor(btnRef.current);
      if (next) setCoords(next);
    };

    place();

    const onPointerDown = (e) => {
      const t = e.target;
      if (btnRef.current?.contains(t) || panelRef.current?.contains(t)) return;
      setOpen(false);
      setCoords(null);
    };
    const onKey = (e) => {
      if (e.key === "Escape") {
        setOpen(false);
        setCoords(null);
      }
    };
    const onReposition = () => place();

    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("keydown", onKey);
    window.addEventListener("resize", onReposition);
    window.addEventListener("scroll", onReposition, true);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("resize", onReposition);
      window.removeEventListener("scroll", onReposition, true);
    };
  }, [open]);

  const toggle = (e) => {
    stopCardNav(e);
    const nextCoords = popoverCoordsFor(btnRef.current);
    if (!nextCoords) return;
    setOpen((wasOpen) => {
      if (wasOpen) {
        setCoords(null);
        return false;
      }
      setCoords(nextCoords);
      return true;
    });
  };

  return (
    <span className={["car-price-moscow", className].filter(Boolean).join(" ")}>
      <span className={["car-price-moscow__text", textClassName].filter(Boolean).join(" ")}>
        итого в Москве
      </span>
      <span
        ref={btnRef}
        role="button"
        tabIndex={0}
        className="car-price-moscow__info"
        aria-label={PRICE_MOSCOW_HINT_TITLE}
        aria-expanded={open}
        aria-controls={open ? bodyId : undefined}
        onClick={toggle}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") toggle(e);
        }}
        onPointerDown={stopCardNav}
      >
        <svg width="14" height="14" viewBox="0 0 24 24" aria-hidden focusable="false">
          <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" strokeWidth="1.75" />
          <circle cx="12" cy="8" r="1.1" fill="currentColor" />
          <path
            d="M12 11.25v5.5"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.75"
            strokeLinecap="round"
          />
        </svg>
      </span>
      {open && coords && typeof document !== "undefined"
        ? createPortal(
            <div
              ref={panelRef}
              id={bodyId}
              role="dialog"
              aria-modal="false"
              aria-labelledby={titleId}
              className="car-price-moscow__popover"
              style={{ top: coords.top, left: coords.left, width: coords.width }}
              onClick={stopCardNav}
              onPointerDown={stopCardNav}
            >
              <p id={titleId} className="car-price-moscow__popover-title">
                {PRICE_MOSCOW_HINT_TITLE}
              </p>
              <p className="car-price-moscow__popover-body">{PRICE_MOSCOW_HINT_BODY}</p>
              <p className="car-price-moscow__popover-body car-price-moscow__popover-body--extra">
                {PRICE_MOSCOW_HINT_BODY_EXTRA}
              </p>
            </div>,
            document.body
          )
        : null}
    </span>
  );
}
