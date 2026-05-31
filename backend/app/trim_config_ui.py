"""Комплектация (config) для попапа: разбор обфусцированных полей Autohome, группы как на auto.ru."""

from __future__ import annotations

import re
from functools import lru_cache
from typing import Any

from .trim_display import (
    _ABSENT_VALUES,
    _HAS_CJK,
    classify_trim_value,
    fix_trim_label_ru,
    normalize_spec_heading,
)
from .trim_spec_storage import infer_section_kind

# Объединение групп Autohome → категории для UI
_CONFIG_GROUP_MERGE: dict[str, str] = {
    "被动安全": "Безопасность",
    "安全": "Безопасность",
    "车外灯光": "Обзор",
    "/玻璃": "Обзор",
    "天窗/玻璃": "Обзор",
    "外观/防盗": "Защита от угона",
    "互联/智能化": "Мультимедиа",
    "音响/车内灯光": "Мультимedia",
    "车内": "Мультимедиа",
    "操控": "Комфорт",
    "功能": "Системы помощи",
    "硬件": "Системы помощи",
    "外后视镜": "Комфорт",
    "方向盘/内后视镜": "Салон",
    "座椅配置": "Салон",
    "空调/冰箱": "Комфорт",
}

# Исправление опечатки
_CONFIG_GROUP_MERGE["音响/车内灯光"] = "Мультимедиа"

# Param-группы для блока «Основное» в начале попапа
_OVERVIEW_PARAM_GROUPS = frozenset({"基本参数", "变速箱", "底盘转向"})

_OVERVIEW_ITEM_ZH: dict[str, str] = {
    "变速箱": "Коробка передач",
    "简称": "Коробка передач",
    "挡位个数": "Количество передач",
    "变速箱类型": "Тип КПП",
    "驱动方式": "Привод",
    "发动机": "Двигатель",
    "能源类型": "Топливо",
    "车身结构": "Кузов",
}

# Название опции (обфусцированное или полное) → русская подпись
_CONFIG_NAME_ZH: dict[str, str] = {
    "主/副座安全": "Подушки безопасности",
    "/侧": "Боковые подушки безопасности",
    "/头部(气帘)": "Подушки безопасности оконные (шторки)",
    "被动行人保护": "Защита пешеходов",
    "缺气保用轮胎": "Шины runflat",
    "ABS防抱死": "Антиблокировочная система (ABS)",
    "(EBD/CBC等)": "Система распределения тормозных усилий (EBD/CBC)",
    "刹车辅助(EBA/BAS/BA等)": "Система помощи при торможении (BAS/EBA)",
    "(ASR/TCS/TRC等)": "Антипробуксовочная система (ASR/TCS)",
    "车身控制(ESC/ESP/DSC等)": "Система стабилизации (ESP/ESC)",
    "胎压监测功能": "Контроль давления в шинах",
    "安全带未系提醒": "Напоминание о ремне безопасности",
    "ISOFIX": "Крепление ISOFIX для детского кресла",
    "车道偏离系统": "Система предупреждения о смене полосы",
    "刹车/安全系统": "Система экстренного торможения",
    "疲劳提示": "Контроль усталости водителя",
    "方碰撞": "Предупреждение о фронтальном столкновении",
    "道路救援呼叫": "ЭРА-ГЛОНАСС / вызов экстренных служб",
    "模式切换": "Режимы вождения",
    "发动机启停技术": "Система «старт-стоп»",
    "自动": "Автоматический стояночный тормоз",
    "上坡辅助": "Помощь при трогании в гору (HSA)",
    "/后雷达": "Парктроники",
    "方感知": "Камеры / датчики",
    "超声波雷达数量": "Ультразвуковые датчики",
    "巡航系统": "Круиз-контроль",
    "辅助等级": "Уровень ADAS",
    "倒车车侧系统": "Контроль слепых зон при движении задним ходом",
    "卫星导航系统": "Спутниковая навигация",
    "导航路况信息显示": "Отображение пробок на карте",
    "车道保持辅助系统": "Удержание в полосе",
    "车道居中保持": "Удержание по центру полосы",
    "道路交通标识识别": "Распознавание дорожных знаков",
    "辅助泊车入位": "Автоматическая парковка",
    "循迹倒车": "Парковка по траектории",
    "辅助变道": "Помощь при смене полосы",
    "外观套件": "Спортивный / декоративный пакет",
    "轮圈": "Диски",
    "电动后备厢": "Электропривод крышки багажника",
    "感应后备厢": "Бесключевое открытие багажника",
    "发动机防盗": "Иммобилайзер",
    "车内中控锁": "Центральный замок",
    "钥匙类型": "Тип ключа",
    "启动系统": "Бесключевой запуск",
    "进入功能": "Бесключевой доступ",
    "闭合式格栅": "Активные жалюзи радиатора",
    "远程启动功能": "Дистанционный запуск",
    "光源": "Фары",
    "LED日间行车灯": "Дневные ходовые огни",
    "自应远近光": "Адаптивный дальний свет",
    "自动头灯": "Автоматический включение фар",
    "车雾灯": "Противотуманные фары",
    "大灯可调": "Регулировка фар",
    "大灯延时关闭": "Задержка выключения фар",
    "类型": "Люк / остекление",
    "/后电动车窗": "Электростеклоподъёмники",
    "车窗一键降功能": "Однокасательное опускание стёкол",
    "车窗防夹手功能": "Защита от защемления",
    "车内化妆镜": "Зеркала в солнцезащитных козырьках",
    "后雨刷": "Задний стеклоочиститель",
    "感应雨刷功能": "Датчик дождя",
    "外后视镜功能": "Наружные зеркала",
    "中控彩色屏幕": "Экран мультимедиа",
    "中控屏幕尺寸": "Диагональ экрана",
    "/车载": "CarPlay / Android Auto",
    "手机互联/映射": "Подключение смартфона",
    "语音识别控制系统": "Голосовое управление",
    "车载智能系统": "Мультимедийная система",
    "车联网": "Подключение к интернету",
    "4G/5G网络": "Мобильная связь",
    "OTA级": "Обновление ПО по воздуху (OTA)",
    "Wi-Fi热点": "Wi‑Fi‑точка доступа",
    "手机APP远程功能": "Управление через приложение",
    "方向盘": "Материал руля",
    "方向盘位置": "Регулировка руля",
    "换挡形式": "Переключение передач",
    "多功能方向盘": "Многофункциональный руль",
    "方向盘换挡拨片": "Подрулевые лепестки",
    "方向盘记忆": "Память положения руля",
    "显示屏幕": "Проекция на лобовое стекло (HUD)",
    "液晶仪表尺寸": "Цифровая приборная панель",
    "HUD抬头数字显示": "Проекционный дисплей (HUD)",
    "内后视镜功能": "Внутреннее зеркало",
    "ETC装置": "Транспonder ETC",
    "多媒体/": "Разъёмы USB / Type‑C",
    "USB/Type-C数量": "Количество USB / Type‑C",
    "手机无线功能": "Беспроводная зарядка",
    "座椅": "Обивка сидений",
    "主座椅方式": "Регулировки сиденья водителя",
    "副座椅方式": "Регулировки сиденья пассажира",
    "主/副座电动": "Электрорегулировка сидений",
    "/后扶手": "Подлокотники",
    "排座椅功能": "Функции задних сидений",
    "电动座椅记忆功能": "Память положения сидений",
    "副位可按钮": "Регулировка сиденья с заднего ряда",
    "第二排座椅": "Второй ряд сидений",
    "座椅形式": "Форма сидений",
    "杯架": "Подстаканники",
    "品牌名称": "Аудиосистема",
    "车内环境氛围灯": "Подсветка салона",
    "空调温度控制方式": "Климат-контроль",
    "空调": "Кондиционер",
    "后座出口": "Дефлекторы для заднего ряда",
    "温度分区控制": "Многозонный климат-контроль",
    "车载净化器": "Очиститель воздуха",
    "车内PM2.5过滤装置": "Фильтр PM2.5",
}

# Подпись зависит от группы Autohome (одно и то же имя поля — разный смысл)
_CONFIG_GROUP_ITEM_ZH: dict[tuple[str, str], str] = {
    ("硬件", "数量"): "Количество камер",
    ("硬件", "辅助"): "Камеры",
    ("功能", "辅助"): "Расширенная помощь водителю",
    ("音响/车内灯光", "数量"): "Количество динамиков",
    ("音响/车内灯光", "品牌名称"): "Аудиосистема",
    ("车内", "USB/Type-C数量"): "Количество USB / Type‑C",
    ("车内", "手机无线功能"): "Беспроводная зарядка",
}

# Точные значения (группа, имя, исходный текст) → русский текст
_VALUE_EXACT_ZH: dict[tuple[str, str, str], str] = {
    ("硬件", "辅助", "倒车, 360度全景"): "Задняя, круговой обзор 360°",
    ("车内", "USB/Type-C数量", "排2个/2个"): "2 спереди / 2 сзади",
    ("音响/车内灯光", "品牌名称", "Harman/Kardon哈曼卡顿"): "Harman/Kardon",
    ("/玻璃", "车内化妆镜", "主+照明灯, 副+照明灯"): "С подсветкой (водитель и пассажир)",
    ("互联/智能化", "中控屏幕尺寸", "14.9英寸"): "14,9″",
    ("互联/智能化", "语音识别控制系统", "多媒体系统, 导航, 空调, 车窗"): "Мультимедиа, навигация, климат, окна",
    (
        "互联/智能化",
        "手机APP远程功能",
        "控制, 车辆启动, 车灯控制, 空调控制, 车况查询/诊断, 车辆定位/寻车",
    ): "Управление, запуск, свет, климат, диагностика, поиск авто",
    ("互联/智能化", "手机无线功能", "排"): "Передний ряд",
    ("座椅配置", "座椅", "仿皮"): "Экокожа",
    ("音响/车内灯光", "车内环境氛围灯", "9色"): "9 цветов",
}

_POS_LABEL: dict[str, str] = {
    "主": "водителя",
    "副": "пассажира",
    "前": "передние",
    "后": "задние",
}

_VALUE_ZH: dict[str, str] = {
    "皮质": "Кожа",
    "真皮": "Натуральная кожа",
    "仿皮": "Экокожа",
    "手动": "Ручная",
    "电动": "Электрическая",
    "手动防眩目": "Ручной антиблик",
    "自动防眩目": "Автоантиблик",
    "挡把换挡": "Рычаг на тоннеле",
    "彩色": "Цветная",
    "触控液晶屏": "Сенсорный LCD",
    "汽油": "Бензин",
    "柴油": "Дизель",
    "手自一体": "Автомат",
    "胎压显示": "Индикация давления",
    "雨量感应式": "По датчику дождя",
    "可开启全景": "Панорамная крыша",
    "遥控钥匙": "Дистанционный ключ",
    "运动格": "M Sport",
    "全车": "Все двери",
    "定速巡航": "Обычный",
    "全速自应巡航": "Адаптивный (полный спектр скоростей)",
    "全速自适应巡航": "Адаптивный (полный спектр скоростей)",
    "支持CarPlay": "Apple CarPlay",
    "iDrive": "BMW iDrive",
    "4G": "4G",
    "5G": "5G",
    "自动空调": "Автоматический",
    "手动空调": "Ручной",
    "排": "Все ряды",
    "位": "Память водителя",
    "单目": "Одна камера",
    "三目": "Три камеры",
    "L2": "Уровень 2",
    "纵置": "Продольное",
    "横置": "Поперечное",
    "三厢车": "Седан",
}

_MARK_RE = re.compile(r"^([主副前后]?)\s*([●○]|—|-+|无)$")
_SLASH_PART = re.compile(r"\s*/\s*")


@lru_cache(maxsize=4096)
def _cached_translate(text: str) -> str:
    if not text or not _HAS_CJK.search(text):
        return text
    try:
        from .translator_ru import translate_to_ru

        return (translate_to_ru(text) or text).strip()
    except Exception:
        return text


def _translate_value_text(raw: str, *, group_zh: str = "", name_zh: str = "") -> str:
    s = str(raw or "").strip()
    if not s or s in _ABSENT_VALUES:
        return ""
    exact = _VALUE_EXACT_ZH.get((group_zh.strip(), name_zh.strip(), s))
    if exact:
        return exact
    if classify_trim_value(s) in ("included", "optional"):
        return s
    if s in _VALUE_ZH:
        return _VALUE_ZH[s]
    usb_rows = re.fullmatch(r"排(\d+)个/(\d+)个", s)
    if usb_rows:
        return f"{usb_rows.group(1)} спереди / {usb_rows.group(2)} сзади"
    inch = re.fullmatch(r"([\d.]+)英寸", s)
    if inch:
        return f"{inch.group(1).replace('.', ',')}″"
    if "Harman" in s or "哈曼卡顿" in s:
        return "Harman/Kardon"
    if "倒车" in s and "360" in s:
        return "Задняя, круговой обзор 360°"
    if "照明灯" in s and "主" in s:
        return "С подсветкой (водитель и пассажир)"
    parts = [p.strip() for p in re.split(r"[,，、/]", s) if p.strip()]
    out: list[str] = []
    for p in parts:
        if p in _VALUE_ZH:
            out.append(_VALUE_ZH[p])
        elif re.fullmatch(r"\d+个", p):
            out.append(p.replace("个", ""))
        elif _HAS_CJK.search(p):
            tr = _cached_translate(p)
            out.append(tr if tr else p)
        else:
            out.append(p)
    return ", ".join(dict.fromkeys(out)) if out else s


def _label_for_name(name_zh: str, group_zh: str = "") -> str:
    n = (name_zh or "").strip()
    g = (group_zh or "").strip()
    group_label = _CONFIG_GROUP_ITEM_ZH.get((g, n))
    if group_label:
        return group_label
    if n in _CONFIG_NAME_ZH:
        return _CONFIG_NAME_ZH[n]
    if _HAS_CJK.search(n):
        tr = _cached_translate(n)
        if tr and tr != n:
            return normalize_spec_heading(fix_trim_label_ru(tr))
    return normalize_spec_heading(fix_trim_label_ru(n)) if n else ""


def _marker_char(raw: str) -> str | None:
    s = str(raw or "").strip()
    if s in ("●", "•", "■", "标配"):
        return "●"
    if s in ("○", "◯", "选装", "选配"):
        return "○"
    if s in _ABSENT_VALUES or s in ("-", "后-"):
        return None
    return None


def _expand_slash_markers(base_label: str, value_zh: str) -> list[dict[str, str]]:
    parts = _SLASH_PART.split(str(value_zh or "").strip())
    if len(parts) < 2:
        return []
    rows: list[dict[str, str]] = []
    for part in parts:
        m = _MARK_RE.match(part.strip())
        if not m:
            continue
        pos, mark = m.group(1), m.group(2)
        marker = _marker_char(mark)
        if not marker:
            continue
        label = base_label
        if pos and pos in _POS_LABEL:
            if "подуш" in base_label.lower() or "Подуш" in base_label:
                label = f"{base_label} ({_POS_LABEL[pos]})"
            else:
                label = f"{base_label}, {_POS_LABEL[pos]}"
        rows.append({"name": label, "value": marker})
    return rows


def _parse_config_item(group_zh: str, name_zh: str, value_zh: str) -> list[dict[str, str]]:
    name = (name_zh or "").strip()
    value = (value_zh or "").strip()
    if not name:
        return []

    base = _label_for_name(name, group_zh)
    if not base:
        return []

    if "/" in value and ("●" in value or "○" in value or "—" in value or "-" in value):
        expanded = _expand_slash_markers(base, value)
        if expanded:
            return expanded

    status = classify_trim_value(value)
    if status in ("included", "optional"):
        return [{"name": base, "value": "●" if status == "included" else "○"}]

    text = _translate_value_text(value, group_zh=group_zh, name_zh=name)
    if not text:
        return []

    # Несколько подфункций через запятую — одной строкой (как на auto.ru для сложных опций)
    if status == "text" and ("," in value or "，" in value) and "●" not in value:
        return [{"name": base, "value": text}]

    if status == "text":
        return [{"name": base, "value": text}]

    return []


def _parse_overview_item(name_zh: str, value_zh: str) -> dict[str, str] | None:
    name = (name_zh or "").strip()
    value = (value_zh or "").strip()
    if not name or classify_trim_value(value) == "absent":
        return None
    label = _OVERVIEW_ITEM_ZH.get(name)
    if not label:
        return None
    if name == "挡位个数" and value.isdigit():
        return {"name": label, "value": value}
    if name == "发动机":
        v = value.replace("马力", " л.с.")
        return {"name": label, "value": v}
    text = _translate_value_text(value, name_zh=name)
    if not text:
        return None
    return {"name": label, "value": text}


def _overview_section(sections: list[dict[str, Any]]) -> list[dict[str, Any]]:
    items: list[dict[str, str]] = []
    seen: set[str] = set()

    def add(row: dict[str, str] | None) -> None:
        if not row:
            return
        key = row["name"].casefold()
        if key in seen:
            return
        seen.add(key)
        items.append(row)

    for sec in sections:
        if not isinstance(sec, dict):
            continue
        group_zh = str(sec.get("group") or "")
        if group_zh not in _OVERVIEW_PARAM_GROUPS:
            continue
        for it in sec.get("items") or []:
            if not isinstance(it, dict):
                continue
            add(_parse_overview_item(str(it.get("name") or ""), str(it.get("value") or "")))

    if not items:
        return []
    return [{"group": "Основное", "items": items}]


def is_prepared_config_sections(data: Any) -> bool:
    if not isinstance(data, list) or not data:
        return False
    groups = {str(row.get("group") or "") for row in data if isinstance(row, dict)}
    if "Основное" not in groups:
        return False
    total = sum(len(row.get("items") or []) for row in data if isinstance(row, dict))
    return total >= 30


def prepare_config_sections_from_zh(sections: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Полная комплектация для попапа: основное + категории опций."""
    merged: dict[str, list[dict[str, str]]] = {}
    seen_rows: set[tuple[str, str]] = set()

    for sec in sections:
        if not isinstance(sec, dict):
            continue
        if infer_section_kind(sec) != "config":
            continue
        group_zh = str(sec.get("group") or "")
        group_ru = _CONFIG_GROUP_MERGE.get(group_zh)
        if not group_ru:
            tr = _cached_translate(group_zh) if _HAS_CJK.search(group_zh) else group_zh
            group_ru = normalize_spec_heading(fix_trim_label_ru(tr or group_zh))
        for it in sec.get("items") or []:
            if not isinstance(it, dict):
                continue
            for row in _parse_config_item(
                group_zh,
                str(it.get("name") or ""),
                str(it.get("value") or ""),
            ):
                key = (group_ru.casefold(), row["name"].casefold(), row["value"])
                if key in seen_rows:
                    continue
                seen_rows.add(key)
                merged.setdefault(group_ru, []).append(row)

    out = _overview_section(sections)
    order = [
        "Основное",
        "Безопасность",
        "Обзор",
        "Защита от угона",
        "Мультимедиа",
        "Системы помощи",
        "Комфорт",
        "Салон",
    ]
    order_idx = {g: i for i, g in enumerate(order)}
    for group_ru, items in merged.items():
        if items:
            out.append({"group": group_ru, "items": items})
    out.sort(key=lambda s: order_idx.get(s["group"], 100))
    return out
