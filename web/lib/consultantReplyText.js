/** Ключи JSON-параметров n8n-инструментов консультанта (см. backend sanitize). */
const TOOL_JSON_KEYS = new Set([
  "q",
  "max_total_rub",
  "min_total_rub",
  "listing_id",
  "user_name",
  "user_contact",
  "comment",
  "car_id",
]);

/** Убрать ведущий JSON tool-call из текста ответа (legacy-сообщения в БД). */
export function sanitizeConsultantReplyText(text) {
  let s = String(text || "").trim();
  while (s.startsWith("{")) {
    let end = -1;
    let depth = 0;
    let inString = false;
    let escape = false;
    for (let i = 0; i < s.length; i += 1) {
      const c = s[i];
      if (escape) {
        escape = false;
        continue;
      }
      if (c === "\\") {
        escape = true;
        continue;
      }
      if (c === '"') {
        inString = !inString;
        continue;
      }
      if (inString) continue;
      if (c === "{") depth += 1;
      else if (c === "}") {
        depth -= 1;
        if (depth === 0) {
          end = i;
          break;
        }
      }
    }
    if (end < 0) break;
    try {
      const obj = JSON.parse(s.slice(0, end + 1));
      if (typeof obj !== "object" || obj === null || Array.isArray(obj)) break;
      const keys = Object.keys(obj);
      if (keys.length > 0 && !keys.every((k) => TOOL_JSON_KEYS.has(k))) break;
      s = s.slice(end + 1).replace(/^[\s\n\r]+/, "");
    } catch {
      break;
    }
  }
  return s.trim();
}
