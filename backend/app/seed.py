import json
import logging
from pathlib import Path

from sqlalchemy import func, select, update
from sqlalchemy.orm import Session

from .models import Car, CarBrand, CarGeneration, CarModel, ModelWhitelist, Role, User
from .security import hash_password

log = logging.getLogger(__name__)

# Справочник марок/моделей: matthlavacka/car-list (JSON, ~39 марок / ~900 моделей).
_CAR_LIST_PATH = Path(__file__).resolve().parent / "data" / "car_list.json"
# Китайские марки и линейки моделей (дополняет основной список; см. Wikipedia «List of automobile manufacturers of China»).
_CHINESE_CAR_LIST_PATH = Path(__file__).resolve().parent / "data" / "chinese_car_list.json"
_MODEL_CATALOG_THRESHOLD = 80  # при меньшем числе моделей — догружаем справочник из JSON

_DEFAULT_GENERATION_NAME = "Поколение не указано"
_DEFAULT_GENERATION_SLUG = "ne-ukazano"


def _ensure_default_generations_and_backfill(db: Session) -> None:
    """
    У моделей с активными объявлениями, но без записей в car_generations, создаётся одно поколение
    по умолчанию; старые карточки с пустым generation_id привязываются к нему — в дереве каталога
    появляются ссылки на поколения.
    """
    try:
        model_ids = (
            db.execute(select(Car.model_id).where(Car.is_active.is_(True)).distinct())
            .scalars()
            .all()
        )
    except Exception:
        return
    for mid in model_ids:
        exists = db.execute(
            select(CarGeneration.id).where(CarGeneration.model_id == mid).limit(1)
        ).scalar_one_or_none()
        if exists:
            continue
        g = CarGeneration(
            model_id=mid,
            name=_DEFAULT_GENERATION_NAME,
            slug=_DEFAULT_GENERATION_SLUG,
        )
        db.add(g)
        db.flush()
        db.execute(
            update(Car)
            .where(
                Car.model_id == mid,
                Car.is_active.is_(True),
                Car.generation_id.is_(None),
            )
            .values(generation_id=g.id)
        )
    db.commit()


def _seed_brand_models_from_json(
    db: Session,
    json_path: Path,
    get_or_create_brand,
    get_or_create_model,
) -> None:
    if not json_path.is_file():
        return
    try:
        raw = json.loads(json_path.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError):
        return
    if not isinstance(raw, list):
        return
    for entry in raw:
        if not isinstance(entry, dict):
            continue
        brand_name = entry.get("brand")
        models = entry.get("models") or []
        if not brand_name or not isinstance(brand_name, str):
            continue
        brand = get_or_create_brand(brand_name.strip())
        for model_name in models:
            if not model_name or not isinstance(model_name, str):
                continue
            mn = model_name.strip()
            if not mn:
                continue
            get_or_create_model(brand.id, mn, None)


def seed_initial_data(db: Session) -> None:
    role_codes = {r.code for r in db.execute(select(Role)).scalars().all()}
    if "admin" not in role_codes:
        db.add_all(
            [
                Role(code="admin", name="Administrator"),
                Role(code="moderator", name="Moderator"),
                Role(code="dealer", name="Dealer"),
                Role(code="user", name="User"),
            ]
        )
        db.commit()

    admin_exists = db.execute(select(User).where(User.email == "admin@avtovozom.local")).scalar_one_or_none()
    if not admin_exists:
        admin_role = db.execute(select(Role).where(Role.code == "admin")).scalar_one()
        db.add(
            User(
                email="admin@avtovozom.local",
                password_hash=hash_password("admin12345"),
                full_name="Platform Admin",
                role_id=admin_role.id,
                is_active=True,
            )
        )
        db.commit()

    dealer_exists = db.execute(
        select(User).where(User.email == "dealer@avtovozom.local")
    ).scalar_one_or_none()
    if not dealer_exists:
        dealer_role = db.execute(select(Role).where(Role.code == "dealer")).scalar_one()
        db.add(
            User(
                email="dealer@avtovozom.local",
                password_hash=hash_password("dealer12345"),
                full_name="Demo Dealer",
                role_id=dealer_role.id,
                is_active=True,
            )
        )
        db.commit()

    extra_dealers: list[tuple[str, str, str, str]] = [
        (
            "dealer2@avtovozom.local",
            "dealer212345",
            "АвтоИмпорт Плюс",
            "Иван Петров",
        ),
        (
            "dealer3@avtovozom.local",
            "dealer312345",
            "Восток Моторс",
            "Сергей Козлов",
        ),
    ]
    dealer_role_row = db.execute(select(Role).where(Role.code == "dealer")).scalar_one()
    for email, password, company, full_name in extra_dealers:
        if db.execute(select(User).where(User.email == email)).scalar_one_or_none():
            continue
        db.add(
            User(
                email=email,
                password_hash=hash_password(password),
                full_name=full_name,
                display_name=full_name.split()[0] if full_name else "",
                company_name=company,
                role_id=dealer_role_row.id,
                is_active=True,
            )
        )
        db.commit()

    def get_or_create_brand(brand_name: str) -> CarBrand:
        row = db.execute(select(CarBrand).where(CarBrand.name == brand_name)).scalar_one_or_none()
        if row:
            return row
        row = CarBrand(name=brand_name)
        db.add(row)
        db.flush()
        return row

    def get_or_create_model(brand_id: int, model_name: str, che168_url: str | None) -> CarModel:
        row = (
            db.execute(
                select(CarModel).where(CarModel.brand_id == brand_id).where(CarModel.name == model_name)
            )
            .scalar_one_or_none()
        )
        if row:
            if che168_url and not row.che168_url:
                row.che168_url = che168_url
            return row
        row = CarModel(brand_id=brand_id, name=model_name, che168_url=che168_url)
        db.add(row)
        db.flush()
        return row

    n_models = db.scalar(select(func.count(CarModel.id))) or 0
    if n_models < _MODEL_CATALOG_THRESHOLD:
        _seed_brand_models_from_json(db, _CAR_LIST_PATH, get_or_create_brand, get_or_create_model)
        db.commit()
    # Китайский каталог подмешиваем всегда (idempotent): основной JSON часто уже в БД, а китайских марок там нет.
    _seed_brand_models_from_json(db, _CHINESE_CAR_LIST_PATH, get_or_create_brand, get_or_create_model)

    toyota = get_or_create_brand("Toyota")
    honda = get_or_create_brand("Honda")
    bmw = get_or_create_brand("BMW")

    toyota_camry = get_or_create_model(toyota.id, "Camry", None)
    get_or_create_model(toyota.id, "Corolla", None)
    honda_civic = get_or_create_model(honda.id, "Civic", None)
    get_or_create_model(honda.id, "CR-V", None)

    # Страница серии BMW 3 на che168 (URL можно сменить в админке). В JSON matthlavacka нет «3 Series».
    bmw_3series_url = "https://www.che168.com/china/baoma/baoma3xi/#pvareaid=108403#seriesZong"
    bmw_3series = get_or_create_model(bmw.id, "3 Series", bmw_3series_url)

    def ensure_whitelist(model: CarModel, enabled: bool) -> None:
        row = (
            db.execute(select(ModelWhitelist).where(ModelWhitelist.model_id == model.id))
            .scalar_one_or_none()
        )
        if row:
            row.enabled = enabled
            return
        db.add(ModelWhitelist(model_id=model.id, enabled=enabled))

    # Разрешаем хотя бы один реальный источник для che168.
    ensure_whitelist(bmw_3series, True)
    # И оставляем существующие demo-whitelist, если они уже есть (для теста UI).
    ensure_whitelist(toyota_camry, True)
    ensure_whitelist(honda_civic, True)

    db.commit()
    try:
        from .apply_generations_reference import apply_generations_reference_file

        apply_generations_reference_file(db)
    except Exception as e:
        log.warning("Справочник поколений (JSON) не применён: %s", e)
    _ensure_default_generations_and_backfill(db)
