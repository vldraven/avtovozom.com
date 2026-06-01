const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

export function dispatchFavoritesChanged() {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event("avt-favorites-changed"));
  }
}

export async function fetchFavoriteCarIds(token) {
  const res = await fetch(`${API_URL}/favorites/ids`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    const err = new Error("favorites_ids_failed");
    err.status = res.status;
    throw err;
  }
  const data = await res.json();
  return Array.isArray(data.car_ids) ? data.car_ids : [];
}

export async function addFavorite(token, carId) {
  const res = await fetch(`${API_URL}/favorites/${carId}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    const err = new Error("favorite_add_failed");
    err.status = res.status;
    throw err;
  }
  dispatchFavoritesChanged();
  return res.json();
}

export async function removeFavorite(token, carId) {
  const res = await fetch(`${API_URL}/favorites/${carId}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    const err = new Error("favorite_remove_failed");
    err.status = res.status;
    throw err;
  }
  dispatchFavoritesChanged();
  return res.json();
}

export async function toggleFavorite(token, carId, isFavorited) {
  if (isFavorited) {
    return removeFavorite(token, carId);
  }
  return addFavorite(token, carId);
}
