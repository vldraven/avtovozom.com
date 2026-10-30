"""New-car condition: HTTP forms, persistence, permissions and public filtering."""
from datetime import datetime, timedelta

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, text
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app import main
from app.db import get_db
from app.models import Car, CarBrand, CarGeneration, CarModel, CarPhoto, CarTrim, Role, User
from app.security import create_access_token


@pytest.fixture
def catalog(monkeypatch):
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    for model in (Role, User, CarBrand, CarModel, CarGeneration, CarTrim, Car, CarPhoto):
        model.__table__.create(engine)
    db = sessionmaker(bind=engine)()
    for role in ("admin", "dealer", "client"):
        row = Role(code=role, name=role)
        db.add(row)
        db.flush()
        db.add(User(email=f"{role}@example.test", password_hash="unused", role_id=row.id,
                    full_name=role, is_active=True, email_verified=True))
    db.add(CarBrand(id=1, name="Example"))
    db.add(CarModel(id=1, brand_id=1, name="Touring"))
    db.commit()
    users = {u.full_name: u for u in db.query(User).all()}
    monkeypatch.setattr(main, "build_cbr_snapshot", lambda: (None, "offline test"))
    monkeypatch.setattr(main, "ensure_settings_row", lambda db: None)
    monkeypatch.setattr(main, "_get_cached_slug_maps", lambda db: ({1: "example"}, {(1, 1): "touring"}))
    monkeypatch.setattr(main, "_ping_indexnow_for_car", lambda *args: None)
    monkeypatch.setattr(main, "refresh_car_stored_estimate", lambda *args, **kwargs: None)
    monkeypatch.setattr(main, "save_uploaded_car_photos", lambda car_id, blobs: [f"/media/cars/{car_id}/test.jpg"])
    main.app.dependency_overrides[get_db] = lambda: db
    # No lifespan startup: the production startup uses PostgreSQL and external integrations.
    client = TestClient(main.app)
    yield client, db, users
    client.close()
    main.app.dependency_overrides.clear()
    db.close()
    engine.dispose()


def headers(users, role="dealer"):
    return {"Authorization": f"Bearer {create_access_token(str(users[role].id))}"}


def form(**extra):
    return dict(brand_id="1", model_id="1", title="Example Touring", year="2026",
                engine_volume_cc="1500", horsepower="150", price_cny="120000", **extra)


def create(client, users, **extra):
    return client.post("/staff/cars", headers=headers(users), data=form(**extra),
                       files={"photos": ("test.jpg", b"synthetic image", "image/jpeg")})


@pytest.mark.parametrize("value,expected", [(None, False), ("true", True), ("false", False)])
def test_create_and_read_condition(catalog, value, expected):
    client, db, users = catalog
    response = create(client, users, **({} if value is None else {"is_new": value}))
    assert response.status_code == 200, response.text
    car_id = response.json()["id"]
    assert response.json()["is_new"] is expected
    db.expire_all()
    assert db.get(Car, car_id).is_new is expected
    assert client.get(f"/cars/{car_id}").json()["is_new"] is expected
    assert client.get(f"/staff/cars/{car_id}", headers=headers(users)).json()["is_new"] is expected


@pytest.mark.parametrize("endpoint,role", [("staff", "dealer"), ("admin", "admin")])
def test_edit_toggle_and_legacy_client_omission(catalog, endpoint, role):
    client, db, users = catalog
    car_id = create(client, users, is_new="true", mileage_km="12").json()["id"]
    for value, expected in [(None, True), ("false", False), (None, False), ("true", True)]:
        data = form(mileage_km="12", **({} if value is None else {"is_new": value}))
        response = client.put(f"/{endpoint}/cars/{car_id}", headers=headers(users, role), data=data)
        assert response.status_code == 200, response.text
        assert response.json()["is_new"] is expected
        assert response.json()["mileage_km"] == 12
        db.expire_all()
        assert db.get(Car, car_id).is_new is expected


def test_filter_counts_pagination_combination_and_hidden_cars(catalog):
    client, db, users = catalog
    ids = []
    for i, (is_new, active, year, mileage) in enumerate([
        (True, True, 2026, 12), (False, True, 2026, 0),
        (True, True, 2025, None), (True, False, 2026, 0),
    ]):
        car = Car(source_listing_id=f"fixture-{i}", brand_id=1, model_id=1, title="Touring",
                  year=year, engine_volume_cc=1500, horsepower=150, price_cny=120000,
                  is_new=is_new, is_active=active, mileage_km=mileage,
                  created_at=datetime(2026, 1, 1) + timedelta(days=i))
        db.add(car)
        db.flush()
        ids.append(car.id)
    db.commit()
    for query, expected in [("", [ids[2], ids[1], ids[0]]), ("is_new=true", [ids[2], ids[0]]),
                            ("is_new=false", [ids[1]]),
                            ("is_new=true&brand_id=1&year_from=2026&q=Touring", [ids[0]])]:
        response = client.get(f"/cars?sort=date_desc&{query}")
        assert response.status_code == 200, response.text
        assert response.json()["total"] == len(expected)
        assert [c["id"] for c in response.json()["items"]] == expected
    page = client.get("/cars?is_new=true&sort=date_desc&limit=1&page=2").json()
    assert page["total"] == 2
    assert [c["id"] for c in page["items"]] == [ids[0]]
    assert client.get("/cars?is_new=true&year_from=2030").json()["total"] == 0
    assert client.get("/cars?is_new=invalid").status_code == 422


def test_invalid_forms_and_permissions_do_not_change_condition(catalog):
    client, db, users = catalog
    car_id = create(client, users, is_new="true").json()["id"]
    assert create(client, users, is_new="invalid").status_code == 422
    assert client.put(f"/staff/cars/{car_id}", headers=headers(users), data=form(is_new="invalid")).status_code == 422
    assert client.put(f"/staff/cars/{car_id}", data=form(is_new="false")).status_code == 401
    assert client.put(f"/staff/cars/{car_id}", headers=headers(users, "client"), data=form(is_new="false")).status_code == 403
    assert client.put(f"/admin/cars/{car_id}", headers=headers(users), data=form(is_new="false")).status_code == 403
    # Even an admin using the own-listing route cannot change someone else's car.
    assert client.put(f"/staff/cars/{car_id}", headers=headers(users, "admin"), data=form(is_new="false")).status_code == 404
    db.expire_all()
    assert db.get(Car, car_id).is_new is True


def test_database_default_for_imports_without_condition(catalog):
    _, db, _ = catalog
    db.execute(text("INSERT INTO cars (source, source_listing_id, brand_id, model_id, title, description, year, engine_volume_cc, horsepower, price_cny, is_active, is_popular, created_at, updated_at) VALUES ('manual', 'legacy', 1, 1, 'Legacy', '', 2026, 1500, 150, 120000, true, false, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)"))
    db.commit()
    assert db.query(Car).filter_by(source_listing_id="legacy").one().is_new is False
