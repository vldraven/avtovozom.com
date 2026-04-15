/** Текст для meta description: без лишних пробелов, до maxLen символов. */
export function seoDescription(text, maxLen = 160) {
  if (!text || typeof text !== "string") return "";
  const t = text
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (t.length <= maxLen) return t;
  return `${t.slice(0, maxLen - 1).trim()}…`;
}
