import os
import re
from dataclasses import dataclass
from typing import Any

import httpx
from playwright.sync_api import sync_playwright

from .autohome_config import extract_autohome_spec_id

from .body_colors import guess_body_color_slug_from_vehicle_text


# Старый формат карточки; на витрине серии чаще встречаются дилерские URL.
CAR_DETAIL_ID_RE = re.compile(r"che168\.com/car/(\d+)", re.IGNORECASE)
# https://www.che168.com/dealer/{dealerId}/{infoId}.html — основной формат списка объявлений
DEALER_LISTING_RE = re.compile(r"che168\.com/dealer/(\d+)/(\d+)\.html", re.IGNORECASE)
# https://global.che168.com/detail/{id}
GLOBAL_CHE168_DETAIL_RE = re.compile(r"global\.che168\.com/detail/(\d+)", re.IGNORECASE)
# https://www.dongchedi.com/usedcar/{id}
DONGCHEDI_USEDCAR_RE = re.compile(r"(?:www\.)?dongchedi\.com/usedcar/(\d+)", re.IGNORECASE)
YEAR_RE = re.compile(r"(?<!\d)(19\d{2}|20\d{2})(?!\d)")
ENGINE_L_RE = re.compile(r"([0-9]{1,2}(?:\.[0-9])?)\s*L", re.IGNORECASE)
HORSEPOWER_RE = re.compile(r"([0-9]{2,4})\s*(马力|匹|hp|ps)", re.IGNORECASE)
MILEAGE_WAN_KM_RE = re.compile(r"([0-9]{1,3}(?:\.[0-9])?)\s*万\s*公里", re.IGNORECASE)
MILEAGE_KM_RE = re.compile(r"([0-9]{2,6})\s*公里", re.IGNORECASE)


UA = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
    "AppleWebKit/537.36 (KHTML, like Gecko) "
    "Chrome/120.0.0.0 Safari/537.36"
)


def _body_color_slug_from_vehicle_text(title: str | None, body_text: str | None) -> str | None:
    blob = f"{title or ''}\n{body_text or ''}".strip()
    return guess_body_color_slug_from_vehicle_text(blob) if blob else None

# Баннеры, QR, иконки UI — не фото автомобиля (escimg может отдавать и рекламу).
_BAD_IMG_MARKERS = (
    "qrcode",
    "qr_",
    "/qr",
    "banner",
    "logo",
    "avatar",
    "message",
    "email",
    "share",
    "weixin",
    "wx_",
    "common/",
    "head_nav",
    "footer",
    "sidebar",
    "promo",
    "activity",
    "advert",
    "ico/",
    "loading",
    "placeholder",
    "autohome.com.cn/common",
    "nopic",
    "default",
    "sprite",
)


def is_likely_vehicle_photo_url(url: str) -> bool:
    u = (url or "").strip().lower()
    if not u.startswith("http"):
        return False
    if any(m in u for m in _BAD_IMG_MARKERS):
        return False
    # Не использовать просто «che168» в домене — туда попадают баннеры и UI.
    if any(
        x in u
        for x in (
            "escimg",
            "2sc.autohome",
            "2scimg",
            "dealer2sc",
            "pic.autohome",
            "car2.autoimg.cn",
            "byteimg.com",
            "pstatp.com",
            "dcd-cdn",
            "dcarstatic.com",
            "dcd-sign",
        )
    ):
        return True
    return False


def http_referer_for_request_url(url: str) -> str:
    """
    Referer для HTTP-запросов страницы объявления и CDN-изображений
    (у разных хостов картинок — разные ограничения hotlink).
    """
    u = (url or "").lower()
    if "dongchedi.com" in u or "byteimg.com" in u or "pstatp.com" in u:
        return "https://www.dongchedi.com/"
    if "global.che168.com" in u:
        return "https://global.che168.com/"
    return "https://www.che168.com/"


def marketplace_from_detail_url(url: str) -> str:
    """Ключ площадки: che168 | global_che168 | dongchedi."""
    u = (url or "").lower()
    if "global.che168.com" in u and "/detail/" in u:
        return "global_che168"
    if "dongchedi.com" in u and "/usedcar/" in u:
        return "dongchedi"
    return "che168"


def car_source_for_marketplace(marketplace: str) -> str:
    m = (marketplace or "").strip()
    if m in ("che168", "global_che168", "dongchedi"):
        return m
    return "che168"


def filter_vehicle_photo_urls(urls: list[str] | None) -> list[str]:
    if not urls:
        return []
    out: list[str] = []
    for x in urls:
        if x and is_likely_vehicle_photo_url(x) and x not in out:
            out.append(x)
        if len(out) >= 16:
            break
    return out


@dataclass
class ParsedCar:
    source_listing_id: str
    title: str | None = None
    series_raw: str | None = None  # «车型» на che168
    description: str | None = None
    year: int | None = None
    engine_volume_cc: int | None = None
    horsepower: int | None = None
    mileage_km: int | None = None
    fuel_type: str | None = None
    transmission: str | None = None
    location_city: str | None = None
    body_color_slug: str | None = None
    price_cny: float | None = None
    registration_date: str | None = None
    production_date: str | None = None
    photos: list[str] | None = None
    autohome_spec_id: int | None = None


def _extract_first_int(text: str | None) -> int | None:
    if not text:
        return None
    m = re.search(r"([0-9]{2,6})", text)
    return int(m.group(1)) if m else None


def _parse_year(s: str | None) -> int | None:
    if not s:
        return None
    m = YEAR_RE.search(s)
    return int(m.group(1)) if m else None


def _parse_engine_volume_cc(s: str | None) -> int | None:
    if not s:
        return None
    # 2.0T -> 2000
    m = re.search(r"(\d\.\d)\s*T", s, re.I)
    if m:
        return int(round(float(m.group(1)) * 1000))
    # 1.6L -> 1600
    m = ENGINE_L_RE.search(s)
    if not m:
        return None
    liters = float(m.group(1))
    return int(round(liters * 1000))


def _parse_horsepower(s: str | None) -> int | None:
    if not s:
        return None
    m = re.search(
        r"\(\s*([0-9]{2,4})\s*(?:Ps|PS|马力|匹|hp)\s*\)", s, re.I
    )
    if m:
        return int(m.group(1))
    m = HORSEPOWER_RE.search(s)
    if m:
        return int(m.group(1))
    m = re.search(
        r"(?:最大功率|额定功率|发动机功率)[^\d]{0,24}(\d{1,3}(?:\.\d)?)\s*kW",
        s,
        re.I,
    )
    if m:
        kw = float(m.group(1))
        if 20 <= kw <= 900:
            return int(round(kw * 1.35962))
    for m in re.finditer(r"\b(\d{2,3}(?:\.\d)?)\s*kW\b", s, re.I):
        kw = float(m.group(1))
        if 25 <= kw <= 500:
            return int(round(kw * 1.35962))
    return None


def _extract_series_raw(body: str | None, title: str | None) -> str | None:
    if body:
        for pat in (
            r"车型[：:\s]*([^\n\r|]{2,80})",
            r"车辆款型[：:\s]*([^\n\r|]{2,80})",
            r"款型[：:\s]*([^\n\r|]{2,80})",
            r"车系[：:\s]*([^\n\r|]{2,80})",
        ):
            m = re.search(pat, body)
            if m:
                t = m.group(1).strip()
                t = re.split(r"\s{2,}|\|", t, maxsplit=1)[0].strip()
                if len(t) >= 2:
                    return t[:120]
    return None


def _parse_mileage_km(s: str | None) -> int | None:
    if not s:
        return None
    # Табличное поле «表显里程» на che168
    m = re.search(r"表显里程[^\d]{0,12}(\d+(?:\.\d+)?)\s*万\s*公里", s)
    if m:
        return int(round(float(m.group(1)) * 10000))
    m = MILEAGE_WAN_KM_RE.search(s)
    if m:
        wan = float(m.group(1))
        return int(round(wan * 10000))
    m = MILEAGE_KM_RE.search(s)
    if m:
        return int(m.group(1))
    return None


def _parse_price_cny(body_text: str) -> float | None:
    """Цена в юанях; не путать с «X.X万公里»."""
    if not body_text:
        return None
    m = re.search(r"(?:售价|车辆价格|价格)[：:\s]*(\d{1,4}(?:\.\d+)?)\s*万(?!公里)", body_text)
    if m:
        try:
            return float(m.group(1)) * 10000.0
        except ValueError:
            pass
    for m in re.finditer(r"(\d{1,4}(?:\.\d+)?)\s*万(?!公里)", body_text):
        try:
            val = float(m.group(1))
            if 0.3 <= val <= 8000:
                return val * 10000.0
        except ValueError:
            continue
    return None


def _parse_price_from_html_json(html: str) -> float | None:
    if not html:
        return None
    m = re.search(r'"price"\s*:\s*"?\s*(\d[\d.]*)\s*万', html, re.I)
    if m:
        try:
            return float(m.group(1)) * 10000.0
        except ValueError:
            pass
    m = re.search(
        r'(?:salePrice|carPrice|price)\s*[:=]\s*["\']?\s*(\d{1,4}(?:\.\d+)?)\s*万(?!公里)',
        html,
        re.I,
    )
    if m:
        try:
            return float(m.group(1)) * 10000.0
        except ValueError:
            pass
    return None


def _parse_registration_date(s: str) -> str | None:
    m = re.search(r"上牌时间[^\d]{0,12}(\d{4})[年\-](\d{1,2})", s)
    if m:
        return f"{m.group(1)}-{int(m.group(2)):02d}-01"
    m = re.search(r"上牌[^\d]{0,12}(\d{4})[年\-](\d{1,2})", s)
    if m:
        return f"{m.group(1)}-{int(m.group(2)):02d}-01"
    return None


def _parse_production_date(s: str) -> str | None:
    for label in ("出厂日期", "制造年月", "生产日期"):
        m = re.search(rf"{label}[^\d]{{0,16}}(\d{{4}})[年\-](\d{{1,2}})", s)
        if m:
            return f"{m.group(1)}-{int(m.group(2)):02d}-01"
    return None


def _parse_fuel_transmission_city(body: str) -> tuple[str | None, str | None, str | None]:
    fuel: str | None = None
    trans: str | None = None
    city: str | None = None
    m = re.search(
        r"(?:燃料类型|燃油类型|能源类型|燃料)[：:\s]*([\u4e00-\u9fffA-Za-z0-9·\-/（）()]{2,24})",
        body,
    )
    if m:
        fuel = re.split(r"[|\s]{2,}", m.group(1).strip(), maxsplit=1)[0].strip()
    if not fuel:
        m = re.search(r"(汽油|柴油|混动|插电混动|纯电|增程)", body)
        if m:
            fuel = m.group(1)
    m = re.search(
        r"(?:变速箱|档位)[^\u4e00-\u9fffA-Za-z0-9]{0,8}([\u4e00-\u9fffA-Za-z0-9/]{1,16})",
        body,
    )
    if m:
        trans = m.group(1).strip()
        if trans and ("保养" in trans or "维修方式" in trans):
            trans = None
    if not trans:
        m = re.search(r"(自动|手动|CVT|AT|DCT|双离合)", body, re.I)
        if m:
            trans = m.group(1).upper() if m.group(1).lower() in ("cvt", "at", "dct") else m.group(1)
    m = re.search(r"车源城市[^\u4e00-\u9fff]{0,5}([\u4e00-\u9fff]{2,8})", body)
    if m:
        city = m.group(1).strip()
    if not city:
        m = re.search(r"【([^】]{2,8})】", body[:400])
        if m:
            city = m.group(1).strip()
    return fuel, trans, city


def _narrow_description(body_text: str) -> str | None:
    if not body_text:
        return None
    t = re.sub(r"&#x?[0-9a-fA-F]+;", " ", body_text)
    if "二手车之家" in t or "更多城市" in t:
        t = re.split(r"二手车之家|更多城市|A\s+合肥", t, maxsplit=1)[0]
    t = t.strip()
    if len(t) > 4000:
        t = t[:4000].rsplit(" ", 1)[0]
    return t if t else None


def _normalize_listing_href(href: str) -> str | None:
    if not href:
        return None
    h = href.strip()
    if h.startswith("//"):
        h = "https:" + h
    elif h.startswith("/") and not h.startswith("//"):
        h = "https://www.che168.com" + h
    m = DEALER_LISTING_RE.search(h)
    if m:
        return f"https://www.che168.com/dealer/{m.group(1)}/{m.group(2)}.html"
    m = CAR_DETAIL_ID_RE.search(h)
    if m:
        return f"https://i.che168.com/car/{m.group(1)}"
    return None


def che168_detail_url_from_source_listing_id(source_listing_id: str) -> str | None:
    """Собрать URL карточки объявления из Car.source_listing_id (разные площадки)."""
    sid = (source_listing_id or "").strip()
    if not sid:
        return None
    if sid.startswith("global-"):
        tail = sid[len("global-") :]
        if tail.isdigit():
            return f"https://global.che168.com/detail/{tail}"
        return None
    if sid.startswith("dongchedi-"):
        tail = sid[len("dongchedi-") :]
        if tail.isdigit():
            return f"https://www.dongchedi.com/usedcar/{tail}"
        return None
    if sid.startswith("dealer-"):
        body = sid[len("dealer-") :]
        if "-" in body:
            a, b = body.split("-", 1)
            if a.isdigit() and b.isdigit():
                return f"https://www.che168.com/dealer/{a}/{b}.html"
        return None
    if sid.isdigit():
        return f"https://i.che168.com/car/{sid}"
    return None


def source_listing_id_from_url(url: str) -> str:
    """Совпадает с тем, что пишем в Car.source_listing_id."""
    m = GLOBAL_CHE168_DETAIL_RE.search(url)
    if m:
        return f"global-{m.group(1)}"
    m = DONGCHEDI_USEDCAR_RE.search(url)
    if m:
        return f"dongchedi-{m.group(1)}"
    m = CAR_DETAIL_ID_RE.search(url)
    if m:
        return m.group(1)
    m = DEALER_LISTING_RE.search(url)
    if m:
        return f"dealer-{m.group(1)}-{m.group(2)}"
    raise ValueError(f"Не удалось извлечь id объявления из URL: {url}")


def _is_che168_bot_challenge_html(html: str) -> bool:
    """JS-антибот che168 без HTML карточки (EO_Bot, Tencent TEO challenge и т.п.)."""
    if not html:
        return False
    head = html[:12000]
    if (
        "TEOJsChallengeSdk" in head
        or "captcha.eo.gtimg.com" in head
        or "__TENCENT_CHAOS_VM" in head
        or "EO_Bot_Ssid" in head
        or "__tst_status" in head
        or ("document.cookie" in head and "_0x649a" in head)
    ):
        return True
    # Урезанная оболочка без контента карточки (типично с VPS вне Китая).
    if len(html) < 80_000 and "表显里程" not in html and "二手车之家" not in html:
        if re.search(r"<title>\s*</title>", head, re.I):
            return True
        if "Vehicle Details" not in html and not re.search(
            r"<title>[^<]{8,}</title>", head, re.I
        ):
            return True
    return False


def _is_global_che168_stub_html(html: str) -> bool:
    """global.che168 часто отдаёт английскую заглушку без цены."""
    if not html:
        return False
    head = html[:8000]
    return (
        "China Used Cars Export" in head
        or "Second Hand Cars - Autohome" in head
        or "Vehicle Details" in head and len(html) < 12_000
    )


def _decode_http_response_text(response: httpx.Response) -> str:
    """che168 отдаёт gb2312/gbk; без явного decode кириллица/китайский ломаются."""
    raw = response.content or b""
    if not raw:
        return ""
    ctype = (response.headers.get("content-type") or "").lower()
    m = re.search(r"charset=([\w-]+)", ctype)
    charset = (m.group(1) if m else "").strip().lower()
    for enc in (charset, "gb18030", "gbk", "gb2312", "utf-8"):
        if not enc:
            continue
        try:
            return raw.decode(enc, errors="strict")
        except (LookupError, UnicodeDecodeError):
            continue
    return raw.decode("utf-8", errors="replace")


def _raise_if_captcha(url: str, html: str) -> None:
    u = url.lower()
    head = (html or "")[:12000]
    if "captcha" in u or "安全验证" in head or "二手车之家-安全验证" in head:
        raise RuntimeError(
            "che168.com открыл страницу антибот-проверки (captcha). "
            "Серверы и Docker часто блокируются. Задайте CHE168_FORCE_DETAIL_URLS "
            "(ссылки на карточки /dealer/…/….html или i.che168.com/car/… из браузера)."
        )
    if _is_che168_bot_challenge_html(html):
        raise RuntimeError(
            "che168.com вернул антибот-страницу (JS-проверка). "
            "Парсер попробует открыть карточку через браузер."
        )


def _http_get_text(url: str, timeout: float = 45.0) -> str:
    headers = {
        "User-Agent": UA,
        "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Referer": http_referer_for_request_url(url),
    }
    with httpx.Client(timeout=timeout, follow_redirects=True, headers=headers) as client:
        r = client.get(url)
        r.raise_for_status()
        text = _decode_http_response_text(r)
        _raise_if_captcha(str(r.url), text)
        return text


def _pw_launch_timeout_ms() -> int:
    return int(os.getenv("CHE168_PLAYWRIGHT_LAUNCH_TIMEOUT_MS", "90000"))


def _pw_page_navigation_timeout_ms(detail_url: str) -> int:
    """懂车帝 в Docker часто грузится дольше che168 — отдельный лимит goto/DOM."""
    if marketplace_from_detail_url(detail_url) == "dongchedi":
        return int(os.getenv("DONGCHEDI_PW_GOTO_TIMEOUT_MS", "90000"))
    return int(os.getenv("CHE168_PW_GOTO_TIMEOUT_MS", "60000"))


def _title_from_che168_document_title(raw: str | None) -> str | None:
    if not raw:
        return None
    title = raw.strip()
    if not title:
        return None
    # «【哈尔滨】宝马3系…_21.58…_二手车之家»
    if "_" in title:
        title = title.split("_")[0].strip()
    title = re.sub(r"^【[^】]+】", "", title).strip()
    return title or None


def _global_che168_detail_url_from_detail_url(detail_url: str) -> str | None:
    m = DEALER_LISTING_RE.search(detail_url)
    if m:
        return f"https://global.che168.com/detail/{m.group(2)}"
    m = CAR_DETAIL_ID_RE.search(detail_url)
    if m:
        return f"https://global.che168.com/detail/{m.group(1)}"
    return None


def _chinese_i_che168_url_from_detail_url(detail_url: str) -> str | None:
    """Китайская карточка i.che168.com — полные поля и specId Autohome (не global EN)."""
    m = GLOBAL_CHE168_DETAIL_RE.search(detail_url)
    if m:
        return f"https://i.che168.com/car/{m.group(1)}"
    m = CAR_DETAIL_ID_RE.search(detail_url)
    if m:
        return f"https://i.che168.com/car/{m.group(1)}"
    m = DEALER_LISTING_RE.search(detail_url)
    if m:
        return f"https://i.che168.com/car/{m.group(2)}"
    return None


def _detail_fetch_urls(detail_url: str) -> list[str]:
    """
    Порядок HTTP/Playwright:
    - dealer URL — сначала канонический dealer (полная SSR-страница), i.che168 и global — запасные;
    - иначе i.che168 → исходный → global.
    """
    seen: set[str] = set()
    out: list[str] = []

    def add(u: str | None) -> None:
        if not u:
            return
        key = u.rstrip("/")
        if key in seen:
            return
        seen.add(key)
        out.append(u)

    is_dealer = bool(DEALER_LISTING_RE.search(detail_url))
    if is_dealer:
        add(_single_listing_url_from_input(detail_url))
        add(_chinese_i_che168_url_from_detail_url(detail_url))
        add(_global_che168_detail_url_from_detail_url(detail_url))
    else:
        add(_chinese_i_che168_url_from_detail_url(detail_url))
        add(detail_url.strip())
        add(_global_che168_detail_url_from_detail_url(detail_url))
    return out


def _playwright_fetch_urls(detail_url: str) -> list[str]:
    """Не гоняем Playwright по global-заглушке и лишним URL — только перспективные."""
    urls = _detail_fetch_urls(detail_url)
    out: list[str] = []
    for u in urls:
        if "global.che168.com" in u:
            continue
        out.append(u)
    return out or urls[:1]


def _parse_is_complete(parsed: ParsedCar | None) -> bool:
    """HTTP-разбор без цены — неполный (типично global.che168 на английском)."""
    if parsed is None:
        return False
    return parsed.price_cny is not None and parsed.price_cny > 0


def _parse_quality_score(parsed: ParsedCar | None) -> int:
    if parsed is None:
        return 0
    score = 0
    if parsed.price_cny and parsed.price_cny > 0:
        score += 10
    if parsed.mileage_km:
        score += 3
    if parsed.registration_date:
        score += 2
    if parsed.autohome_spec_id:
        score += 5
    if parsed.fuel_type:
        score += 1
    if parsed.photos:
        score += min(len(parsed.photos), 3)
    return score


def _che168_dismiss_overseas_modal(page) -> None:
    for sel in (
        "text=Continue to Chinese Site",
        "text=继续访问中文站",
        "text=继续访问",
    ):
        try:
            btn = page.locator(sel).first
            if btn.count() and btn.is_visible(timeout=800):
                btn.click(timeout=3000)
                page.wait_for_timeout(1500)
                return
        except Exception:
            pass


def _che168_playwright_goto(page, url: str, timeout_ms: int) -> None:
    """
    che168 часто не доходит до domcontentloaded (антибот/тяжёлый JS).
    commit + ожидание текста карточки надёжнее, чем domcontentloaded.
    """
    page.goto(url, wait_until="commit", timeout=timeout_ms)
    page.wait_for_timeout(1500)
    _che168_dismiss_overseas_modal(page)
    try:
        page.wait_for_function(
            """() => {
                const t = (document.body && document.body.innerText) || '';
                if (t.includes('表显里程') || t.includes('Vehicle Details')) return true;
                if (/\\d{1,2}\\.\\d{2}\\s*万/.test(t) && t.includes('公里')) return true;
                return false;
            }""",
            timeout=timeout_ms,
        )
    except Exception:
        page.wait_for_timeout(3000)


def _dongchedi_derive_listing_price_cny(price_block_text: str) -> float | None:
    """Цена объявления: 新车指导价 − 比新车省 (万 или 元 на 懂车帝)."""
    if not price_block_text:
        return None
    flat = price_block_text.replace(",", "").replace("，", "")
    ym = re.search(r"新车指导价[^0-9]{0,26}(\d{5,8})\s*元", flat)
    smy = re.search(r"比新车省[^0-9]{0,26}(\d{4,8})\s*元", flat)
    if ym and smy:
        try:
            gy, sy = float(ym.group(1)), float(smy.group(1))
            if gy > sy >= 0:
                return gy - sy
        except ValueError:
            pass

    t = flat
    nm = re.search(r"新车指导价[^0-9\-]{0,24}([\d.]+)\s*万", t)
    sm = re.search(r"比新车省[^0-9\-]{0,24}([\d.]+)\s*万", t)
    if nm and sm:
        try:
            guide_wan = float(nm.group(1))
            save_wan = float(sm.group(1))
            if guide_wan > save_wan >= 0 and guide_wan - save_wan >= 0.25:
                return (guide_wan - save_wan) * 10000.0
        except ValueError:
            pass
    # Резерв: явная «万» в шапке (без «公里»)
    wm = re.search(r"(?<![\d.])([\d]{1,2}\.[\d]{2})\s*万(?!公里)", t)
    if wm:
        try:
            wan = float(wm.group(1))
            if 0.5 <= wan <= 800:
                return wan * 10000.0
        except ValueError:
            pass
    return None


def _dongchedi_mileage_km(body: str) -> int | None:
    if not body:
        return None
    for pat in (
        r"表显里程[：:\s]*(\d+(?:\.\d+)?)\s*万\s*公里",
        r"行驶里程[：:\s]*(\d+(?:\.\d+)?)\s*万\s*公里",
        r"公里数[：:\s]*(\d+(?:\.\d+)?)\s*万\s*公里",
    ):
        m = re.search(pat, body)
        if m:
            try:
                return int(round(float(m.group(1)) * 10000))
            except ValueError:
                pass
    return _parse_mileage_km(body)


def _dongchedi_transmission_fuel_city(body: str) -> tuple[str | None, str | None, str | None]:
    fuel, trans, city = _parse_fuel_transmission_city(body)
    mt = re.search(r"变速箱[：:\s]+([^\n\r|]{1,28})", body)
    if mt:
        cand = re.sub(r"[|（）()].*", "", mt.group(1)).strip().split()[0].strip()
        if cand and "保养" not in cand:
            trans = cand[:24]
    mf = re.search(r"(?:燃料类型|燃油类型|能源类型)[：:\s]+([^\n\r|]{1,22})", body)
    if mf and not fuel:
        fuel = mf.group(1).strip().split("|")[0].strip()[:24]
    if not fuel:
        m = re.search(r"排量[^\n]{0,40}(汽油|柴油|混动|纯电|插电|增程)", body)
        if m:
            fuel = m.group(1).strip()
    mcy = re.search(r"(?:上牌地|车源地)[：:\s]*([\u4e00-\u9fff·]{2,12})", body)
    if mcy:
        ta = mcy.group(1).strip()
        if ta and ta not in ("暂无", "--", "—"):
            city = ta[:16]
    return fuel, trans, city


def _dongchedi_collect_images(page: Any) -> list[str]:
    """Галерея usedcar: div#4; signed URL оставляем целиком (query обязателен)."""
    out: list[str] = []
    seen: set[str] = set()
    selectors = (
        'div[id="4"] img',
        '[class*="swiper-slide"] img',
        '[class*="gallery"] img',
        '[class*="detail_photo"] img',
    )
    for sel in selectors:
        try:
            for el in page.query_selector_all(sel):
                raw = ""
                for attr in (
                    "src",
                    "data-src",
                    "data-lazy-src",
                    "data-original",
                ):
                    raw = (el.get_attribute(attr) or "").strip()
                    if raw:
                        break
                if not raw or raw.startswith("data:"):
                    continue
                if raw.startswith("//"):
                    raw = "https:" + raw
                if raw.startswith("/"):
                    raw = "https://www.dongchedi.com" + raw
                if not raw.startswith("http"):
                    continue
                low = raw.lower()
                if "svg" in low or "icon" in low or "logo" in low:
                    continue
                if raw in seen:
                    continue
                if not is_likely_vehicle_photo_url(raw):
                    continue
                seen.add(raw)
                out.append(raw)
                if len(out) >= 20:
                    return filter_vehicle_photo_urls(out)
        except Exception:
            continue
    return filter_vehicle_photo_urls(out)


def _dongchedi_parse_playwright_detail(
    page: Any,
    detail_url: str,
    source_listing_id: str,
) -> ParsedCar:
    head_sel = '[class*="head-info_price-wrap"], [class*="head-info-price"]'
    try:
        page.locator(head_sel).first.wait_for(state="visible", timeout=15000)
    except Exception:
        pass
    page.wait_for_timeout(1200)
    for _ in range(3):
        page.mouse.wheel(0, 800)
        page.wait_for_timeout(400)

    price_block = ""
    try:
        price_block = page.locator(head_sel).first.inner_text(timeout=5000).strip()
    except Exception:
        price_block = ""

    title = None
    try:
        title_el = page.query_selector("h1")
        if title_el:
            title = (title_el.inner_text() or "").strip() or None
    except Exception:
        title = None

    try:
        body_text = page.inner_text("body") or ""
    except Exception:
        body_text = ""

    price_cny = _dongchedi_derive_listing_price_cny(price_block)
    if price_cny is None:
        price_cny = _dongchedi_derive_listing_price_cny(body_text[:12000])

    mileage_km = _dongchedi_mileage_km(body_text)
    registration_date = _parse_registration_date(body_text)
    production_date = _parse_production_date(body_text)
    fuel_type, transmission, location_city = _dongchedi_transmission_fuel_city(body_text)
    year = _parse_year(body_text or title)
    engine_volume_cc = _parse_engine_volume_cc(body_text or title)
    horsepower = _parse_horsepower(body_text or title)
    if horsepower is None:
        mh = re.search(r"最大马力[：:\s]*(\d{2,4})\s*(?:马力|匹|Ps|HP)?", body_text, re.I)
        if mh:
            horsepower = int(mh.group(1))
    photos = _dongchedi_collect_images(page)

    description = None
    m_desc = re.search(r"车况介绍[：:\s]*(.{40,3800})", body_text, re.S)
    if m_desc:
        description = re.sub(r"\s+", " ", m_desc.group(1).strip())[:3800]
    if not description:
        description = _narrow_description(body_text) or (
            body_text[:4000] if body_text else None
        )
    series_raw = _extract_series_raw(body_text, title)

    return ParsedCar(
        source_listing_id=source_listing_id,
        title=title,
        series_raw=series_raw,
        description=description,
        year=year,
        engine_volume_cc=engine_volume_cc,
        horsepower=horsepower,
        mileage_km=mileage_km,
        fuel_type=fuel_type,
        transmission=transmission,
        location_city=location_city,
        price_cny=price_cny,
        registration_date=registration_date,
        production_date=production_date,
        photos=photos or None,
        body_color_slug=_body_color_slug_from_vehicle_text(title, body_text),
    )


def _car_urls_from_html(html: str, max_items: int) -> list[str]:
    """Со страницы серии: сначала дилерские карточки, затем i.che168.com/car/."""
    seen: set[str] = set()
    out: list[str] = []

    def push(u: str) -> None:
        if u in seen:
            return
        seen.add(u)
        out.append(u)

    for m in DEALER_LISTING_RE.finditer(html):
        push(f"https://www.che168.com/dealer/{m.group(1)}/{m.group(2)}.html")
        if len(out) >= max_items:
            return out
    for m in CAR_DETAIL_ID_RE.finditer(html):
        push(f"https://i.che168.com/car/{m.group(1)}")
        if len(out) >= max_items:
            return out
    return out


def _strip_html_to_text(html: str) -> str:
    s = re.sub(r"(?is)<script[^>]*>.*?</script>", " ", html)
    s = re.sub(r"(?is)<style[^>]*>.*?</style>", " ", s)
    s = re.sub(r"<[^>]+>", " ", s)
    return re.sub(r"\s+", " ", s).strip()


def _parse_detail_from_html(html: str, source_listing_id: str) -> ParsedCar | None:
    """Пробуем разобрать карточку без браузера (если HTML отдаётся целиком)."""
    if not html or len(html) < 800:
        return None
    hm = re.search(r"(?is)<h1[^>]*>([^<]+)</h1>", html)
    title = hm.group(1).strip() if hm else None
    if not title:
        tm = re.search(r"<title>([^<]+)</title>", html, re.I)
        if tm:
            raw = tm.group(1).strip()
            title = raw.split("_")[0].strip()
            title = re.sub(r"^【[^】]+】", "", title).strip()
    body_text = _strip_html_to_text(html)
    if len(body_text) < 120 and not title:
        return None
    description = _narrow_description(body_text) or (
        body_text[:4000] if body_text else None
    )
    year = _parse_year(body_text or title)
    engine_volume_cc = _parse_engine_volume_cc(body_text or title)
    horsepower = _parse_horsepower(body_text or title)
    mileage_km = _parse_mileage_km(body_text)
    fuel_type, transmission, location_city = _parse_fuel_transmission_city(body_text)
    registration_date = _parse_registration_date(body_text)
    production_date = _parse_production_date(body_text)
    series_raw = _extract_series_raw(body_text, title)
    photos: list[str] = []
    for m in re.finditer(r'(?i)data-original=["\'](//[^"\']+\.(?:jpg|jpeg|png|webp)[^"\']*)["\']', html):
        src = m.group(1)
        if src.startswith("//"):
            src = "https:" + src
        if src and src not in photos and is_likely_vehicle_photo_url(src):
            photos.append(src)
        if len(photos) >= 12:
            break
    if len(photos) < 3:
        for m in re.finditer(
            r"""(?i)src=["'](https?://[^"']+\.(?:jpg|jpeg|png|webp)[^"']*)["']""",
            html,
        ):
            src = m.group(1)
            if src and src not in photos and is_likely_vehicle_photo_url(src):
                photos.append(src)
            if len(photos) >= 12:
                break
    photos = filter_vehicle_photo_urls(photos)
    price_cny = _parse_price_cny(body_text)
    if price_cny is None:
        price_cny = _parse_price_from_html_json(html)
    return ParsedCar(
        source_listing_id=source_listing_id,
        title=title,
        series_raw=series_raw,
        description=description,
        year=year,
        engine_volume_cc=engine_volume_cc,
        horsepower=horsepower,
        mileage_km=mileage_km,
        fuel_type=fuel_type,
        transmission=transmission,
        location_city=location_city,
        photos=photos or None,
        price_cny=price_cny,
        registration_date=registration_date,
        production_date=production_date,
        body_color_slug=_body_color_slug_from_vehicle_text(title, body_text),
        autohome_spec_id=extract_autohome_spec_id(html),
    )


def fetch_autohome_spec_id_from_detail_url(detail_url: str) -> int | None:
    """Только specId из HTML карточки (без полного разбора и Playwright)."""
    try:
        html = _http_get_text(detail_url, timeout=45.0)
    except Exception:
        return None
    return extract_autohome_spec_id(html)


def _listing_links_playwright(series_url: str, max_items: int) -> list[str]:
    links: list[str] = []
    seen: set[str] = set()

    def push_from_href(href: str) -> None:
        abs_url = _normalize_listing_href(href)
        if not abs_url or abs_url in seen:
            return
        seen.add(abs_url)
        links.append(abs_url)

    with sync_playwright() as p:
        browser = p.chromium.launch(
            headless=True,
            timeout=_pw_launch_timeout_ms(),
            args=["--disable-blink-features=AutomationControlled"],
        )
        context = browser.new_context(
            user_agent=UA,
            locale="zh-CN",
            extra_http_headers={"Accept-Language": "zh-CN,zh;q=0.9"},
        )
        context.set_default_timeout(35000)
        page = context.new_page()
        page.set_default_timeout(35000)
        page.goto(series_url, wait_until="commit", timeout=35000)
        page.wait_for_timeout(2500)
        if "captcha" in page.url.lower():
            raise RuntimeError(
                "Браузер попал на captcha che168. Используйте CHE168_FORCE_DETAIL_URLS "
                "или запуск с сети без антибота."
            )
        try:
            if page.title() and "安全验证" in page.title():
                raise RuntimeError("Страница проверки che168 (captcha).")
        except RuntimeError:
            raise
        except Exception:
            pass

        for _ in range(6):
            page.mouse.wheel(0, 2000)
            page.wait_for_timeout(1000)

        for a in page.query_selector_all("a[href]"):
            href = a.get_attribute("href") or ""
            push_from_href(href)
            if len(links) >= max_items:
                break

        if len(links) < max_items:
            try:
                html = page.content() or ""
                for m in DEALER_LISTING_RE.finditer(html):
                    push_from_href(f"https://www.che168.com/dealer/{m.group(1)}/{m.group(2)}.html")
                    if len(links) >= max_items:
                        break
                for m in CAR_DETAIL_ID_RE.finditer(html):
                    push_from_href(f"https://i.che168.com/car/{m.group(1)}")
                    if len(links) >= max_items:
                        break
            except Exception:
                pass

        context.close()
        browser.close()

    return links[:max_items]


def _forced_detail_urls() -> list[str]:
    raw = os.getenv("CHE168_FORCE_DETAIL_URLS", "").strip()
    if not raw:
        return []
    out: list[str] = []
    for part in raw.split(","):
        u = part.strip()
        if not u:
            continue
        norm = _normalize_listing_href(u)
        if norm:
            out.append(norm)
    return out


def normalize_import_detail_url(url: str) -> str | None:
    """
    Канонический URL карточки для ручного импорта:
    che168 (dealer/… / i.che168.com/car/), global.che168.com/detail/…, dongchedi.com/usedcar/…
    """
    u = (url or "").strip()
    if not u:
        return None
    m = GLOBAL_CHE168_DETAIL_RE.search(u)
    if m:
        return f"https://global.che168.com/detail/{m.group(1)}"
    m = DONGCHEDI_USEDCAR_RE.search(u)
    if m:
        return f"https://www.dongchedi.com/usedcar/{m.group(1)}"
    return _single_listing_url_from_input(u)


def normalize_che168_detail_url(url: str) -> str | None:
    """Обратная совместимость: см. normalize_import_detail_url."""
    return normalize_import_detail_url(url)


def _single_listing_url_from_input(url: str) -> str | None:
    """
    Если в поле «каталог» вставлена прямая ссылка на одно объявление (а не страница серии),
    возвращаем канонический URL карточки. Иначе None — дальше ищем список на странице.
    """
    u = (url or "").strip()
    if not u:
        return None
    m = DEALER_LISTING_RE.search(u)
    if m:
        return f"https://www.che168.com/dealer/{m.group(1)}/{m.group(2)}.html"
    m = CAR_DETAIL_ID_RE.search(u)
    if m:
        return f"https://i.che168.com/car/{m.group(1)}"
    return None


def parse_che168_listing_links(series_url: str, max_items: int = 20) -> list[str]:
    """
    Сначала HTTP (ссылки часто есть в HTML/скриптах без JS).
    Если ссылок нет и не отключён Playwright — один проход браузером.
    CHE168_FORCE_DETAIL_URLS — прямые URL карточек (через запятую), если список недоступен.
    Если в series_url уже ссылка на одно объявление (/dealer/…/….html или i.che168.com/car/…),
    возвращаем только её — не полагаемся на разбор HTML витрины серии.
    """
    forced = _forced_detail_urls()
    if forced:
        return forced[:max_items]

    single = _single_listing_url_from_input(series_url)
    if single:
        return [single][:max_items]

    links: list[str] = []
    try:
        html = _http_get_text(series_url, timeout=45.0)
        links = _car_urls_from_html(html, max_items)
    except RuntimeError:
        raise
    except Exception:
        links = []

    if len(links) >= 1:
        return links[:max_items]

    if os.getenv("CHE168_SKIP_PLAYWRIGHT", "").lower() in ("1", "true", "yes"):
        return []

    return _listing_links_playwright(series_url, max_items)


def _parse_che168_detail_playwright(detail_url: str, source_listing_id: str) -> ParsedCar:
    with sync_playwright() as p:
        browser = p.chromium.launch(
            headless=True,
            timeout=_pw_launch_timeout_ms(),
            args=["--disable-blink-features=AutomationControlled"],
        )
        ref = http_referer_for_request_url(detail_url)
        context = browser.new_context(
            user_agent=UA,
            locale="zh-CN",
            extra_http_headers={
                "Accept-Language": "zh-CN,zh;q=0.9",
                "Referer": ref,
            },
        )
        nav_ms = _pw_page_navigation_timeout_ms(detail_url)
        context.set_default_timeout(nav_ms)
        page = context.new_page()
        page.set_default_timeout(nav_ms)
        _che168_playwright_goto(page, detail_url, nav_ms)
        if "captcha" in page.url.lower():
            raise RuntimeError("Страница объявления перенаправила на антибот-проверку (captcha).")
        try:
            if page.title() and "安全验证" in page.title():
                raise RuntimeError("Страница антибот-проверки (captcha).")
        except RuntimeError:
            raise
        except Exception:
            pass

        if marketplace_from_detail_url(detail_url) == "dongchedi":
            try:
                return _dongchedi_parse_playwright_detail(
                    page, detail_url, source_listing_id
                )
            finally:
                context.close()
                browser.close()

        title = None
        try:
            title_el = page.query_selector("h1")
            if title_el:
                title = (title_el.inner_text() or "").strip() or None
        except Exception:
            pass
        if not title:
            try:
                title = _title_from_che168_document_title(page.title())
            except Exception:
                pass

        body_text = ""
        try:
            body_text = page.inner_text("body") or ""
        except Exception:
            body_text = ""

        description = _narrow_description(body_text) or (
            body_text[:4000] if body_text else None
        )

        year = _parse_year(body_text or title)
        engine_volume_cc = _parse_engine_volume_cc(body_text or title)
        horsepower = _parse_horsepower(body_text or title)
        mileage_km = _parse_mileage_km(body_text)
        fuel_type, transmission, location_city = _parse_fuel_transmission_city(body_text)
        registration_date = _parse_registration_date(body_text)
        production_date = _parse_production_date(body_text)
        price_cny = _parse_price_cny(body_text)
        series_raw = _extract_series_raw(body_text, title)
        autohome_spec_id: int | None = None
        try:
            autohome_spec_id = extract_autohome_spec_id(page.content() or "")
        except Exception:
            pass

        photos: list[str] = []
        try:
            imgs = page.query_selector_all("img")
            for img in imgs:
                src = (img.get_attribute("data-original") or img.get_attribute("src") or "").strip()
                if not src:
                    continue
                if src.startswith("//"):
                    src = "https:" + src
                if not src.startswith("http") or src in photos:
                    continue
                if is_likely_vehicle_photo_url(src):
                    photos.append(src)
                if len(photos) >= 12:
                    break
            photos = filter_vehicle_photo_urls(photos)
        except Exception:
            photos = []

        context.close()
        browser.close()

    return ParsedCar(
        source_listing_id=source_listing_id,
        title=title,
        series_raw=series_raw,
        description=description,
        year=year,
        engine_volume_cc=engine_volume_cc,
        horsepower=horsepower,
        mileage_km=mileage_km,
        fuel_type=fuel_type,
        transmission=transmission,
        location_city=location_city,
        price_cny=price_cny,
        registration_date=registration_date,
        production_date=production_date,
        photos=photos,
        body_color_slug=_body_color_slug_from_vehicle_text(title, body_text),
        autohome_spec_id=autohome_spec_id,
    )


def parse_che168_detail(detail_url: str) -> ParsedCar:
    """
    Сначала HTTP (кроме dongchedi — сразу браузер); при неполных данных — Playwright.
    Поддерживаются карточки che168, global.che168.com/detail/… и dongchedi.com/usedcar/…
    """
    source_listing_id = source_listing_id_from_url(detail_url)
    is_dongchedi = marketplace_from_detail_url(detail_url) == "dongchedi"
    fetch_urls = [detail_url] if is_dongchedi else _detail_fetch_urls(detail_url)

    best: ParsedCar | None = None
    best_score = 0

    captcha_hits = 0
    if not is_dongchedi:
        for url in fetch_urls:
            try:
                html = _http_get_text(url, timeout=30.0)
                if _is_global_che168_stub_html(html):
                    continue
                parsed = _parse_detail_from_html(html, source_listing_id)
                if parsed is None:
                    continue
                score = _parse_quality_score(parsed)
                if score > best_score:
                    best = parsed
                    best_score = score
                if _parse_is_complete(parsed):
                    return parsed
            except RuntimeError as exc:
                msg = str(exc)
                if "антибот" in msg or "captcha" in msg.lower():
                    captcha_hits += 1
                if "Парсер попробует открыть карточку через браузер" not in msg:
                    raise
            except httpx.HTTPStatusError as exc:
                if exc.response.status_code == 404:
                    continue
                raise
            except Exception:
                pass

    if os.getenv("CHE168_SKIP_PLAYWRIGHT", "").lower() in ("1", "true", "yes"):
        if best and best_score > 0:
            return best
        raise RuntimeError(
            "CHE168_SKIP_PLAYWRIGHT включён: страница объявления не разобрана по HTTP."
        )

    last_err: Exception | None = None
    pw_urls = [detail_url] if is_dongchedi else _playwright_fetch_urls(detail_url)
    for url in pw_urls:
        try:
            parsed = _parse_che168_detail_playwright(url, source_listing_id)
            if is_dongchedi:
                return parsed
            score = _parse_quality_score(parsed)
            if score > best_score:
                best = parsed
                best_score = score
            if _parse_is_complete(parsed):
                return parsed
        except Exception as exc:
            last_err = exc

    if best and best_score > 0:
        return best
    if captcha_hits >= len(fetch_urls):
        raise RuntimeError(
            "che168.com открыл антибот-проверку (Tencent captcha) для всех HTTP-запросов. "
            "С VPS вне Китая импорт часто недоступен: нужен прокси/импорт с локальной машины "
            "или CHE168_FORCE_DETAIL_URLS с URL, скопированным из браузера."
        )
    if last_err is not None:
        raise last_err
    raise RuntimeError(f"Не удалось разобрать карточку: {detail_url}")

