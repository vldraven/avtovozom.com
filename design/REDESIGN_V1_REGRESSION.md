# Redesign v1 — regression checklist

Дата: 2026-07-30. Автопроверка + ручной smoke после фазы 6.

## Pages inventory vs `main`/HEAD

- Удалённых `web/pages/*` нет.
- Добавлено: `web/pages/staff/search-profiles.js` (функциональный плюс, не регресс).
- Все `href`/`router.push` на app-маршруты резолвятся в существующие page files.

## SiteHeader

| Область | Статус |
|---|---|
| Consumer pages (`/`, catalog, detail via CarDetailView, auth, messages, profile, favorites, quote, calc, FAQ, dealers, SEO landings, reset-password) | OK |
| Staff pages (`/staff/*`) | OK, включая `import-candidates` |
| Служебные (`robots`, `sitemap`, `indexnow`) | N/A (не UI) |

## Chrome / PWA

- [x] 5-tab dock: Главная · Каталог · Чаты · Избранное · Профиль|Войти
- [x] Dealer/admin «+» / new-listing в доке (`canCreateListings`)
- [x] Dock скрыт на `/messages`, `/auth`, `/reset-password`
- [x] `viewport-fit=cover` + safe-area padding у dock/layout
- [x] Favicon `/favicon.png` + `.site-logo` в `SiteHeader`

## Staff smoke (ручной)

- [ ] `/staff/new-listing`, `edit-listing`
- [ ] `/staff/open-requests`, `admin-requests` (+ detail)
- [ ] `/staff/admin-users`, `admin-brands`, `admin-faq`, `admin-customs-calculator`
- [ ] `/staff/import-plan`, `import-candidates`, `search-profiles`
- [ ] `/staff/publish-avito|vk|telegram/[id]`
- [ ] Profile: AdminRequestsWidget / DealerOpenRequests / parser / my-cars
- [ ] Home: role-gated admin/parser блоки под витриной
- [ ] Profile: staff-блоки под consumer-меню

## Consumer smoke (ручной)

- [ ] Guest: витрина, каталог, detail, заявка без входа, calc, FAQ
- [ ] Client: чаты, избранное, профиль (заявки + офферы + PIN)
- [ ] Нет мёртвых ссылок: журнал / PDF-сделки / уведомления / saved calcs / ИИ

## Cut-list (не в v1)

Журнал, guest AI, deal PDFs, notification center, saved customs, «ниже рынка», city-specific turnkey pricing.
