import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";

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
 * portal — рендер меню в document.body (поверх overflow-контейнеров, напр. таблиц).
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
  /** Если поиск не дал совпадений — пункт «Добавить …» с введённым текстом */
  onCreateFromSearch,
  createActionLabel = "Добавить",
  /** Блокировка триггера и пункта «Добавить» (например, во время запроса) */
  busy = false,
  /** Рендерить меню через portal поверх родителя с overflow */
  portal = false,
}) {
  const autoId = useId();
  const baseId = id ?? `site-dd-${autoId}`;
  const [open, setOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [menuStyle, setMenuStyle] = useState(null);
  const rootRef = useRef(null);
  const menuRef = useRef(null);
  const searchInputRef = useRef(null);

  const selected = options.find((o) => String(o.value) === String(value));
  const displayLabel = selected?.label ?? placeholder;

  const normalizeSearchKey = (s) =>
    String(s)
      .trim()
      .toLowerCase()
      .replace(/[\u2010-\u2015\u2212\u00AD]/g, "-")
      .replace(/\s+/g, " ");

  const filteredOptions = useMemo(() => {
    if (!searchable) return options;
    const q = searchQuery.trim();
    if (!q) return options;
    const qn = normalizeSearchKey(q);
    return options.filter((o) => {
      const lab = String(o.label);
      return lab.toLowerCase().includes(q.toLowerCase()) || normalizeSearchKey(lab).includes(qn);
    });
  }, [options, searchQuery, searchable]);

  const searchTrim = searchQuery.trim();
  const showCreateFromSearch = Boolean(
    searchable &&
      typeof onCreateFromSearch === "function" &&
      searchTrim.length > 0 &&
      filteredOptions.length === 0
  );

  const updateMenuPosition = useCallback(() => {
    if (!portal || !open || !rootRef.current) return;
    const rect = rootRef.current.getBoundingClientRect();
    const gap = 6;
    const maxH = Math.min(320, Math.max(160, window.innerHeight - rect.bottom - gap - 12));
    const spaceBelow = window.innerHeight - rect.bottom - gap;
    const openUp = spaceBelow < 180 && rect.top > spaceBelow;
    const width = Math.max(rect.width, 180);
    const left =
      menuAlign === "right"
        ? Math.min(window.innerWidth - width - 8, Math.max(8, rect.right - width))
        : Math.min(window.innerWidth - width - 8, Math.max(8, rect.left));

    if (openUp) {
      setMenuStyle({
        position: "fixed",
        left,
        width,
        bottom: window.innerHeight - rect.top + gap,
        top: "auto",
        maxHeight: Math.min(320, Math.max(160, rect.top - gap - 12)),
        zIndex: 5000,
      });
    } else {
      setMenuStyle({
        position: "fixed",
        left,
        width,
        top: rect.bottom + gap,
        bottom: "auto",
        maxHeight: maxH,
        zIndex: 5000,
      });
    }
  }, [portal, open, menuAlign]);

  useLayoutEffect(() => {
    if (!portal || !open) {
      setMenuStyle(null);
      return undefined;
    }
    updateMenuPosition();
    const onReposition = () => updateMenuPosition();
    window.addEventListener("resize", onReposition);
    window.addEventListener("scroll", onReposition, true);
    return () => {
      window.removeEventListener("resize", onReposition);
      window.removeEventListener("scroll", onReposition, true);
    };
  }, [portal, open, updateMenuPosition]);

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
      const t = e.target;
      if (rootRef.current?.contains(t)) return;
      if (menuRef.current?.contains(t)) return;
      setOpen(false);
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
    portal ? "site-dropdown__menu--portal" : "",
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

  const menu = open ? (
    <ul
      ref={menuRef}
      className={menuCls}
      role="listbox"
      aria-label={ariaLabel ?? label ?? "Варианты"}
      style={portal ? menuStyle || { visibility: "hidden" } : undefined}
      onMouseDown={(e) => e.stopPropagation()}
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
      {filteredOptions.length === 0 && !showCreateFromSearch ? (
        <li className="site-dropdown__empty" role="presentation">
          Ничего не найдено
        </li>
      ) : null}
      {filteredOptions.map((opt) => {
        const isSelected = String(opt.value) === String(value);
        return (
          <li key={`${String(opt.value)}-${opt.label}`} role="presentation">
            <button
              type="button"
              role="option"
              aria-selected={isSelected}
              className={`site-dropdown__option${isSelected ? " site-dropdown__option--active" : ""}`}
              onMouseDown={(e) => e.stopPropagation()}
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
      })}
      {showCreateFromSearch ? (
        <li className="site-dropdown__create-row" role="presentation">
          <button
            type="button"
            className="site-dropdown__option site-dropdown__option--create"
            disabled={busy}
            onMouseDown={(e) => {
              e.preventDefault();
              e.stopPropagation();
            }}
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              void (async () => {
                try {
                  await onCreateFromSearch(searchTrim);
                  setSearchQuery("");
                  setOpen(false);
                } catch {
                  /* ошибки обрабатывает родитель */
                }
              })();
            }}
          >
            <span className="site-dropdown__option-text">
              {createActionLabel} «{searchTrim}»
            </span>
          </button>
        </li>
      ) : null}
    </ul>
  ) : null;

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
        disabled={disabled || busy}
        onClick={() => !(disabled || busy) && setOpen((v) => !v)}
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
      {portal && typeof document !== "undefined" ? createPortal(menu, document.body) : menu}
    </div>
  );
}
