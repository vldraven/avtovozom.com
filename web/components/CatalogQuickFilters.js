import { useEffect, useId, useRef, useState } from "react";

import {
  chipLabelForFilter,
  filtersAreEqual,
  HP_TO_OPTIONS,
  MILEAGE_TO_OPTIONS,
  RUB_TO_PRESETS,
  TRANSMISSION_GROUPS,
  YEAR_FROM_OPTIONS,
} from "../lib/catalogFilters";

function Chevron({ open }) {
  return (
    <svg
      className={`catalog-qf__chev${open ? " catalog-qf__chev--open" : ""}`}
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden
    >
      <path
        d="M6 9l6 6 6-6"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function FilterChip({ label, active, disabled, open, onClick, chipRef }) {
  return (
    <button
      type="button"
      ref={chipRef}
      className={`catalog-qf__chip${active ? " catalog-qf__chip--active" : ""}${open ? " catalog-qf__chip--open" : ""}`}
      onClick={onClick}
      disabled={disabled}
      aria-expanded={open}
    >
      <span className="catalog-qf__chip-label">{label}</span>
      <Chevron open={open} />
    </button>
  );
}

function PopoverMenu({ anchorRef, open, onClose, children, align = "left", width = 260 }) {
  const menuRef = useRef(null);
  const [pos, setPos] = useState({ top: 0, left: 0 });

  useEffect(() => {
    if (!open || !anchorRef?.current) return undefined;
    const update = () => {
      const rect = anchorRef.current.getBoundingClientRect();
      const scrollY = window.scrollY || document.documentElement.scrollTop;
      const scrollX = window.scrollX || document.documentElement.scrollLeft;
      let left = rect.left + scrollX;
      if (align === "right") {
        left = rect.right + scrollX - width;
      }
      // Ограничиваем поповер рамками экрана, чтобы на мобилке не выезжал за края.
      const topDesired = rect.bottom + scrollY + 6;
      const vw = window.innerWidth || 375;
      const vh = window.innerHeight || 667;
      const maxH = Math.min(360, Math.round(vh * 0.7)); // совпадает с CSS: min(360px, 70vh)
      const pad = 8;
      const leftMin = scrollX + pad;
      const leftMax = scrollX + vw - width - pad;
      const topMin = scrollY + pad;
      const topMax = scrollY + vh - maxH - pad;
      const leftClamped = Math.max(leftMin, Math.min(leftMax, left));
      const topClamped = Math.max(topMin, Math.min(topMax, topDesired));
      setPos({ top: topClamped, left: leftClamped });
    };
    update();
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    return () => {
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
    };
  }, [open, anchorRef, align, width]);

  useEffect(() => {
    if (!open) return undefined;
    const onDoc = (e) => {
      const t = e.target;
      if (menuRef.current?.contains(t) || anchorRef?.current?.contains(t)) return;
      onClose();
    };
    const onKey = (e) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, onClose, anchorRef]);

  if (!open) return null;

  return (
    <div
      ref={menuRef}
      className="catalog-qf__menu"
      style={{ top: pos.top, left: pos.left, width }}
      role="dialog"
    >
      {children}
    </div>
  );
}

function MenuReset({ onClick, label = "Сбросить" }) {
  return (
    <button type="button" className="catalog-qf__menu-reset" onClick={onClick}>
      <span className="catalog-qf__menu-reset-icon" aria-hidden>
        ×
      </span>
      {label}
    </button>
  );
}

function MenuOption({ children, active, onClick, sub }) {
  return (
    <button type="button" className={`catalog-qf__menu-item${active ? " catalog-qf__menu-item--active" : ""}`} onClick={onClick}>
      <span className="catalog-qf__menu-item-text">{children}</span>
      {sub ? <span className="catalog-qf__menu-item-sub">{sub}</span> : null}
    </button>
  );
}

/**
 * Быстрые фильтры под поиском (auto.ru-style): марка, модель, год, КПП, пробег, цена.
 */
export default function CatalogQuickFilters({
  brands = [],
  models = [],
  draft,
  applied,
  onChangeDraft,
  onApply,
  applyLabel = "Применить",
}) {
  const rootId = useId();
  const [mobileMode, setMobileMode] = useState(false);
  const [openKey, setOpenKey] = useState(null);
  const [priceFromDraft, setPriceFromDraft] = useState("");
  const [priceToDraft, setPriceToDraft] = useState("");

  const brandRef = useRef(null);
  const modelRef = useRef(null);
  const yearRef = useRef(null);
  const hpRef = useRef(null);
  const transRef = useRef(null);
  const mileageRef = useRef(null);
  const priceRef = useRef(null);

  const anchorRefs = {
    brand: brandRef,
    model: modelRef,
    year: yearRef,
    hp: hpRef,
    transmission: transRef,
    mileage: mileageRef,
    price: priceRef,
  };

  const closeMenu = () => setOpenKey(null);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const mql = window.matchMedia?.("(max-width: 640px)");
    if (!mql) return;
    const update = () => setMobileMode(Boolean(mql.matches));
    update();
    if (mql.addEventListener) mql.addEventListener("change", update);
    else mql.addListener(update);
    return () => {
      if (mql.removeEventListener) mql.removeEventListener("change", update);
      else mql.removeListener(update);
    };
  }, []);

  const toggleMenu = (key) => {
    setOpenKey((prev) => (prev === key ? null : key));
    if (key === "price") {
      setPriceFromDraft(draft.rubFrom ? String(Math.round(draft.rubFrom)) : "");
      setPriceToDraft(draft.rubTo ? String(Math.round(draft.rubTo)) : "");
    }
  };

  const patch = (partial) => {
    const next = { ...draft, ...partial };
    onChangeDraft(next);
    return next;
  };

  const brandLabel = brands.find((b) => b.id === draft.brandId)?.name || "Марка";
  const modelLabel = models.find((m) => m.id === draft.modelId)?.name || "Модель";
  const modelDisabled = !draft.brandId;
  const dirty = !filtersAreEqual(draft, applied);
  const applyImmediately =
    mobileMode ||
    (typeof window !== "undefined" && window.matchMedia?.("(max-width: 640px)")?.matches);

  return (
    <div className="catalog-qf" id={rootId}>
      <div className="catalog-qf__row">
        <FilterChip
          chipRef={brandRef}
          label={draft.brandId ? brandLabel : "Марка"}
          active={Boolean(draft.brandId)}
          open={openKey === "brand"}
          onClick={() => toggleMenu("brand")}
        />
        <FilterChip
          chipRef={modelRef}
          label={draft.modelId ? modelLabel : "Модель"}
          active={Boolean(draft.modelId)}
          disabled={modelDisabled}
          open={openKey === "model"}
          onClick={() => !modelDisabled && toggleMenu("model")}
        />
        <FilterChip
          chipRef={yearRef}
          label={chipLabelForFilter("year", draft) || "Год"}
          active={Boolean(draft.yearFrom)}
          open={openKey === "year"}
          onClick={() => toggleMenu("year")}
        />
        <FilterChip
          chipRef={hpRef}
          label={chipLabelForFilter("hp", draft) || "Мощность"}
          active={Boolean(draft.hpTo)}
          open={openKey === "hp"}
          onClick={() => toggleMenu("hp")}
        />
        <FilterChip
          chipRef={transRef}
          label={chipLabelForFilter("transmission", draft) || "Коробка"}
          active={Boolean(draft.transmission)}
          open={openKey === "transmission"}
          onClick={() => toggleMenu("transmission")}
        />
        <FilterChip
          chipRef={mileageRef}
          label={chipLabelForFilter("mileage", draft) || "Пробег"}
          active={Boolean(draft.mileageTo)}
          open={openKey === "mileage"}
          onClick={() => toggleMenu("mileage")}
        />
        <FilterChip
          chipRef={priceRef}
          label={chipLabelForFilter("price", draft) || "Цена"}
          active={Boolean(draft.rubFrom || draft.rubTo)}
          open={openKey === "price"}
          onClick={() => toggleMenu("price")}
        />
        <button
          type="button"
          className={`catalog-qf__apply${dirty ? " catalog-qf__apply--ready" : ""}`}
          onClick={() => onApply()}
          disabled={!dirty}
        >
          {applyLabel}
        </button>
      </div>

      <PopoverMenu anchorRef={anchorRefs.brand} open={openKey === "brand"} onClose={closeMenu}>
        <MenuReset
          label="Любая"
          onClick={() => {
            const next = patch({ brandId: null, modelId: null });
            if (applyImmediately) onApply(next);
            closeMenu();
          }}
        />
        <div className="catalog-qf__menu-scroll">
          {brands.map((b) => (
            <MenuOption
              key={b.id}
              active={draft.brandId === b.id}
              onClick={() => {
                const next = patch({ brandId: b.id, modelId: null });
                if (applyImmediately) onApply(next);
                closeMenu();
              }}
            >
              {b.name}
            </MenuOption>
          ))}
        </div>
      </PopoverMenu>

      <PopoverMenu anchorRef={anchorRefs.model} open={openKey === "model"} onClose={closeMenu}>
        <MenuReset
          label="Любая"
          onClick={() => {
            const next = patch({ modelId: null });
            if (applyImmediately) onApply(next);
            closeMenu();
          }}
        />
        <div className="catalog-qf__menu-scroll">
          {models.map((m) => (
            <MenuOption
              key={m.id}
              active={draft.modelId === m.id}
              onClick={() => {
                const next = patch({ modelId: m.id });
                if (applyImmediately) onApply(next);
                closeMenu();
              }}
            >
              {m.name}
            </MenuOption>
          ))}
        </div>
      </PopoverMenu>

      <PopoverMenu anchorRef={anchorRefs.year} open={openKey === "year"} onClose={closeMenu}>
        <MenuReset
          onClick={() => {
            const next = patch({ yearFrom: null });
            if (applyImmediately) onApply(next);
            closeMenu();
          }}
          label="Любая"
        />
        <div className="catalog-qf__menu-scroll">
          {YEAR_FROM_OPTIONS.map((opt) => (
            <MenuOption
              key={opt.value}
              active={String(draft.yearFrom) === opt.value}
              onClick={() => {
                const next = patch({ yearFrom: Number(opt.value) });
                if (applyImmediately) onApply(next);
                closeMenu();
              }}
            >
              {opt.label}
            </MenuOption>
          ))}
        </div>
      </PopoverMenu>

      <PopoverMenu anchorRef={anchorRefs.hp} open={openKey === "hp"} onClose={closeMenu}>
        <MenuReset
          label="Любая"
          onClick={() => {
            const next = patch({ hpTo: null });
            if (applyImmediately) onApply(next);
            closeMenu();
          }}
        />
        <div className="catalog-qf__menu-scroll">
          {HP_TO_OPTIONS.map((opt) => (
            <MenuOption
              key={opt.value}
              active={String(draft.hpTo) === opt.value}
              onClick={() => {
                const next = patch({ hpTo: Number(opt.value) });
                if (applyImmediately) onApply(next);
                closeMenu();
              }}
            >
              {opt.label}
            </MenuOption>
          ))}
        </div>
      </PopoverMenu>

      <PopoverMenu anchorRef={anchorRefs.transmission} open={openKey === "transmission"} onClose={closeMenu} width={280}>
        <MenuReset
          label="Любая"
          onClick={() => {
            const next = patch({ transmission: null });
            if (applyImmediately) onApply(next);
            closeMenu();
          }}
        />
        {TRANSMISSION_GROUPS.map((group, gi) => (
          <div key={gi} className="catalog-qf__menu-group">
            {group.label ? <div className="catalog-qf__menu-group-title">{group.label}</div> : null}
            {group.items.map((item) => (
              <MenuOption
                key={item.value}
                active={draft.transmission === item.value}
                sub={item.suffix}
                onClick={() => {
                  const next = patch({ transmission: item.value });
                  if (applyImmediately) onApply(next);
                  closeMenu();
                }}
              >
                {item.label}
              </MenuOption>
            ))}
          </div>
        ))}
      </PopoverMenu>

      <PopoverMenu anchorRef={anchorRefs.mileage} open={openKey === "mileage"} onClose={closeMenu}>
        <MenuReset
          onClick={() => {
            const next = patch({ mileageTo: null });
            if (applyImmediately) onApply(next);
            closeMenu();
          }}
        />
        <div className="catalog-qf__menu-scroll">
          {MILEAGE_TO_OPTIONS.map((opt) => (
            <MenuOption
              key={opt.value}
              active={String(draft.mileageTo) === opt.value}
              onClick={() => {
                const next = patch({ mileageTo: Number(opt.value) });
                if (applyImmediately) onApply(next);
                closeMenu();
              }}
            >
              {opt.label}
            </MenuOption>
          ))}
        </div>
      </PopoverMenu>

      <PopoverMenu anchorRef={anchorRefs.price} open={openKey === "price"} onClose={closeMenu} width={300}>
        <MenuReset
          onClick={() => {
            const next = patch({ rubFrom: null, rubTo: null });
            if (applyImmediately) onApply(next);
            setPriceFromDraft("");
            setPriceToDraft("");
            closeMenu();
          }}
        />
        <div className="catalog-qf__price-presets">
          {RUB_TO_PRESETS.map((opt) => (
            <MenuOption
              key={opt.value}
              active={String(draft.rubTo) === opt.value && !draft.rubFrom}
              onClick={() => {
                const next = patch({ rubFrom: null, rubTo: Number(opt.value) });
                if (applyImmediately) onApply(next);
                closeMenu();
              }}
            >
              {opt.label}
            </MenuOption>
          ))}
        </div>
        <div className="catalog-qf__price-custom">
          <label className="catalog-qf__price-field">
            <span className="catalog-qf__price-field-label">Цена от, ₽</span>
            <input
              className="input catalog-qf__price-input"
              inputMode="numeric"
              value={priceFromDraft}
              onChange={(e) => setPriceFromDraft(e.target.value.replace(/[^\d]/g, ""))}
              placeholder="от"
            />
          </label>
          <label className="catalog-qf__price-field">
            <span className="catalog-qf__price-field-label">до</span>
            <input
              className="input catalog-qf__price-input"
              inputMode="numeric"
              value={priceToDraft}
              onChange={(e) => setPriceToDraft(e.target.value.replace(/[^\d]/g, ""))}
              placeholder="до"
            />
          </label>
          <button
            type="button"
            className="btn btn-secondary btn-sm catalog-qf__price-apply"
            onClick={() => {
              const rf = priceFromDraft ? Number(priceFromDraft) : null;
              const rt = priceToDraft ? Number(priceToDraft) : null;
              const next = patch({ rubFrom: rf, rubTo: rt });
              if (applyImmediately) onApply(next);
              closeMenu();
            }}
          >
            Применить
          </button>
        </div>
        <p className="catalog-qf__price-hint text-muted">
          Ориентир по расчётной стоимости под ключ в России.
        </p>
      </PopoverMenu>
    </div>
  );
}
