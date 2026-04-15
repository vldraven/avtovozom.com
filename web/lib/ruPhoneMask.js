/** Только цифры: 7 и до 10 цифр номера (макс. 11 символов). */
export function normalizeRuPhoneDigits(raw) {
  let d = String(raw).replace(/\D/g, "");
  if (!d) return "";
  if (d[0] === "8") d = "7" + d.slice(1);
  if (d[0] === "9") d = "7" + d;
  if (d[0] !== "7") return "";
  return d.slice(0, 11);
}

/** Маска: +7 (999) 123-45-67 */
export function formatRuPhoneMask(digits) {
  if (!digits) return "";
  const r = digits.slice(1);
  if (r.length === 0) return "+7 ";
  if (r.length <= 3) return "+7 (" + r + (r.length === 3 ? ") " : "");
  let out = "+7 (" + r.slice(0, 3) + ") " + r.slice(3, 6);
  if (r.length <= 6) return out;
  out += "-" + r.slice(6, 8);
  if (r.length <= 8) return out;
  return out + "-" + r.slice(8, 10);
}

/** Для API: один только «7» считаем пустым номером. */
export function phoneDigitsToApi(digits) {
  if (!digits || digits === "7") return "";
  return digits.startsWith("7") ? `+${digits}` : digits;
}
