"""
Справочник цветов кузова (slug → русское название) и эвристика по тексту карточки (中文 / EN).
Без платных API: только паттерны и словарь ключевых слов.
"""

from __future__ import annotations

import re

# Slug должен быть стабильным для API и БД; подпись — для UI и описания.
BODY_COLOR_OPTIONS: tuple[tuple[str, str], ...] = (
    ("white", "Белый"),
    ("black", "Чёрный"),
    ("silver", "Серебристый"),
    ("gray", "Серый"),
    ("blue", "Синий"),
    ("red", "Красный"),
    ("green", "Зелёный"),
    ("brown", "Коричневый"),
    ("orange", "Оранжевый"),
    ("yellow", "Жёлтый"),
    ("purple", "Фиолетовый"),
    ("gold", "Золотистый"),
    ("beige", "Бежевый"),
    ("champagne", "Шампань"),
    ("pink", "Розовый"),
    ("other", "Другой"),
)

ALLOWED_BODY_COLOR_SLUGS = frozenset(s for s, _ in BODY_COLOR_OPTIONS)
BODY_COLOR_LABEL_BY_SLUG: dict[str, str] = dict(BODY_COLOR_OPTIONS)


def label_for_slug(slug: str | None) -> str | None:
    if not slug or not isinstance(slug, str):
        return None
    s = slug.strip()
    return BODY_COLOR_LABEL_BY_SLUG.get(s)


def slug_from_form(raw: str | None) -> str | None:
    """Разбор поля multipart (пусто → None); неверный текст — исключением занимается роут."""
    if raw is None:
        return None
    st = str(raw).strip()
    if not st:
        return None
    st = st.lower()
    if st not in ALLOWED_BODY_COLOR_SLUGS:
        return None
    return st


# Пары (подстрока CN, slug). Длинные первыми — чтобы «银灰色» не стал только «银色» раньше времени.
_CN_SUBSTRINGS: tuple[tuple[str, str], ...] = tuple(
    sorted(
        [
            ("珠光白", "white"),
            ("珍珠白", "white"),
            ("象牙白", "white"),
            ("雪域白", "white"),
            ("雪山白", "white"),
            ("极地白", "white"),
            ("铂金白", "white"),
            ("茉莉白", "white"),
            ("乳白色", "white"),
            ("素雅白", "white"),
            ("水晶白", "white"),
            ("月亮白", "white"),
            ("云母白", "white"),
            ("珍珠漆白", "white"),
            ("白色", "white"),
            ("纯白", "white"),
            ("哑光黑", "black"),
            ("磨砂黑", "black"),
            ("曜夜黑", "black"),
            ("曜岩黑", "black"),
            ("碳纤黑", "black"),
            ("碳黑色", "black"),
            ("墨黑", "black"),
            ("钢琴黑", "black"),
            ("玄武黑", "black"),
            ("曜石黑", "black"),
            ("珠光黑", "black"),
            ("金属黑", "black"),
            ("黑色", "black"),
            ("银灰色", "gray"),
            ("哑光灰", "gray"),
            ("磨砂灰", "gray"),
            ("战斗灰", "gray"),
            ("纳多灰", "gray"),
            ("星云灰", "gray"),
            ("碧玺灰", "gray"),
            ("曼哈顿灰", "gray"),
            ("海豚灰", "gray"),
            ("极地灰", "gray"),
            ("铂金灰", "gray"),
            ("深灰色", "gray"),
            ("浅灰色", "gray"),
            ("烟灰色", "gray"),
            ("水泥灰", "gray"),
            ("陨石灰", "gray"),
            ("山灰", "gray"),
            ("灰色", "gray"),
            ("银白色", "silver"),
            ("星辉银", "silver"),
            ("哑光银", "silver"),
            ("液态金属银", "silver"),
            ("铱银", "silver"),
            ("钻石银", "silver"),
            ("金属银", "silver"),
            ("银色", "silver"),
            ("宝石蓝", "blue"),
            ("深蓝色", "blue"),
            ("天空蓝", "blue"),
            ("冰川蓝", "blue"),
            ("加勒比蓝", "blue"),
            ("瓷器蓝", "blue"),
            ("量子蓝", "blue"),
            ("风暴蓝", "blue"),
            ("雾霾蓝", "blue"),
            ("午夜蓝", "blue"),
            ("湛蓝色", "blue"),
            ("海王星蓝", "blue"),
            ("蓝绿色", "green"),
            ("碧玺绿", "green"),
            ("哑光绿", "green"),
            ("曼巴绿", "green"),
            ("松石绿", "green"),
            ("军绿色", "green"),
            ("墨绿色", "green"),
            ("绿色", "green"),
            ("青绿色", "green"),
            ("蓝色", "blue"),
            ("湛蓝", "blue"),
            ("海蓝", "blue"),
            ("天蓝", "blue"),
            ("冰蓝", "blue"),
            ("酒红色", "red"),
            ("勃艮第红", "red"),
            ("烈焰红", "red"),
            ("朱砂红", "red"),
            ("碧玺红", "red"),
            ("火山红", "red"),
            ("糖果红", "red"),
            ("熔岩红", "red"),
            ("宝石红", "red"),
            ("米兰红", "red"),
            ("红色", "red"),
            ("玫红色", "red"),
            ("粉红色", "pink"),
            ("粉色", "pink"),
            ("橙色", "orange"),
            ("黄色", "yellow"),
            ("柠檬黄", "yellow"),
            ("香槟色", "champagne"),
            ("香槟金", "champagne"),
            ("鎏金", "gold"),
            ("流沙金", "gold"),
            ("玫瑰金", "gold"),
            ("金色", "gold"),
            ("米色", "beige"),
            ("象牙色", "beige"),
            ("驼色", "beige"),
            ("咖啡色", "brown"),
            ("焦糖色", "brown"),
            ("棕色", "brown"),
            ("檀木棕", "brown"),
            ("哑光紫", "purple"),
            ("紫红色", "purple"),
            ("紫色", "purple"),
            ("哑光粉", "pink"),
            ("双拼色", "other"),
            ("渐变", "other"),
            ("迷彩", "other"),
        ],
        key=lambda x: len(x[0]),
        reverse=True,
    )
)

_FIELD_PATTERNS_CN = (
    r"(?:车身颜色|外观颜色|车体颜色|车辆颜色|颜色)[：:\s]*([^\n\r|／/]{1,32})",
    r"(?:涂装|车漆)[：:\s]*([^\n\r|／/]{1,32})",
)

_EN_WORDS: tuple[tuple[str, str], ...] = (
    ("silver", "silver"),
    ("pearl white", "white"),
    ("metallic grey", "gray"),
    ("metallic gray", "gray"),
    ("anthracite", "gray"),
    ("graphite", "gray"),
    ("titanium", "silver"),
    ("bronze", "brown"),
    ("burgundy", "red"),
    ("wine red", "red"),
    ("navy blue", "blue"),
    ("steel blue", "blue"),
    ("sand", "beige"),
    ("champagne", "champagne"),
    ("ebony", "black"),
    ("white", "white"),
    ("black", "black"),
    ("grey", "gray"),
    ("gray", "gray"),
    ("blue", "blue"),
    ("cyan", "blue"),
    ("teal", "green"),
    ("red", "red"),
    ("green", "green"),
    ("brown", "brown"),
    ("orange", "orange"),
    ("yellow", "yellow"),
    ("purple", "purple"),
    ("gold", "gold"),
    ("beige", "beige"),
    ("pink", "pink"),
)


def guess_body_color_slug_from_vehicle_text(text: str | None) -> str | None:
    if not text or not isinstance(text, str):
        return None
    chunk = text.strip()
    if len(chunk) < 2:
        return None
    for pat in _FIELD_PATTERNS_CN:
        m = re.search(pat, chunk)
        if m:
            frag = (
                m.group(1).strip().split("|")[0].strip().split("／")[0].strip().split("/")[0].strip()
            )
            slug = _map_cn_fragment(frag)
            if slug:
                return slug

    slug = _map_cn_fragment(chunk)
    if slug:
        return slug

    low = chunk.lower()
    for word, slug in sorted(_EN_WORDS, key=lambda x: len(x[0]), reverse=True):
        if word in low:
            if slug in ALLOWED_BODY_COLOR_SLUGS:
                return slug
    return None


def _map_cn_fragment(fragment: str) -> str | None:
    if not fragment:
        return None
    for zh, slug in _CN_SUBSTRINGS:
        if zh in fragment:
            return slug
    return None
