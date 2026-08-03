import SiteSelectDropdown from "./SiteSelectDropdown";

/** Общие опции (мобилка 02b). */
export const CATALOG_SORT_OPTIONS = [
  { value: "relevance", label: "Актуальности" },
  { value: "price_asc", label: "Сначала дешевле" },
  { value: "price_desc", label: "Сначала дороже" },
  { value: "year_desc", label: "Году: новее" },
  { value: "year_asc", label: "Году: старше" },
  { value: "mileage_asc", label: "Пробегу" },
  { value: "power_desc", label: "Мощности" },
];

/** Десктоп 33b — дополнительно «Дате размещения». */
export const CATALOG_SORT_OPTIONS_DESKTOP = [
  { value: "relevance", label: "Актуальности" },
  { value: "date_desc", label: "Дате размещения" },
  { value: "price_asc", label: "Сначала дешевле" },
  { value: "price_desc", label: "Сначала дороже" },
  { value: "year_desc", label: "Году: новее" },
  { value: "year_asc", label: "Году: старше" },
  { value: "mileage_asc", label: "Пробегу" },
  { value: "power_desc", label: "Мощности" },
];

export const CATALOG_SORT_DEFAULT = "relevance";

function SortArrowsIcon() {
  return (
    <svg
      className="site-dropdown__trigger-icon-svg"
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden
    >
      <path
        d="M7 4v16M3 8l4-4 4 4M17 20V4M13 16l4 4 4-4"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/**
 * Сортировка списка объявлений (компактный триггер + меню SiteSelectDropdown).
 * variant: "mobile" | "desktop" — набор пунктов по макетам 02b / 33b.
 */
export default function CatalogSortDropdown({ value, onChange, variant = "mobile" }) {
  const options = variant === "desktop" ? CATALOG_SORT_OPTIONS_DESKTOP : CATALOG_SORT_OPTIONS;
  const isMobile = variant === "mobile";
  return (
    <SiteSelectDropdown
      variant="toolbar"
      menuAlign={isMobile ? "right" : "left"}
      portal={isMobile}
      menuMinWidth={260}
      className="site-dropdown--toolbar-sort"
      options={options}
      value={value}
      onChange={onChange}
      toolbarIcon={<SortArrowsIcon />}
      ariaLabel="Сортировать по"
    />
  );
}
