import SiteSelectDropdown from "./SiteSelectDropdown";

const OPTIONS = [
  { value: "date_desc", label: "По дате: сначала новые" },
  { value: "date_asc", label: "По дате: сначала старые" },
  { value: "price_asc", label: "По возрастанию цены" },
  { value: "price_desc", label: "По убыванию цены" },
];

function SortArrowsIcon() {
  return (
    <svg
      className="site-dropdown__trigger-icon-svg"
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden
    >
      <path
        d="M5 10l5-5 5 5M5 14l5 5 5-5"
        stroke="currentColor"
        strokeWidth="1.65"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/**
 * Сортировка списка объявлений (компактный триггер + общее меню SiteSelectDropdown).
 */
export default function CatalogSortDropdown({ value, onChange }) {
  return (
    <SiteSelectDropdown
      variant="toolbar"
      menuAlign="right"
      className="site-dropdown--toolbar-sort"
      options={OPTIONS}
      value={value}
      onChange={onChange}
      toolbarIcon={<SortArrowsIcon />}
      ariaLabel="Сортировка объявлений"
    />
  );
}
