# Design — Avtovozom redesign

## Source of truth (v1)

| Артефакт | Путь | Назначение |
|---|---|---|
| Claude Design HTML (mobile + desktop frames) | [mockups/avtovozom-mobile-desktop-claude-design.html](mockups/avtovozom-mobile-desktop-claude-design.html) | Визуальный SoT consumer-экранов 01–34 |
| Зафиксированные решения | [REDESIGN_V1_DECISIONS.md](REDESIGN_V1_DECISIONS.md) | Cut-line, IA, **no functional regression** для всех ролей |
| План разработки | [REDESIGN_V1_DEV_PLAN.md](REDESIGN_V1_DEV_PLAN.md) | Фазы, файлы, критерии приёмки, staff checklist |
| Regression checklist | [REDESIGN_V1_REGRESSION.md](REDESIGN_V1_REGRESSION.md) | Инвентарь страниц, chrome/PWA, ручной smoke |
| Visual Pass tracker | [VISUAL_PASS_PLAN.md](VISUAL_PASS_PLAN.md) | Полная перерисовка consumer UI по кадрам |

Открыть HTML в браузере (нужен JS — бандл распаковывается на клиенте).

## Покрытие макетов

- **Mobile:** полный набор consumer-экранов (01–32 в бандле).
- **Desktop:** только каталог (33) и карточка (34) @1440.
- **Staff / admin:** в макетах нет — функции сохраняем. v1: общий `SiteHeader`+токены на `/staff/*` без смены layout/логики; «+» в доке; ops на `/` под витриной; staff-блоки в профиле всегда видны.
- **Бренд:** логотип Avtovozom и favicon без замены; марки — существующие логотипы (`BrandLogoMarquee`).
- **Native:** не входят в веб-v1.

## Токены

Отдельного Figma/token export пока нет. При старте фазы 0 перенести CSS variables из макета в `web/styles/globals.css` `:root` (см. dev plan).
