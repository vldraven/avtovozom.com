# Redesign v1 — план разработки

Решения: [REDESIGN_V1_DECISIONS.md](REDESIGN_V1_DECISIONS.md).  
Макеты: [mockups/avtovozom-mobile-desktop-claude-design.html](mockups/avtovozom-mobile-desktop-claude-design.html).

**Ограничения:**
- Без изменений бэкенда / миграций / новых API.
- Consumer-макеты — приоритет визуала; **staff/admin не в макете ≠ можно вырезать**.
- **No functional regression** для guest / client / dealer / moderator / admin (см. [REDESIGN_V1_DECISIONS.md](REDESIGN_V1_DECISIONS.md) §0). Native apps — вне scope визуала.

---

## Фаза 0 — Foundation (chrome + tokens)

**Статус:** сделано в коде (2026-07-30) — токены, `SiteHeader`, 5-tab dock + «+», staff wiring.  
Остаток: сложные headers на `/`, `/catalog`, `CarDetailView` (бургер-меню) — в фазе 1/2 при рестайле этих экранов.

**Цель:** единый визуальный каркас без смены IA listing.

### Работы

1. Вынести design tokens из HTML-макета в `:root` в [`web/styles/globals.css`](../web/styles/globals.css) (accent/neutral/surface/radius/shadow/space/font). Сохранить совместимость со старыми переменными где нужно (alias).
2. Создать [`web/components/SiteHeader.js`](../web/components/SiteHeader.js) — один header для consumer-страниц (заменить copy-paste).
3. Переписать [`web/components/MobileBottomNav.js`](../web/components/MobileBottomNav.js) под 5 вкладок + **сохранить «+» / new-listing** для dealer/admin.
4. Подтянуть [`web/components/SiteFooter.js`](../web/components/SiteFooter.js) и правила hide в [`web/pages/_app.js`](../web/pages/_app.js) (dock/footer).
5. Подключить `SiteHeader` + токены на `/staff/*` **без** смены layout/логики страниц (тот же `.site-logo`).
6. Baseline: ручные скриншоты `/`, `/catalog`, detail, auth, messages, profile @375 и @1440 до мержа фазы.

### Файлы

- `web/styles/globals.css`
- `web/components/SiteHeader.js` (new)
- `web/components/MobileBottomNav.js`
- `web/components/SiteFooter.js`
- `web/pages/_app.js`
- точечная замена header markup в consumer pages (минимум для сборки)

### Приёмка

- Dock: Главная / Каталог / Чаты / Избранное / Профиль|Войти; у dealer/admin — **«+» как сейчас**.
- Guest на Чаты/Избранное → auth gate или redirect с `next=`.
- Staff/dealer: создание объявления из дока + ops на `/` и в профиле.
- Логотип Avtovozom и favicon без регрессии; `SiteHeader` на staff с тем же логотипом.
- Smoke: admin открывает `/staff/*` и виджеты профиля/home; dealer — new-listing + open-requests.
- `npm --prefix web run build` зелёный.

---

## Фаза 1 — Home витрина + Catalog listing

**Статус:** сделано в коде (2026-07-30) — витрина `/`, redirect listing-query → `/catalog`, свежие лоты, deal-card, staff ops на `/` сохранены; каталог понимает `q`/`brand` query; цена «под ключ». Визуальный pass chip-sheets — дальше в polish/фазе 2 деталки.

**Цель:** разделить `/` (витрина) и `/catalog` (листинг) без поломки SEO slug.

### Работы

1. **Home `/`** ([`web/pages/index.js`](../web/pages/index.js)): витрина — поиск → `/catalog?q=…`, CTA калькулятор/заявка/FAQ, **популярные марки с существующими логотипами** (`BrandLogoMarquee` / `logo_storage_url`), блок «Ваша сделка», лента «свежие лоты». Listing UX → catalog. **Staff/parser/admin панели: оставить на `/` под витриной** (решение 1A).
2. **Catalog** ([`web/pages/catalog/[[...slug]].js`](../web/pages/catalog/[[...slug]].js)): основной listing UI по макету 02/33 — chip filters → bottom sheets (mobile), sidebar (desktop), sort, cards «под ключ», empty/loading.
3. Компоненты карточки листинга: вынести/обновить media + meta (без badge «ниже рынка»).
4. Filter sheets: [`CatalogQuickFilters.js`](../web/components/CatalogQuickFilters.js), [`CatalogSortDropdown.js`](../web/components/CatalogSortDropdown.js) — UX шторок «Марка» / «Цена» по 24–25.
5. Scroll restore / listing cache: адаптировать helpers в `web/lib/*` под primary listing path `/catalog`.

### SEO / redirects

- Canonical и SSR для `/catalog/[brand]/[model]/…` без регрессии.
- Существующие query filters на `/` → soft redirect или «Смотреть в каталоге» с переносом query (выбрать один путь в реализации; предпочтение: `router.replace` на `/catalog` с теми же query для bookmark-совместимости listing).

### Приёмка

- Mobile 01/02/27/28 и desktop 33 визуально близки на реальных данных.
- SSR catalog и sitemap/canonical не сломаны.
- Build + smoke: home → catalog → card.

---

## Фаза 2 — Car detail (mobile + desktop)

**Статус:** сделано в коде (2026-07-30) — SiteHeader, факты, dual CTA, breakdown summary «под ключ», trust-блок, sticky bar, trim modal без изменений API. Без ИИ-виджета.

**Цель:** макеты 03 / 34 + trim sheet 21.

### Работы

1. [`web/components/CarDetailView.js`](../web/components/CarDetailView.js): layout, CTA «Заявка» / «Написать в чат», breakdown из существующего `price_breakdown` / `estimated_total_rub`.
2. Статичный блок «Что проверяем» (copy + CTA в заявку/чат; без фейковых PDF viewer).
3. Trim / комплектация — существующие данные `car.trim` в шторке/секции.
4. Favorites/share — рестайл существующих контролов.
5. **Не** добавлять ИИ-виджет на desktop.

### Приёмка

- Breakdown и trim работают на лотах с данными.
- Guest: чат/избранное → gate; заявка доступна.
- Desktop 34 без AI panel.

---

## Фаза 3 — Auth, PIN, gates

**Статус:** сделано в коде (2026-07-30) — auth/reset copy+layout, PIN setup «Позже», AppLock copy, AuthPromptModal с benefits + заявка без входа. API flows без изменений.

### Работы

1. [`web/pages/auth.js`](../web/pages/auth.js), [`reset-password.js`](../web/pages/reset-password.js) — layout 09.
2. [`PinSetupPanel.js`](../web/components/PinSetupPanel.js), [`AppLockGate.js`](../web/components/AppLockGate.js), [`PinPad.js`](../web/components/PinPad.js) — 10–11.
3. [`AuthPromptModal.js`](../web/components/AuthPromptModal.js) — 23 + copy про заявку без входа.

### Приёмка

- Существующие login/register/PIN flows без смены API.
- Гейт не блокирует каталог/calc/FAQ/заявку.

---

## Фаза 4 — Chats, quote, calculator, FAQ, favorites

### Работы

1. [`web/pages/messages.js`](../web/pages/messages.js) — list 04 + thread 05; «сделка» = request/chat labels.
2. [`web/pages/request-quote.js`](../web/pages/request-quote.js) — форма 12; budget/origin/city в UI, сериализация в `comment` (или существующие поля), без новых endpoints.
3. [`web/pages/customs-calculator.js`](../web/pages/customs-calculator.js) — 06; без save-to-profile.
4. [`web/pages/faq.js`](../web/pages/faq.js) + при необходимости секции China из статики лендинга — UI 07/08 без CMS categories.
5. [`web/pages/favorites.js`](../web/pages/favorites.js) — 13; empty 29; **без** price-drop states (можно «неактивно/продано» если `!is_active`).

### Приёмка

- Все flows работают на текущих API.
- Empty/error states соответствуют макету по смыслу.

---

## Фаза 5 — Profile hub

### Работы

1. [`web/pages/profile.js`](../web/pages/profile.js) — хаб 14: заявки, данные, безопасность (PIN/пароль/passkey).
2. Deep «Мои заявки» (15) — UI поверх `GET /requests/my` + offers.
3. **Не** добавлять пункты: Сделка и документы (PDF), Сохранённые расчёты, Уведомления, Журнал.
4. Staff widgets (`AdminRequestsWidget`, parser, dealer, ссылки на `/staff/*`) — **всегда видны** под consumer-меню для роли (решение 4).

### Приёмка

- Клиент видит хаб как в макете без мёртвых ссылок.
- Dealer/moderator/admin: полный набор текущих действий доступен; staff-секции профиля не спрятаны.

---

## Фаза 6 — Polish + desktop extrapolation + regression

### Работы

1. Empty/loading/error единообразие (27–29).
2. Desktop extrapolation: auth, messages, profile, calc, FAQ — те же компоненты, без пиксель-матча.
3. Safe-area / PWA dock smoke.
4. SEO-лендинги — только если остаётся ёмкость; иначе backlog.
5. `npm --prefix web run build`; ручной чеклист mobile+desktop.

### Приёмка done v1

- [x] 5-tab dock + SiteHeader на всех consumer pages
- [x] `/` витрина, `/catalog` listing, detail mobile+desktop
- [x] Auth/PIN/gates, chats, quote, calc, FAQ, favorites, profile hub
- [x] Нет *новых* фич макета: ИИ, журнал, PDF-сделки, notification center, «ниже рынка»
- [x] **Роли:** guest / client / dealer / moderator / admin — smoke без потери функций (включая весь `/staff/*`, «+» в доке, ops на `/` под витриной, staff-блоки в профиле)
- [x] Логотип Avtovozom + favicon сохранены; марки с реальными логотипами
- [x] Backend не менялся (redesign v1 FE-only)
- [x] Build green

Автопроверка инвентаря страниц/ссылок: [REDESIGN_V1_REGRESSION.md](REDESIGN_V1_REGRESSION.md).

---

## Карта файлов (primary touch)

| Область | Пути |
|---|---|
| Tokens / layout CSS | `web/styles/globals.css` |
| App chrome | `web/pages/_app.js`, `SiteHeader.js`, `MobileBottomNav.js`, `SiteFooter.js` |
| Home / catalog | `web/pages/index.js`, `web/pages/catalog/[[...slug]].js`, `CatalogQuickFilters.js`, `CatalogSortDropdown.js`, `CatalogCardMedia.js`, `lib/catalogFilters.js`, scroll/cache libs |
| Detail | `web/components/CarDetailView.js`, lightbox/share/favorite |
| Auth | `web/pages/auth.js`, `Pin*`, `AppLockGate.js`, `AuthPromptModal.js` |
| Account | `messages.js`, `favorites.js`, `profile.js`, `request-quote.js` |
| Tools / content | `customs-calculator.js`, `faq.js` |

---

## Backlog фазы 2 (backend / продукт)

1. Guest AI consultant + handoff + история.
2. Deal entity + document storage (PDF).
3. In-app notifications + preferences.
4. Saved customs calculations (server).
5. Market badge / city-specific turnkey pricing.
6. Diagnostics / China history / tracking attachments.
7. Journal CMS.
8. FAQ categories in API.
9. Structured lead fields (budget, origin, city) на API.
10. Native apps на том же IA.
11. SEO landings visual pass.
12. Desktop full-frame mockups для профиля/чатов.

---

## Порядок внедрения (рекомендуемый PR-split)

1. PR: tokens + SiteHeader + dock (фаза 0) — низкий риск.
2. PR: catalog listing restyle + sheets (часть фазы 1) — без разделения home.
3. PR: home витрина + redirect listing filters (остаток фазы 1) — SEO-внимание.
4. PR: car detail (фаза 2).
5. PR: auth/gates (фаза 3).
6. PR: messages/quote/calc/FAQ/favorites (фаза 4).
7. PR: profile hub (фаза 5).
8. PR: polish (фаза 6).

Каждый PR: `npm --prefix web run build`; без backend diff; чеклист no-regression по ролям (§0 decisions).

---

## Staff regression checklist (на каждый затрагивающий chrome/home/profile PR)

- [ ] `/staff/new-listing`, `edit-listing`
- [ ] `/staff/open-requests`, `admin-requests` (+ detail)
- [ ] `/staff/admin-users`, `admin-brands`, `admin-faq`, `admin-customs-calculator`
- [ ] `/staff/import-plan`, `import-candidates`, `search-profiles`
- [ ] `/staff/publish-avito|vk|telegram/[id]`
- [ ] Profile: AdminRequestsWidget / DealerOpenRequests / parser panels / my-cars (по роли)
- [ ] Home: role-gated admin/parser блоки на `/` под витриной
- [ ] Profile: staff-блоки видимы под consumer-меню
- [ ] Favicon + `.site-logo` на consumer и staff
- [ ] Brand logos в блоке марок (`logo_storage_url` / BrandLogoMarquee)
