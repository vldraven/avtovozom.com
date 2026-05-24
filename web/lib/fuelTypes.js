/** Канонические значения fuel_type в объявлениях (русский, как в карточке и БД). */
export const FUEL_TYPE_OPTIONS = [
  { value: "бензин", label: "Бензин" },
  { value: "дизель", label: "Дизель" },
  { value: "гибрид", label: "Гибрид" },
  { value: "электро", label: "Электро" },
];

const FUEL_ALIASES = [
  { keys: ["бензин", "gasoline", "petrol", "汽油", "gas"], value: "бензин" },
  { keys: ["дизель", "diesel", "柴油"], value: "дизель" },
  {
    keys: ["гибрид", "hybrid", "phev", "hev", "plug-in", "plug in", "混动", "插电", "增程"],
    value: "гибрид",
  },
  { keys: ["электро", "electric", "ev", "bev", "纯电", "электрич"], value: "электро" },
];

/** Привести произвольное значение из парсера/старой записи к пункту списка. */
export function normalizeFuelTypeValue(raw) {
  const s = String(raw || "").trim();
  if (!s) return "";
  const lower = s.toLowerCase();
  for (const row of FUEL_ALIASES) {
    if (row.keys.some((k) => lower === k || lower.includes(k))) {
      return row.value;
    }
  }
  const exact = FUEL_TYPE_OPTIONS.find((o) => o.value === lower);
  return exact ? exact.value : "";
}

/** Опции для SiteSelectDropdown; сохраняет нестандартное значение при редактировании. */
export function fuelTypeSelectOptions(currentValue) {
  const base = [{ value: "", label: "— не указано —" }, ...FUEL_TYPE_OPTIONS];
  const v = String(currentValue || "").trim();
  if (!v || base.some((o) => o.value === v)) return base;
  return [...base, { value: v, label: v }];
}
