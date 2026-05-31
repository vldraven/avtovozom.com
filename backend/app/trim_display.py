"""Нормализация комплектации для UI: статусы ●/○/—, фильтр, перевод с китайского по словарю."""

from __future__ import annotations

import re
from typing import Any, Literal

TrimStatus = Literal["included", "optional", "text", "absent"]

_ABSENT_VALUES = frozenset({"—", "-", "－", "无", "暂无", "●无", "○无", "无●", "无○"})
_INCLUDED_MARKERS = frozenset({"●", "•", "■", "标配", "标准配置", "标准"})
_OPTIONAL_MARKERS = frozenset({"○", "◯", "选装", "选配"})
_HAS_CJK = re.compile(r"[\u4e00-\u9fff]")

_HEADING_SPECIALS_RE = re.compile(
    r"[·•/\\|，,;；:：!！?？\(\)（）\[\]【】「」『』*#@&+=<>\"'«»…_]+"
)

_PARAM_GROUP_ZH_RE = re.compile(
    r"基本参数|车身|发动机|变速箱|底盘转向|车轮制动|尺寸|参数|"
    r"основн|параметр|кузов|двигатель|коробк|подвеск|размер|масса",
    re.I,
)

_PARAM_GROUP_RU_RE = re.compile(
    r"основн|параметр|кузов|двигатель|коробк|подвеск|размер|масса|общая\s+информация|"
    r"эксплуатацион|基本信息|车身|发动机|尺寸|底盘|参数",
    re.I,
)

# Группы param Autohome для блока «Характеристики» на карточке
_PARAM_UI_GROUP_ZH = frozenset({"基本参数", "发动机", "车身"})

_PARAM_UI_GROUP_RU: dict[str, str] = {
    "基本参数": "Основные параметры",
    "发动机": "Двигатель",
    "车身": "Габариты",
}

_PARAM_SKIP_ITEM_ZH = frozenset(
    {
        "车型名称",
        "厂商指导价()",
        "厂商",
        "级别",
        "整车",
        "官方0-100km/h加速(s)",
        "最高车速(km/h)",
        "WLTC(L/100km)",
        "满载(kg)",
        "接近角(°)",
        "离去角(°)",
        "开启方式",
        "阻系数(Cd)",
        "形式",
        "方式",
        "材料",
        "标",
        "能源类型",
        "变速箱",
        "发动机布局",
    }
)

_PARAM_ITEM_ZH: dict[str, str] = {
    "发动机": "Двигатель",
    "长*宽*高(mm)": "Габариты",
    "长*宽*高（mm）": "Габариты",
    "长宽高(mm)": "Габариты",
    "车身结构": "Кузов",
    "发动机型": "Модель двигателя",
    "马力(Ps)": "Мощность",
    "(mL)": "Объём двигателя",
    "(kg)": "Снаряжённая масса",
    "轮距(mm)": "Колея",
    "座位数(个)": "Количество мест",
    "(L)": "Объём топливного бака",
    "后备厢(L)": "Объём багажника",
}

_BODY_MM_LABELS = ("Длина", "Ширина", "Высота", "Колёсная база")

_PARAM_NOISE_NAME_RE = re.compile(
    r"^[\(（]?(kW|N[·\s]?m|rpm|kg|mL|L|个|°|Ps)[\)）]?$",
    re.I,
)

_DIMS_RE = re.compile(
    r"长\s*[*×xX]\s*宽\s*[*×xX]\s*高",
    re.I,
)

_DIM_LABELS = frozenset({"Длина, мм", "Ширина, мм", "Высота, мм"})

# Не показываем на карточке объявления (только в справочнике / при необходимости позже)
_PARAM_CARD_SKIP_LABELS = frozenset({"Расположение двигателя"})

# Группы Autohome config → русские заголовки
_GROUP_ZH: dict[str, str] = {
    "被动安全": "Пассивная безопасность",
    "安全": "Безопасность",
    "操控": "Системы помощи",
    "硬件": "Камеры и парктроники",
    "功能": "Функции",
    "外观/防盗": "Экстерьер и доступ",
    "车外灯光": "Наружное освещение",
    "天窗/玻璃": "Стёкла и люк",
    "/玻璃": "Стёкла",
    "外后视镜": "Наружные зеркала",
    "方向盘/内后视镜": "Рулевое колесо и внутреннее зеркало заднего вида",
    "互联/智能化": "Мультимедиа и связь",
    "车内充电": "Зарядка в салоне",
    "座椅配置": "Сиденья",
    "音响/车内灯光": "Аудио и свет в салоне",
    "空调/冰箱": "Климат-контроль",
    "车内": "Комfort в салоне",
}

# Точные пары (название, значение) → (подпись, значение на русском)
_ITEM_PAIR_ZH: dict[tuple[str, str], tuple[str, str]] = {
    ("方向盘", "皮质"): ("Материал руля", "Кожа"),
    ("方向盘", "真皮"): ("Материал руля", "Натуральная кожа"),
    ("方向盘", "塑料"): ("Материал руля", "Пластик"),
    ("方向盘", "仿皮"): ("Материал руля", "Экокожа"),
    ("方向盘", "PU"): ("Материал руля", "Экокожа (PU)"),
    ("方向盘位置", "手动"): ("Регулировка руля", "Ручная"),
    ("方向盘位置", "电动"): ("Регулировка руля", "Электрическая"),
    ("换挡形式", "挡把换挡"): ("Переключение передач", "Рычаг на тоннеле"),
    ("换挡形式", "电子挡把换挡"): ("Переключение передач", "Электронный рычаг"),
    ("换挡形式", "怀挡换挡"): ("Переключение передач", "Под рулём"),
    ("换挡形式", "按键换挡"): ("Переключение передач", "Кнопки"),
    ("内后视镜功能", "手动防眩目"): ("Внутреннее зеркало", "Ручной антиблик"),
    ("内后视镜功能", "自动防眩目"): ("Внутреннее зеркало", "Автоантиблик"),
    ("显示屏幕", "彩色"): ("Проекция на лобовое стекло", "Цветная"),
    ("显示屏幕", "单色"): ("Проекция на лобовое стекло", "Монохромная"),
    ("多功能方向盘", "●"): ("Многофункциональный руль", "●"),
    ("多功能方向盘", "○"): ("Многофункциональный руль", "○"),
    ("方向盘记忆", "●"): ("Память положения руля", "●"),
    ("方向盘加热", "●"): ("Подогрев руля", "●"),
    ("胎压监测功能", "胎压显示"): ("Контроль давления в шинах", "Индикация"),
    ("模式切换", "运动, 经济, /"): ("Режимы вождения", "Спорт, Эко"),
    ("巡航系统", "定速巡航"): ("Круиз-контроль", "Обычный"),
    ("巡航系统", "全速自适应巡航"): ("Круиз-контроль", "Адаптивный"),
    ("空调温度控制方式", "手动空调"): ("Климат-контроль", "Ручной"),
    ("空调温度控制方式", "自动空调"): ("Климат-контроль", "Автоматический"),
    (
        "外后视镜功能",
        "电动, 电动折叠, 后视镜, 锁车自动折叠",
    ): ("Наружные зеркала", "Электропривод, складывание, автоскладывание"),
    ("辅助", "倒车, 360度全景"): ("Камеры", "Задняя, круговой обзор 360°"),
    ("座椅", "皮/混搭"): ("Обивка сидений", "Кожа / комбинированная"),
    ("语音识别控制系统", "多媒体系统, 导航"): ("Голосовое управление", "Мультимедиа, навигация"),
    ("中控彩色屏幕", "触控液晶屏"): ("Экран мультимедиа", "Сенсорный LCD"),
    ("中控屏幕尺寸", "12.3英寸"): ("Диагональ экрана", "12,3″"),
    ("车载智能系统", "GKUI吉客智能生态系统"): ("Мультимедийная система", "GKUI"),
}

# Названия параметров (если нет точной пары)
_ITEM_NAME_ZH: dict[str, str] = {
    "多功能方向盘": "Многофункциональный руль",
    "方向盘记忆": "Память положения руля",
    "方向盘加热": "Подогрев руля",
    "内后视镜功能": "Внутреннее зеркало",
    "外后视镜功能": "Наружные зеркала",
    "中控彩色屏幕": "Экран мультимедиа",
    "中控屏幕尺寸": "Диагональ экрана",
    "语音识别控制系统": "Голосовое управление",
    "车载智能系统": "Мультимедийная система",
    "座椅": "Обивка сидений",
    "主座椅方式": "Регулировки водительского сиденья",
    "副座椅方式": "Регулировки пассажирского сиденья",
    "辅助": "Камеры и парктроники",
    "超声波雷达数量": "Задние парктроники",
    "数量": "Количество",
    "钥匙类型": "Тип ключа",
    "地图品牌": "Картография",
}

_VALUE_ZH: dict[str, str] = {
    "皮质": "Кожа",
    "真皮": "Натуральная кожа",
    "塑料": "Пластик",
    "仿皮": "Экокожа",
    "手动": "Ручная",
    "电动": "Электрическая",
    "手动防眩目": "Ручной антиблик",
    "自动防眩目": "Автоантиблик",
    "挡把换挡": "Рычаг на тоннеле",
    "彩色": "Цветная",
    "触控液晶屏": "Сенсорный LCD",
    "4G": "4G",
    "纵置": "Продольное",
    "横置": "Поперечное",
    "三厢车": "Седан",
    "汽油": "Бензин",
}

_LABEL_FIXES: list[tuple[re.Pattern[str], str]] = [
    (re.compile(r"\bсистема\s+система\b", re.I), "система"),
    (re.compile(r"^аппаратное\s+обеспечение$", re.I), "Камеры и парктроники"),
    (re.compile(r"^рулевое\s+колесо\s*/\s*внутреннее\s+зеркало", re.I),
     "Рулевое колесо и внутреннее зеркало заднего вида"),
]

_TEXT_VALUE_FIXES: list[tuple[re.Pattern[str], str]] = [
    (re.compile(r"\bэкономика\b", re.I), "Эко"),
    (re.compile(r"\bкора\s+головного\s+мозга\b", re.I), "Кожа"),
    (re.compile(r"^руководство$", re.I), "Ручная"),
    (re.compile(r"^график\s+смен$", re.I), "Переключение передач"),
]


def normalize_spec_heading(text: str | None) -> str:
    if not text:
        return ""
    s = str(text).strip()
    s = _HEADING_SPECIALS_RE.sub(" ", s)
    s = re.sub(r"\s+", " ", s).strip(" -")
    if not s:
        return ""
    return s[0].upper() + s[1:] if len(s) > 1 else s.upper()


def classify_trim_value(raw: str | None) -> TrimStatus:
    s = str(raw or "").strip()
    if not s or s in _ABSENT_VALUES:
        return "absent"
    if s in _INCLUDED_MARKERS:
        return "included"
    if s in _OPTIONAL_MARKERS:
        return "optional"
    compact = re.sub(r"\s+", "", s)
    if compact in _ABSENT_VALUES or re.fullmatch(r"[-—－/\\|·]+", compact or ""):
        return "absent"
    has_inc = "●" in s or "•" in s or "■" in s
    has_opt = "○" in s or "◯" in s
    if has_inc and not has_opt:
        return "included"
    if has_opt and not has_inc:
        return "optional"
    if has_inc and has_opt:
        return "included"
    if re.fullmatch(r"[-—－/\s·]+", s):
        return "absent"
    return "text"


def fix_trim_label_ru(text: str) -> str:
    s = (text or "").strip()
    for pat, repl in _LABEL_FIXES:
        s = pat.sub(repl, s)
    return re.sub(r"\s+", " ", s).strip()


def translate_group_zh(group_zh: str) -> str | None:
    g = (group_zh or "").strip()
    if g in _GROUP_ZH:
        return normalize_spec_heading(_GROUP_ZH[g])
    if _HAS_CJK.search(g):
        return None
    return normalize_spec_heading(fix_trim_label_ru(g))


def _translate_value_zh(value_zh: str) -> str | None:
    v = (value_zh or "").strip()
    if classify_trim_value(v) != "text":
        return v
    if v in _VALUE_ZH:
        return _VALUE_ZH[v]
    if _HAS_CJK.search(v):
        return None
    return _clean_trim_text_value(v)


def translate_item_zh(name_zh: str, value_zh: str) -> tuple[str, str] | None:
    name = (name_zh or "").strip()
    value = (value_zh or "").strip()
    pair = _ITEM_PAIR_ZH.get((name, value))
    if pair:
        return pair
    if name in _ITEM_NAME_ZH:
        label = _ITEM_NAME_ZH[name]
    elif _HAS_CJK.search(name):
        return None
    else:
        label = fix_trim_label_ru(name)
    label = normalize_spec_heading(label)
    if classify_trim_value(value) != "text":
        return label, value
    val = _translate_value_zh(value)
    if val is None:
        return None
    return label, val


def _clean_trim_text_value(raw: str) -> str:
    s = str(raw or "").strip()
    s = re.sub(r"[/\\|]+$", "", s)
    s = re.sub(r"\s*,\s*/\s*$", "", s)
    s = re.sub(r"\s+", " ", s).strip(" ,/\\|")
    for pat, repl in _TEXT_VALUE_FIXES:
        s = pat.sub(repl, s)
    return s


def _format_param_value(name_zh: str, value: str) -> str:
    v = _clean_trim_text_value(value)
    if _HAS_CJK.search(v):
        for zh, ru in _VALUE_ZH.items():
            if zh in v:
                v = v.replace(zh, ru)
        v = re.sub(r"(\d+)门", r"\1 дв., ", v)
        v = re.sub(r"(\d+)座", r"\1 мест, ", v)
        v = re.sub(r"\s+", " ", v).strip(" ,")
    if name_zh in ("发动机",) or "发动机" in name_zh:
        v = v.replace("马力", " л.с.")
    if _DIMS_RE.search(name_zh) or name_zh.startswith("长"):
        parts = re.split(r"[*×xX]", v)
        nums = [p.strip() for p in parts if re.fullmatch(r"\d+", p.strip())]
        if len(nums) == 3:
            return f"{nums[0]} × {nums[1]} × {nums[2]} мм"
    if name_zh == "(mL)" and v.isdigit():
        return f"{v} см³"
    if name_zh in ("(kg)", "满载(kg)") and v.isdigit():
        return f"{v} кг"
    if name_zh.endswith("(mm)") or name_zh in ("(mm)", "（mm）"):
        if v.isdigit():
            return f"{v} мм"
    if name_zh == "马力(Ps)" and v.isdigit():
        return f"{v} л.с."
    if name_zh == "能源类型":
        return _VALUE_ZH.get(v, v)
    if name_zh == "车身结构" and _HAS_CJK.search(v):
        return v
    return v


def _translate_param_item(
    group_zh: str,
    name_zh: str,
    value_zh: str,
    *,
    body_mm_idx: list[int],
) -> tuple[str, str] | None:
    name = (name_zh or "").strip()
    value = (value_zh or "").strip()
    if not name or classify_trim_value(value) == "absent":
        return None
    if name in _PARAM_SKIP_ITEM_ZH:
        return None
    if _PARAM_NOISE_NAME_RE.match(name.replace(" ", "")):
        return None
    label: str | None = None
    if name in _PARAM_ITEM_ZH:
        label = _PARAM_ITEM_ZH[name]
    elif _DIMS_RE.search(name):
        label = "Габариты"
    elif group_zh == "车身" and name in ("(mm)", "（mm）"):
        idx = body_mm_idx[0]
        body_mm_idx[0] += 1
        if idx < len(_BODY_MM_LABELS):
            label = f"{_BODY_MM_LABELS[idx]}, мм"
    elif group_zh == "发动机" and name in ("(kW)", "（kW）", "(N·m)", "（N·m）", "(rpm)", "（rpm）"):
        return None
    elif _HAS_CJK.search(name):
        return None
    else:
        label = normalize_spec_heading(fix_trim_label_ru(name))
    if not label:
        return None
    val = _format_param_value(name, value)
    if not val or classify_trim_value(val) == "absent":
        return None
    return label, val


def prepare_param_specs_from_zh(sections: list[dict[str, Any]]) -> list[dict[str, str]]:
    """Двигатель и габариты для блока «Характеристики» (без шумных param-групп)."""
    out: list[dict[str, str]] = []
    seen: set[str] = set()

    def add(label: str, val: str) -> None:
        key = label.casefold()
        if key in seen:
            return
        seen.add(key)
        out.append({"name": label, "value": val})

    for sec in sections:
        if not isinstance(sec, dict):
            continue
        group_zh = str(sec.get("group") or "")
        if group_zh not in _PARAM_UI_GROUP_ZH:
            continue
        body_mm_idx = [0]
        for it in sec.get("items") or []:
            if not isinstance(it, dict):
                continue
            row = _translate_param_item(
                group_zh,
                str(it.get("name") or ""),
                str(it.get("value") or ""),
                body_mm_idx=body_mm_idx,
            )
            if row:
                add(*row)
    return out


def _finalize_param_sections(sections: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Убрать дубли: отдельные L/W/H если есть «Габариты», короткий «Кузов»."""
    flat: dict[str, str] = {}
    for sec in sections:
        for it in sec.get("items") or []:
            name = str(it.get("name") or "")
            val = str(it.get("value") or "")
            if not name or not val:
                continue
            prev = flat.get(name)
            if prev is None or len(val) > len(prev):
                flat[name] = val
    if "Габариты" in flat:
        for label in _DIM_LABELS:
            flat.pop(label, None)
    if "Кузов" in flat:
        # Оставляем более информативное описание кузова.
        best = flat["Кузов"]
        for sec in sections:
            for it in sec.get("items") or []:
                if it.get("name") == "Кузов" and len(str(it.get("value") or "")) > len(best):
                    best = str(it["value"])
        flat["Кузов"] = best
    order: list[str] = []
    for sec in sections:
        for it in sec.get("items") or []:
            name = str(it.get("name") or "")
            if name in flat and name not in order:
                order.append(name)
    if not order:
        return []
    items = [{"name": name, "value": flat[name]} for name in order]
    return [{"group": "Технические параметры", "items": items}]


def filter_param_sections_for_card(sections: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Убрать лишние param-поля из блока «Характеристики» на карточке."""
    out: list[dict[str, Any]] = []
    for sec in sections:
        if not isinstance(sec, dict):
            continue
        items = [
            it
            for it in sec.get("items") or []
            if isinstance(it, dict) and str(it.get("name") or "") not in _PARAM_CARD_SKIP_LABELS
        ]
        if items:
            out.append({"group": str(sec.get("group") or ""), "items": items})
    return out


def prepare_param_sections_from_zh(sections: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Секции param (двигатель, габариты) с переводом заголовков."""
    raw: list[dict[str, Any]] = []
    for sec in sections:
        if not isinstance(sec, dict):
            continue
        group_zh = str(sec.get("group") or "")
        if group_zh not in _PARAM_UI_GROUP_ZH:
            continue
        body_mm_idx = [0]
        items: list[dict[str, str]] = []
        for it in sec.get("items") or []:
            if not isinstance(it, dict):
                continue
            row = _translate_param_item(
                group_zh,
                str(it.get("name") or ""),
                str(it.get("value") or ""),
                body_mm_idx=body_mm_idx,
            )
            if row:
                items.append({"name": row[0], "value": row[1]})
        if items:
            raw.append({"group": group_zh, "items": items})
    compact = _finalize_param_sections(raw)
    return compact if compact else raw


def _is_param_group(group: str, kind: str | None, *, group_zh: str = "") -> bool:
    if kind == "param":
        return True
    if kind == "config":
        return False
    if group_zh and _PARAM_GROUP_ZH_RE.search(group_zh):
        return True
    return bool(_PARAM_GROUP_RU_RE.search(group or ""))


def format_trim_item_for_ui(name: str, raw_value: str) -> dict[str, str] | None:
    label = fix_trim_label_ru(name)
    label = normalize_spec_heading(label)
    if not label:
        return None
    status = classify_trim_value(raw_value)
    if status == "absent":
        return None
    if status == "included":
        return {"name": label, "value": "●"}
    if status == "optional":
        return {"name": label, "value": "○"}
    text = _clean_trim_text_value(raw_value)
    if not text or classify_trim_value(text) == "absent":
        return None
    if len(text) > 120:
        text = text[:117].rstrip() + "…"
    return {"name": label, "value": text}


def prepare_trim_sections_from_zh(sections: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Комплектация для попапа: основное + опции по категориям."""
    from .trim_config_ui import prepare_config_sections_from_zh

    return prepare_config_sections_from_zh(sections)


def filter_trim_sections_for_ui(sections: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Fallback: уже переведённые секции (spec_json_ru) + правки типичных ошибок."""
    out: list[dict[str, Any]] = []
    for sec in sections:
        if not isinstance(sec, dict):
            continue
        group = fix_trim_label_ru(str(sec.get("group") or ""))
        group = normalize_spec_heading(group)
        if not group:
            continue
        kind = sec.get("kind") if isinstance(sec.get("kind"), str) else None
        if _is_param_group(group, kind):
            continue
        items: list[dict[str, str]] = []
        for it in sec.get("items") or []:
            if not isinstance(it, dict):
                continue
            name = normalize_spec_heading(fix_trim_label_ru(str(it.get("name") or "")))
            val = _clean_trim_text_value(str(it.get("value") or ""))
            row = format_trim_item_for_ui(name, val)
            if row:
                items.append(row)
        if items:
            out.append({"group": group, "items": items})
    return out
