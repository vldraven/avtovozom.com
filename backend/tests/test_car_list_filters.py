from app.car_list_filters import matches_turnkey_rub_bounds


def test_matches_turnkey_rub_bounds_min():
    assert matches_turnkey_rub_bounds(2_400_000, 2_400_000, None) is True
    assert matches_turnkey_rub_bounds(2_265_300, 2_400_000, None) is False


def test_matches_turnkey_rub_bounds_max():
    assert matches_turnkey_rub_bounds(4_550_000, None, 4_550_000) is True
    assert matches_turnkey_rub_bounds(4_600_000, None, 4_550_000) is False


def test_matches_turnkey_rub_bounds_range():
    assert matches_turnkey_rub_bounds(3_000_000, 2_400_000, 4_550_000) is True
    assert matches_turnkey_rub_bounds(None, 2_400_000, 4_550_000) is False
