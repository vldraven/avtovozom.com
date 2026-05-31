import { useEffect } from "react";

function formatTrimValue(value) {
  if (value === "●") {
    return (
      <span className="trim-config-mark trim-config-mark--yes" aria-label="В комплектации">
        ✓
      </span>
    );
  }
  if (value === "○") {
    return <span className="trim-config-mark trim-config-mark--opt">Опция</span>;
  }
  return value || "—";
}

function buildCarSpecSummary(car) {
  if (!car) return "";
  const parts = [];
  if (car.year) parts.push(String(car.year));
  if (car.fuel_type) parts.push(car.fuel_type);
  if (car.engine_volume_cc) {
    const liters = car.engine_volume_cc / 1000;
    parts.push(`${Number.isInteger(liters) ? liters : liters.toFixed(1)} л`);
  }
  if (car.horsepower != null && car.horsepower > 0) parts.push(`${car.horsepower} л.с.`);
  if (car.transmission) parts.push(car.transmission);
  return parts.join(" · ");
}

/**
 * Полная комплектация в попапе (как «Все характеристики» на auto.ru).
 */
export default function TrimConfigModal({ open, onClose, car }) {
  const trim = car?.trim;
  const sections = trim?.sections?.length ? trim.sections : [];

  useEffect(() => {
    if (!open) return undefined;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    function onKey(e) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener("keydown", onKey);
    };
  }, [open, onClose]);

  if (!open || !car || sections.length === 0) return null;

  const summary = buildCarSpecSummary(car);
  const overview = sections.find((s) => s.group === "Основное");
  const configSections = sections.filter((s) => s.group !== "Основное");

  return (
    <div
      className="trim-modal-overlay"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="trim-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="trim-modal-title"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <header className="trim-modal__header">
          <button type="button" className="trim-modal__close" aria-label="Закрыть" onClick={onClose}>
            ×
          </button>
          <h2 id="trim-modal-title" className="trim-modal__title">
            {car.title}
          </h2>
          {summary ? <p className="trim-modal__summary">{summary}</p> : null}
          {trim.name_ru ? <p className="trim-modal__trim-name">{trim.name_ru}</p> : null}
        </header>

        <div className="trim-modal__scroll">
          {(overview?.items?.length ? [overview] : []).concat(configSections).map((sec, secIdx) => (
            <section key={secIdx} className="trim-modal__section">
              <h3 className="trim-modal__section-title">{sec.group}</h3>
              <dl className="trim-modal__rows">
                {(sec.items || []).map((item, itemIdx) => (
                  <div key={itemIdx} className="trim-modal__row">
                    <dt>{item.name}</dt>
                    <dd>{formatTrimValue(item.value)}</dd>
                  </div>
                ))}
              </dl>
            </section>
          ))}
        </div>
      </div>
    </div>
  );
}
