import { publicCarHref } from "./carRoutes";
import { absoluteUrl } from "./siteUrl";

function formatRubInt(n) {
  if (n == null || Number.isNaN(Number(n))) return null;
  return Math.round(Number(n)).toLocaleString("ru-RU");
}

/**
 * @param {object} car
 * @param {number | null | undefined} totalRubRf
 */
export function buildListingSharePayload(car, totalRubRf = null) {
  const url = absoluteUrl(publicCarHref(car));
  const title = (car?.title || "Объявление avtovozom").trim();
  const parts = [];
  if (car?.brand && car?.model) {
    parts.push(`${car.brand} ${car.model}`);
  }
  if (car?.year) parts.push(String(car.year));
  const rub = formatRubInt(totalRubRf);
  if (rub) {
    parts.push(`~${rub} ₽ в РФ`);
  } else if (car?.price_cny != null && car.price_cny > 0) {
    parts.push(`${Math.round(car.price_cny).toLocaleString("ru-RU")} ¥`);
  }
  const text = parts.length ? parts.join(" · ") : title;
  return { url, title, text };
}

export function canUseNativeShare() {
  return typeof navigator !== "undefined" && typeof navigator.share === "function";
}

/**
 * @param {{ url: string, title: string, text: string }} payload
 */
export async function shareListingNative(payload) {
  if (!canUseNativeShare()) {
    throw new Error("Web Share API недоступен");
  }
  try {
    await navigator.share({
      title: payload.title,
      text: payload.text,
      url: payload.url,
    });
  } catch (err) {
    if (err?.name === "AbortError") return;
    throw err;
  }
}

export async function copyListingLink(url) {
  if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(url);
    return;
  }
  const ta = document.createElement("textarea");
  ta.value = url;
  ta.setAttribute("readonly", "");
  ta.style.position = "fixed";
  ta.style.left = "-9999px";
  document.body.appendChild(ta);
  ta.select();
  document.execCommand("copy");
  document.body.removeChild(ta);
}

const SHARE_NETWORKS = {
  vk: {
    label: "VK",
    buildUrl: ({ url, title }) =>
      `https://vk.com/share.php?${new URLSearchParams({ url, title }).toString()}`,
  },
  ok: {
    label: "Одноклассники",
    buildUrl: ({ url, title }) =>
      `https://connect.ok.ru/offer?${new URLSearchParams({ url, title }).toString()}`,
  },
  whatsapp: {
    label: "WhatsApp",
    buildUrl: ({ url, text }) =>
      `https://wa.me/?text=${encodeURIComponent(`${text}\n${url}`)}`,
  },
  telegram: {
    label: "Telegram",
    buildUrl: ({ url, text }) =>
      `https://t.me/share/url?${new URLSearchParams({ url, text }).toString()}`,
  },
};

export const SHARE_NETWORK_IDS = ["vk", "ok", "whatsapp", "telegram"];

/**
 * @param {"vk"|"ok"|"whatsapp"|"telegram"} networkId
 * @param {{ url: string, title: string, text: string }} payload
 */
export function openShareNetwork(networkId, payload) {
  const net = SHARE_NETWORKS[networkId];
  if (!net) return;
  const shareUrl = net.buildUrl(payload);
  window.open(shareUrl, "_blank", "noopener,noreferrer");
}

export function shareNetworkLabel(networkId) {
  return SHARE_NETWORKS[networkId]?.label || networkId;
}
