"""
Сопоставление candidate/plan-item с CarBrand/CarModel каталога.

Sourcing по series_urls не даёт model_id из whitelist — нужно вывести марку/модель
из path che168 и/или текста карточки (title / series_raw).
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from urllib.parse import urlparse

from sqlalchemy import func, select
from sqlalchemy.orm import Session, joinedload

from .model_resolver import resolve_model_id_for_listing
from .models import CarBrand, CarModel

# Path-сегменты che168: /china/{brand_slug}/{model_slug}/…
CHE168_BRAND_SLUGS: dict[str, str] = {
    "aodi": "Audi",
    "baoma": "BMW",
    "benchi": "Mercedes-Benz",
    "fengtian": "Toyota",
    "richan": "Nissan",
    "jiliqiche": "Geely",
    "jili": "Geely",
    "changan": "Changan",
    "qirui": "Chery",
    "hafu": "Haval",
    "lingke": "Lynk & Co",
    "qiya": "Kia",
    "xiandai": "Hyundai",
    "bentian": "Honda",
    "bieke": "Buick",
    "dazhong": "Volkswagen",
    "luhu": "Land Rover",
    "baoshijie": "Porsche",
    "lakesasi": "Lexus",
    "woerwo": "Volvo",
    "biede": "BYD",
    "weilai": "NIO",
    "lixiang": "Li Auto",
    "xiaopeng": "XPeng",
    "tesila": "Tesla",
}

# Точные model slug → (brand_en, model_en) для известных series URL
CHE168_MODEL_SLUGS: dict[str, tuple[str, str]] = {
    "aodiq3": ("Audi", "Q3"),
    "aodia3": ("Audi", "A3"),
    "aodiq2l": ("Audi", "Q2"),
    "aodia4": ("Audi", "A4"),
    "aodia6": ("Audi", "A6"),
    "aodiq5": ("Audi", "Q5"),
    "baoma3xi": ("BMW", "3 Series"),
    "baoma5xi": ("BMW", "5 Series"),
    "baomax1": ("BMW", "X1"),
    "baomax3": ("BMW", "X3"),
    "kaluola": ("Toyota", "Corolla"),
    "kaimeirui": ("Toyota", "Camry"),
    "rav4rongfang": ("Toyota", "RAV4"),
    "benchicji": ("Mercedes-Benz", "C"),
    "benchiaji": ("Mercedes-Benz", "A"),
    "benchieji": ("Mercedes-Benz", "E"),
    "benchiclajinkou": ("Mercedes-Benz", "CLA"),
    "benchigla": ("Mercedes-Benz", "GLA"),
    "benchiglb": ("Mercedes-Benz", "GLB"),
    "benchiglc": ("Mercedes-Benz", "GLC"),
}

# Китайские названия марок в title
CN_BRAND_ALIASES: list[tuple[str, str]] = [
    ("梅赛德斯-奔驰", "Mercedes-Benz"),
    ("梅赛德斯奔驰", "Mercedes-Benz"),
    ("奔驰", "Mercedes-Benz"),
    ("宝马", "BMW"),
    ("奥迪", "Audi"),
    ("丰田", "Toyota"),
    ("本田", "Honda"),
    ("日产", "Nissan"),
    ("大众", "Volkswagen"),
    ("吉利", "Geely"),
    ("长安", "Changan"),
    ("奇瑞", "Chery"),
    ("哈弗", "Haval"),
    ("领克", "Lynk & Co"),
    ("起亚", "Kia"),
    ("现代", "Hyundai"),
    ("比亚迪", "BYD"),
    ("理想", "Li Auto"),
    ("蔚来", "NIO"),
    ("小鹏", "XPeng"),
    ("特斯拉", "Tesla"),
    ("保时捷", "Porsche"),
    ("路虎", "Land Rover"),
    ("雷克萨斯", "Lexus"),
    ("沃尔沃", "Volvo"),
]

# Китайские названия моделей → (optional brand, model catalog name)
CN_MODEL_ALIASES: list[tuple[str, str | None, str]] = [
    ("卡罗拉", "Toyota", "Corolla"),
    ("凯美瑞", "Toyota", "Camry"),
    ("奕跑", "Kia", "Pegas"),
    ("轩逸", "Nissan", "Sylphy"),
    ("天籁", "Nissan", "Teana"),
    ("奇骏", "Nissan", "X-Trail"),
    ("逍客", "Nissan", "Qashqai"),
    ("博越", "Geely", "Boyue"),
    ("星越", "Geely", "Monjaro"),
    ("缤越", "Geely", "Coolray"),
    ("哈弗H6", "Haval", "H6"),
    ("哈弗大狗", "Haval", "Big Dog"),
]


@dataclass
class CatalogRef:
    brand_id: int | None = None
    brand_name: str = ""
    model_id: int | None = None
    model_name: str = ""

    @property
    def ok(self) -> bool:
        return self.model_id is not None and self.brand_id is not None


def series_path_slugs(url: str) -> tuple[str | None, str | None]:
    """Из series URL: (brand_slug, model_slug). model_slug может быть None."""
    raw = (url or "").strip()
    if not raw:
        return None, None
    try:
        path = (urlparse(raw).path or "").lower()
    except Exception:
        path = raw.lower()
    parts = [p for p in path.split("/") if p]
    if not parts:
        return None, None
    # /china/aodi/aodiq3/... или /aodi/aodiq3/...
    if parts[0] == "china" and len(parts) >= 2:
        brand = parts[1]
        model = parts[2] if len(parts) >= 3 else None
    else:
        brand = parts[0]
        model = parts[1] if len(parts) >= 2 else None
    # Фильтры che168 вида a3_5msdg… / s53586-… — не model slug
    if model and ("msdg" in model or re.match(r"^s\d", model)):
        model = None
    if brand and ("msdg" in brand or re.match(r"^s\d", brand)):
        return None, None
    return brand or None, model or None


def _find_brand(db: Session, name: str) -> CarBrand | None:
    n = (name or "").strip()
    if not n:
        return None
    row = db.execute(select(CarBrand).where(func.lower(CarBrand.name) == n.lower())).scalar_one_or_none()
    if row:
        return row
    # soft: startswith for "Lynk & Co"
    return (
        db.execute(
            select(CarBrand)
            .where(func.lower(CarBrand.name).like(f"{n.lower()}%"))
            .order_by(func.length(CarBrand.name))
            .limit(1)
        ).scalar_one_or_none()
    )


def _find_model(db: Session, brand_id: int, name: str) -> CarModel | None:
    n = (name or "").strip()
    if not n:
        return None
    row = (
        db.execute(
            select(CarModel).where(
                CarModel.brand_id == brand_id,
                func.lower(CarModel.name) == n.lower(),
            )
        ).scalar_one_or_none()
    )
    if row:
        return row
    # Q2L → Q2, A3L → A3
    base = re.sub(r"l$", "", n, flags=re.I)
    if base != n:
        row = (
            db.execute(
                select(CarModel).where(
                    CarModel.brand_id == brand_id,
                    func.lower(CarModel.name) == base.lower(),
                )
            ).scalar_one_or_none()
        )
        if row:
            return row
    models = (
        db.execute(
            select(CarModel)
            .where(CarModel.brand_id == brand_id)
            .order_by(func.length(CarModel.name).desc(), CarModel.name)
        )
        .scalars()
        .all()
    )
    hay = n.lower()
    for m in models:
        mn = (m.name or "").strip()
        if not mn:
            continue
        mnl = mn.lower()
        if mnl == hay or hay == mnl:
            return m
        if len(mn) >= 2 and (mnl in hay or hay in mnl):
            return m
    return None


def resolve_from_series_url(db: Session, series_url: str) -> CatalogRef:
    brand_slug, model_slug = series_path_slugs(series_url)
    ref = CatalogRef()
    if model_slug and model_slug in CHE168_MODEL_SLUGS:
        bname, mname = CHE168_MODEL_SLUGS[model_slug]
        brand = _find_brand(db, bname)
        if brand:
            ref.brand_id = brand.id
            ref.brand_name = brand.name
            model = _find_model(db, brand.id, mname)
            if model:
                ref.model_id = model.id
                ref.model_name = model.name
                return ref
    if brand_slug and brand_slug in CHE168_BRAND_SLUGS:
        brand = _find_brand(db, CHE168_BRAND_SLUGS[brand_slug])
        if brand:
            ref.brand_id = brand.id
            ref.brand_name = brand.name
            if model_slug:
                # aodiq3 → try strip brand prefix
                guess = model_slug
                if guess.startswith(brand_slug):
                    guess = guess[len(brand_slug) :]
                guess = guess.strip("-_") or model_slug
                # baoma3xi already handled; try raw slug as model
                model = _find_model(db, brand.id, guess) or _find_model(db, brand.id, model_slug)
                if model:
                    ref.model_id = model.id
                    ref.model_name = model.name
    return ref


def resolve_from_text(
    db: Session,
    *,
    title: str | None = None,
    series_raw: str | None = None,
    brand_hint: str | None = None,
) -> CatalogRef:
    haystack = " ".join(p for p in [title or "", series_raw or ""] if p).strip()
    ref = CatalogRef()
    if not haystack and not brand_hint:
        return ref

    brand_name = (brand_hint or "").strip()
    if not brand_name:
        for cn, en in sorted(CN_BRAND_ALIASES, key=lambda x: len(x[0]), reverse=True):
            if cn in haystack:
                brand_name = en
                break
    if not brand_name:
        # EN brand mention
        brands = db.execute(select(CarBrand).order_by(func.length(CarBrand.name).desc())).scalars().all()
        hl = haystack.lower()
        for b in brands:
            bn = (b.name or "").strip()
            if len(bn) >= 3 and bn.lower() in hl:
                brand_name = bn
                break

    for cn, preferred_brand, model_en in sorted(CN_MODEL_ALIASES, key=lambda x: len(x[0]), reverse=True):
        if cn not in haystack:
            continue
        use_brand = preferred_brand or brand_name
        if not use_brand:
            continue
        brand = _find_brand(db, use_brand)
        if not brand:
            continue
        model = _find_model(db, brand.id, model_en)
        if model:
            return CatalogRef(
                brand_id=brand.id,
                brand_name=brand.name,
                model_id=model.id,
                model_name=model.name,
            )

    if not brand_name:
        return ref
    brand = _find_brand(db, brand_name)
    if not brand:
        return ref
    ref.brand_id = brand.id
    ref.brand_name = brand.name

    # Prefer exact catalog match via existing listing resolver (needs fallback model)
    models = (
        db.execute(select(CarModel).where(CarModel.brand_id == brand.id).order_by(CarModel.id).limit(1))
        .scalars()
        .all()
    )
    fallback_id = models[0].id if models else None
    if fallback_id is None:
        return ref
    mid = resolve_model_id_for_listing(
        db,
        brand_name=brand.name,
        brand_id=brand.id,
        fallback_model_id=fallback_id,
        title=title,
        description=None,
        series_raw=series_raw,
    )
    # If resolver returned fallback and text didn't clearly match — still OK if only one model? No:
    # only accept if fuzzy matched something other than arbitrary first, OR text clearly contains model.
    model = db.get(CarModel, mid)
    if model is None:
        return ref
    # Reject weak fallback: if mid == fallback and name not in haystack (except BMW series handled inside)
    if mid == fallback_id:
        mnl = (model.name or "").lower()
        hl = haystack.lower()
        bmw_ok = brand.name.lower() == "bmw" and (
            re.search(r"\d\s*系", haystack) or re.search(r"\bx[1-7]\b", haystack, re.I)
        )
        if not bmw_ok and mnl and mnl not in hl and not any(
            len(p) >= 2 and p in hl for p in re.split(r"[\s/\-]+", mnl) if p
        ):
            # try series_raw alone as model name
            if series_raw:
                alt = _find_model(db, brand.id, series_raw.strip())
                if alt:
                    return CatalogRef(
                        brand_id=brand.id,
                        brand_name=brand.name,
                        model_id=alt.id,
                        model_name=alt.name,
                    )
            return ref
    ref.model_id = model.id
    ref.model_name = model.name
    return ref


def resolve_catalog(
    db: Session,
    *,
    series_url: str | None = None,
    title: str | None = None,
    series_raw: str | None = None,
    brand_name: str | None = None,
    model_name: str | None = None,
) -> CatalogRef:
    """Комбинированный резолв: series URL → text → явные имена."""
    ref = CatalogRef()
    if series_url:
        ref = resolve_from_series_url(db, series_url)
        if ref.ok:
            return ref
    text_ref = resolve_from_text(
        db,
        title=title,
        series_raw=series_raw or model_name,
        brand_hint=brand_name or ref.brand_name or None,
    )
    if text_ref.brand_id and not ref.brand_id:
        ref.brand_id = text_ref.brand_id
        ref.brand_name = text_ref.brand_name
    if text_ref.model_id:
        ref.model_id = text_ref.model_id
        ref.model_name = text_ref.model_name
        if text_ref.brand_id:
            ref.brand_id = text_ref.brand_id
            ref.brand_name = text_ref.brand_name
        if ref.ok:
            return ref
    # Явные имена из score/UI
    bname = (brand_name or ref.brand_name or "").strip()
    mname = (model_name or "").strip()
    if bname and mname:
        brand = _find_brand(db, bname)
        if brand:
            model = _find_model(db, brand.id, mname)
            if model:
                return CatalogRef(
                    brand_id=brand.id,
                    brand_name=brand.name,
                    model_id=model.id,
                    model_name=model.name,
                )
            ref.brand_id = brand.id
            ref.brand_name = brand.name
    return ref


def apply_catalog_ref(obj, ref: CatalogRef, *, only_missing: bool = True) -> bool:
    """Записывает brand/model в ImportCandidate или ImportPlanItem. True если model_id выставлен."""
    if not ref.brand_id and not ref.model_id:
        return bool(getattr(obj, "model_id", None))
    if ref.brand_id and (not only_missing or not getattr(obj, "brand_id", None)):
        obj.brand_id = ref.brand_id
        if ref.brand_name:
            obj.brand_name = ref.brand_name[:128]
    elif ref.brand_name and (not only_missing or not (getattr(obj, "brand_name", None) or "").strip()):
        obj.brand_name = ref.brand_name[:128]
    if ref.model_id and (not only_missing or not getattr(obj, "model_id", None)):
        obj.model_id = ref.model_id
        if ref.model_name:
            obj.model_name = ref.model_name[:128]
    elif ref.model_name and (not only_missing or not (getattr(obj, "model_name", None) or "").strip()):
        obj.model_name = ref.model_name[:128]
    return bool(getattr(obj, "model_id", None))


def ensure_candidate_catalog(
    db: Session,
    candidate,
    *,
    series_url: str | None = None,
    series_raw: str | None = None,
) -> bool:
    if candidate.model_id and candidate.brand_id:
        return True
    ref = resolve_catalog(
        db,
        series_url=series_url,
        title=candidate.title,
        series_raw=series_raw or candidate.model_name,
        brand_name=candidate.brand_name,
        model_name=candidate.model_name,
    )
    return apply_catalog_ref(candidate, ref)


def lookup_model_with_brand(db: Session, model_id: int) -> tuple[CarBrand | None, CarModel | None]:
    model = (
        db.execute(
            select(CarModel).options(joinedload(CarModel.brand)).where(CarModel.id == model_id)
        )
        .scalars()
        .unique()
        .one_or_none()
    )
    if not model:
        return None, None
    return model.brand, model
