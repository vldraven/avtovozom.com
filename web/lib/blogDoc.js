/** Перевод блоков блога ↔ Editor.js. Хранение остаётся списком блоков сайта. */

const API_URL = (process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000").replace(/\/$/, "");

export function cleanHref(value) {
  const href = String(value || "").trim();
  if (!href || href.length > 500) return "";
  if (href.startsWith("/") && !href.startsWith("//") && !href.includes("\\")) return href;
  try {
    const url = new URL(href);
    if (url.protocol === "http:" || url.protocol === "https:") return href;
  } catch {
    return "";
  }
  return "";
}

export function mediaPathFromUrl(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  if (raw.startsWith("/media/blog/") && !raw.includes("..")) return raw.split("?")[0];
  try {
    const url = new URL(raw, API_URL);
    const path = url.pathname || "";
    if (path.startsWith("/media/blog/") && !path.includes("..")) return path;
  } catch {
    return "";
  }
  return "";
}

export function editorImageUrl(path) {
  const clean = mediaPathFromUrl(path) || (String(path || "").startsWith("/media/blog/") ? path : "");
  if (!clean) return "";
  return `${API_URL}${clean}`;
}

export function blocksToEditorData(blocks) {
  const out = [];
  for (const block of Array.isArray(blocks) ? blocks : []) {
    const item = blockToEditor(block);
    if (item) out.push(item);
  }
  if (!out.length) out.push({ type: "paragraph", data: { text: "" } });
  return { blocks: out };
}

export function editorDataToBlocks(data) {
  const out = [];
  for (const block of data?.blocks || []) {
    const item = editorToBlock(block);
    if (item) out.push(item);
  }
  return out;
}

function blockToEditor(block) {
  if (!block || typeof block !== "object") return null;
  if (block.type === "paragraph") {
    return { type: "paragraph", data: { text: inlinesToHtml(block.inlines) } };
  }
  if (block.type === "h2" || block.type === "h3") {
    const text = escapeHtml(String(block.text || ""));
    if (!text) return null;
    return { type: "header", data: { text, level: block.type === "h3" ? 3 : 2 } };
  }
  if (block.type === "list") {
    const items = (block.items || [])
      .map((inlines) => ({ content: inlinesToHtml(inlines), meta: {}, items: [] }))
      .filter((item) => stripHtml(item.content).trim());
    if (!items.length) return null;
    return {
      type: "list",
      data: {
        style: block.ordered ? "ordered" : "unordered",
        meta: {},
        items,
      },
    };
  }
  if (block.type === "image") {
    const url = editorImageUrl(block.url);
    if (!url) return null;
    return {
      type: "image",
      data: {
        file: { url },
        caption: escapeHtml(String(block.alt || "")),
        withBorder: false,
        stretched: false,
        withBackground: false,
      },
    };
  }
  if (block.type === "table") {
    const rows = Array.isArray(block.rows) ? block.rows : [];
    if (!rows.length) return null;
    return {
      type: "table",
      data: {
        withHeadings: true,
        content: rows.map((row) => (row || []).map((cell) => String(cell || ""))),
      },
    };
  }
  return null;
}

function editorToBlock(block) {
  if (!block || typeof block !== "object") return null;
  const data = block.data || {};
  if (block.type === "paragraph") {
    const inlines = htmlToInlines(data.text);
    return inlines.length ? { type: "paragraph", inlines } : null;
  }
  if (block.type === "header") {
    const text = stripHtml(data.text).trim().slice(0, 240);
    if (!text) return null;
    return { type: Number(data.level) === 3 ? "h3" : "h2", text };
  }
  if (block.type === "list") {
    const ordered = data.style === "ordered";
    const items = flattenListItems(data.items).filter((item) => item.length);
    return items.length ? { type: "list", ordered, items } : null;
  }
  if (block.type === "image") {
    const url = mediaPathFromUrl(data.file?.url || data.url || "");
    if (!url) return null;
    return { type: "image", url: url.slice(0, 512), alt: stripHtml(data.caption).trim().slice(0, 180) };
  }
  if (block.type === "table") {
    const content = Array.isArray(data.content) ? data.content : [];
    const rows = content
      .slice(0, 30)
      .map((row) => (Array.isArray(row) ? row : []).slice(0, 8).map((cell) => stripHtml(cell).trim().slice(0, 200)));
    if (!rows.length) return null;
    const blockOut = { type: "table", rows };
    return blockOut;
  }
  return null;
}

function flattenListItems(items, depth = 0) {
  const out = [];
  if (!Array.isArray(items) || depth > 4) return out;
  for (const item of items) {
    if (typeof item === "string") {
      const inlines = htmlToInlines(item);
      if (inlines.length) out.push(inlines);
      continue;
    }
    if (!item || typeof item !== "object") continue;
    const inlines = htmlToInlines(item.content || item.text || "");
    if (inlines.length) out.push(inlines);
    out.push(...flattenListItems(item.items, depth + 1));
  }
  return out;
}

export function inlinesToHtml(inlines) {
  return (Array.isArray(inlines) ? inlines : [])
    .map((inline) => {
      let html = escapeHtml(String(inline?.text || "")).replace(/\n/g, "<br>");
      if (!html) return "";
      if (inline.bold) html = `<b>${html}</b>`;
      if (inline.italic) html = `<i>${html}</i>`;
      const href = cleanHref(inline.href);
      if (href) {
        const safe = escapeAttr(href);
        const blank = href.startsWith("http") ? ' target="_blank" rel="noopener noreferrer"' : "";
        html = `<a href="${safe}"${blank}>${html}</a>`;
      }
      return html;
    })
    .join("");
}

export function htmlToInlines(html) {
  if (typeof window === "undefined") return htmlToInlinesNode(html);
  const root = document.createElement("div");
  root.innerHTML = String(html || "");
  const out = [];
  walkDom(root, {}, out);
  return mergeInlines(out);
}

function htmlToInlinesNode(html) {
  const text = stripHtml(html);
  return text ? [{ text }] : [];
}

function walkDom(node, marks, out) {
  if (node.nodeType === 3) {
    const text = node.textContent || "";
    if (!text) return;
    const inline = { text };
    if (marks.bold) inline.bold = true;
    if (marks.italic) inline.italic = true;
    if (marks.href) inline.href = marks.href;
    out.push(inline);
    return;
  }
  if (node.nodeType !== 1) return;
  const tag = node.tagName.toLowerCase();
  if (tag === "br") {
    out.push({ text: "\n" });
    return;
  }
  const next = { ...marks };
  if (tag === "b" || tag === "strong") next.bold = true;
  if (tag === "i" || tag === "em") next.italic = true;
  if (tag === "a") {
    const href = cleanHref(node.getAttribute("href"));
    if (href) next.href = href;
  }
  if (["script", "style", "iframe", "object"].includes(tag)) return;
  for (const child of node.childNodes) walkDom(child, next, out);
}

function mergeInlines(inlines) {
  const out = [];
  for (const inline of inlines) {
    if (!inline.text) continue;
    const prev = out[out.length - 1];
    if (
      prev &&
      (prev.href || "") === (inline.href || "") &&
      Boolean(prev.bold) === Boolean(inline.bold) &&
      Boolean(prev.italic) === Boolean(inline.italic)
    ) {
      prev.text += inline.text;
    } else {
      const next = { text: inline.text };
      if (inline.bold) next.bold = true;
      if (inline.italic) next.italic = true;
      if (inline.href) next.href = inline.href;
      out.push(next);
    }
  }
  return out.filter((inline) => inline.text);
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function escapeAttr(value) {
  return escapeHtml(value).replace(/'/g, "&#39;");
}

function stripHtml(value) {
  return String(value || "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}
