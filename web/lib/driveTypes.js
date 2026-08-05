/** Канонические значения drive_type в объявлениях (русский, как на карточке). */
export const DRIVE_TYPE_OPTIONS = [
  { value: "Передний", label: "Передний" },
  { value: "Задний", label: "Задний" },
  { value: "Полный", label: "Полный" },
];

const DRIVE_ALIASES = [
  { keys: ["передн", "fwd", "ff", "前驱", "前置前驱"], value: "Передний" },
  { keys: ["задн", "rwd", "fr", "后驱", "前置后驱", "后置后驱"], value: "Задний" },
  { keys: ["полн", "4wd", "awd", "4x4", "四驱", "полный"], value: "Полный" },
];

/** Привести произвольное значение к пункту списка. */
export function normalizeDriveTypeValue(raw) {
  const s = String(raw || "").trim();
  if (!s) return "";
  const exact = DRIVE_TYPE_OPTIONS.find((o) => o.value === s);
  if (exact) return exact.value;
  const lower = s.toLowerCase();
  for (const row of DRIVE_ALIASES) {
    if (row.keys.some((k) => lower === k || lower.includes(k))) {
      return row.value;
    }
  }
  return "";
}

/** Опции для SiteSelectDropdown; сохраняет нестандартное значение при редактировании. */
export function driveTypeSelectOptions(currentValue, emptyLabel = "— не указано —") {
  const base = [{ value: "", label: emptyLabel }, ...DRIVE_TYPE_OPTIONS];
  const v = String(currentValue || "").trim();
  if (!v || base.some((o) => o.value === v)) return base;
  return [...base, { value: v, label: v }];
}
