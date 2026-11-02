"""Manual equipment must be isolated to a listing and safe to retry."""
import copy

from app.models import Car, CarTrim, Role, User
from tests.test_new_cars import catalog, create, headers


def specification():
    return {"name_ru": "Comfort 2.0 AT", "spec": {
        "version": 1,
        "sections": [{"group": "Комфорт", "items": [
            {"name": "Климат-контроль", "value": "Двухзонный"}]}],
        "param_sections": [{"group": "Размеры", "items": [
            {"name": "Колёсная база", "value": "2700 мм"}]}],
    }}


def test_attach_retry_public_read_and_preserve_listing(catalog):
    client, db, users = catalog
    car_id = create(client, users, is_new="true", mileage_km="30").json()["id"]
    before = client.get(f"/cars/{car_id}").json()
    url = f"/admin/cars/{car_id}/trim-spec"
    first = client.put(url, headers=headers(users, "admin"), json=specification())
    assert first.status_code == 200, first.text
    retry = client.put(url, headers=headers(users, "admin"), json=specification())
    assert retry.json() == first.json()
    assert db.query(CarTrim).count() == 1
    after = client.get(f"/cars/{car_id}").json()
    assert after["trim"]["sections"][0]["items"][0]["value"] == "Двухзонный"
    assert after["trim"]["param_sections"][0]["items"][0]["value"] == "2700 мм"
    for field in ("price_cny", "photos", "title", "description", "is_new", "horsepower",
                  "engine_volume_cc", "year", "mileage_km", "model_id", "generation_id"):
        assert after[field] == before[field], field
    trim = db.get(CarTrim, first.json()["trim_id"])
    assert trim.model_id == before["model_id"]
    assert trim.generation_id == before["generation_id"]


def test_edit_does_not_change_shared_trim_and_old_revision_is_reusable(catalog):
    client, db, users = catalog
    ids = [create(client, users).json()["id"] for _ in range(2)]
    url = f"/admin/cars/{ids[0]}/trim-spec"
    old_id = client.put(url, headers=headers(users, "admin"), json=specification()).json()["trim_id"]
    db.get(Car, ids[1]).trim_id = old_id
    db.commit()
    old_json = db.get(CarTrim, old_id).spec_sections
    changed = copy.deepcopy(specification())
    changed["spec"]["sections"][0]["items"][0]["value"] = "Ручной кондиционер"
    new = client.put(url, headers=headers(users, "admin"), json=changed)
    assert new.status_code == 200, new.text
    assert new.json()["trim_id"] != old_id
    db.expire_all()
    assert db.get(Car, ids[1]).trim_id == old_id
    assert db.get(CarTrim, old_id).spec_sections == old_json
    restored = client.put(url, headers=headers(users, "admin"), json=specification())
    assert restored.json()["trim_id"] == old_id
    assert db.query(CarTrim).count() == 2


def test_permissions_missing_car_and_invalid_payload(catalog):
    client, db, users = catalog
    car_id = create(client, users).json()["id"]
    url = f"/admin/cars/{car_id}/trim-spec"
    assert client.put(url, json=specification()).status_code == 401
    for role in ("dealer", "client"):
        assert client.put(url, headers=headers(users, role), json=specification()).status_code == 403
    assert client.put("/admin/cars/99999/trim-spec", headers=headers(users, "admin"), json=specification()).status_code == 404
    for spec in ({"sections": [], "param_sections": []},
                 {"sections": [{"group": " ", "items": [{"name": " ", "value": " "}]}]},
                 {**specification()["spec"], "version": 2}):
        assert client.put(url, headers=headers(users, "admin"), json={"spec": spec}).status_code == 400
    assert client.put(url, headers=headers(users, "admin"), json={"spec": {"sections": "invalid"}}).status_code == 422
    assert db.query(CarTrim).count() == 0
    assert db.get(Car, car_id).trim_id is None


def test_moderator_can_attach(catalog):
    client, db, users = catalog
    role = Role(code="moderator", name="moderator")
    db.add(role)
    db.flush()
    user = User(email="moderator@example.test", password_hash="unused", role_id=role.id,
                full_name="moderator", is_active=True, email_verified=True)
    db.add(user)
    db.commit()
    users["moderator"] = user
    car_id = create(client, users).json()["id"]
    response = client.put(f"/admin/cars/{car_id}/trim-spec",
                          headers=headers(users, "moderator"), json=specification())
    assert response.status_code == 200, response.text


def test_external_shared_trim_edit_is_not_reused_as_requested_content(catalog):
    client, db, users = catalog
    car_id = create(client, users).json()["id"]
    url = f"/admin/cars/{car_id}/trim-spec"
    trim_id = client.put(url, headers=headers(users, "admin"), json=specification()).json()["trim_id"]
    changed = copy.deepcopy(specification())
    changed["name_ru"] = "Changed externally"
    assert client.put(f"/admin/trims/{trim_id}/spec", headers=headers(users, "admin"), json=changed).status_code == 200
    retry = client.put(url, headers=headers(users, "admin"), json=specification())
    assert retry.status_code == 409
    assert db.query(CarTrim).count() == 1
