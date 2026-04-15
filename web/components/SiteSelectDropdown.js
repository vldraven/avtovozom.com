import { useEffect, useId, useMemo, useRef, useState } from "react";

function ChevronDown({ open }) {
  return (
    <svg
      className={`site-dropdown__chevron${open ? " site-dropdown__chevron--open" : ""}`}
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
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

/**
 * Кастомный выпадающий список: меню с галочкой у выбранного пункта (как сортировка / auto.ru).
 * variant="floating" — подпись поля внутри триггера; variant="toolbar" — компактная строка (иконка + текст).
 */
export default function SiteSelectDropdown({
  label,
  value,
  onChange,
  options,
  placeholder = "—",
  disabled = false,
  id,
  variant = "floating",
  menuAlign = "left",
  className = "",
  toolbarIcon,
  ariaLabel,
  searchable = false,
}) {
  const autoId = useId();
  const baseId = id ?? `site-dd-${autoId}`;
  const [open, setOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const rootRef = useRef(null);
  const searchInputRef = useRef(null);

  const selected = options.find((o) => String(o.value) === String(value));
  const displayLabel = selected?.label ?? placeholder;

  const filteredOptions = useMemo(() => {
    if (!searchable) return options;
    const q = searchQuery.trim().toLowerCase();
    if (!q) return options;
    return options.filter((o) => String(o.label).toLowerCase().includes(q));
  }, [options, searchQuery, searchable]);

  useEffect(() => {
    if (!open) setSearchQuery("");
  }, [open]);

  useEffect(() => {
    if (open && searchable && searchInputRef.current) {
      const t = setTimeout(() => searchInputRef.current?.focus(), 0);
      return () => clearTimeout(t);
    }
    return undefined;
  }, [open, searchable]);

  useEffect(() => {
    if (!open) return undefined;
    const onDoc = (e) => {
      if (rootRef.current && !rootRef.current.contains(e.target)) {
        setOpen(false);
      }
    };
    const onKey = (e) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const menuCls = [
    "site-dropdown__menu",
    menuAlign === "right" ? "site-dropdown__menu--align-right" : "",
  ]
    .filter(Boolean)
    .join(" ");

  const rootCls = [
    "site-dropdown",
    variant === "floating" ? "site-dropdown--floating" : "site-dropdown--toolbar",
    className,
  ]
    .filter(Boolean)
    .join(" ");

  const triggerAria =
    ariaLabel ??
    (variant === "toolbar"
      ? "Выбор из списка"
      : label
        ? `${label}: ${displayLabel}`
        : displayLabel);

  return (
    <div className={rootCls} ref={rootRef}>
      <button
        type="button"
        className={
          variant === "floating"
            ? "site-dropdown__trigger site-dropdown__trigger--floating"
            : "site-dropdown__trigger site-dropdown__trigger--toolbar"
        }
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-label={triggerAria}
        disabled={disabled}
        onClick={() => !disabled && setOpen((v) => !v)}
      >
        {variant === "floating" ? (
          <>
            {label ? (
              <span className="site-dropdown__field-label" id={`${baseId}-lbl`}>
                {label}
              </span>
            ) : null}
            <span className="site-dropdown__value-row">
              <span className="site-dropdown__value" id={`${baseId}-val`}>
                {displayLabel}
              </span>
              <ChevronDown open={open} />
            </span>
          </>
        ) : (
          <>
            {toolbarIcon ? <span className="site-dropdown__toolbar-icon">{toolbarIcon}</span> : null}
            <span className="site-dropdown__trigger-label">{displayLabel}</span>
          </>
        )}
      </button>
      {open ? (
        <ul
          className={menuCls}
          role="listbox"
          aria-label={ariaLabel ?? label ?? "Варианты"}
        >
          {searchable ? (
            <li className="site-dropdown__search-row" role="presentation">
              <input
                ref={searchInputRef}
                type="search"
                className="site-dropdown__search-input"
                placeholder="Поиск…"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                onKeyDown={(e) => e.stopPropagation()}
                onClick={(e) => e.stopPropagation()}
                aria-label="Поиск по списку"
              />
            </li>
          ) : null}
          {filteredOptions.length === 0 ? (
            <li className="site-dropdown__empty" role="presentation">
              Ничего не найдено
            </li>
          ) : (
            filteredOptions.map((opt) => {
              const isSelected = String(opt.value) === String(value);
              return (
                <li key={`${String(opt.value)}-${opt.label}`} role="presentation">
                  <button
                    type="button"
                    role="option"
                    aria-selected={isSelected}
                    className={`site-dropdown__option${isSelected ? " site-dropdown__option--active" : ""}`}
                    onClick={() => {
                      onChange(opt.value);
                      setOpen(false);
                    }}
                  >
                    <span className="site-dropdown__check" aria-hidden>
                      {isSelected ? "✓" : ""}
                    </span>
                    <span className="site-dropdown__option-text">{opt.label}</span>
                  </button>
                </li>
              );
            })
          )}
        </ul>
      ) : null}
    </div>
  );
}
