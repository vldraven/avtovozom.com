/** Роли с доступом к админским действиям в каталоге */
export function isStaffRole(role) {
  if (role == null || role === "") return false;
  const r = String(role).trim().toLowerCase();
  return r === "admin" || r === "moderator";
}

/** Админ, модератор и дилер могут создавать объявления вручную */
export function canCreateListings(role) {
  if (role == null || role === "") return false;
  const r = String(role).trim().toLowerCase();
  return r === "admin" || r === "moderator" || r === "dealer";
}

/** Только администратор может править любое объявление в каталоге */
export function isAdminRole(role) {
  if (role == null || role === "") return false;
  return String(role).trim().toLowerCase() === "admin";
}
