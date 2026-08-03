# Visual Pass 2 — план (обновлённый макет)

SoT: [`mockups/avtovozom-mobile-desktop-claude-design.html`](mockups/avtovozom-mobile-desktop-claude-design.html) (обновлён 2026-07-30).

## Решения

| Тема | Решение |
|---|---|
| Гамма | Painted slate/sky (`#0f172a` / `#0ea5e9`); не красный `:root` |
| Верстка | Pixel-close @375 + desktop-кадры |
| Документы / saved calcs / уведомления / журнал | **Не реализуем** (бэклог) |
| Guest AI n8n | После Visual Pass |
| Guest chat | Анонимная сессия; staff видит и отвечает |
| TG | Те же `TELEGRAM_BOT_TOKEN` + `TELEGRAM_ADMIN_CHAT_ID`, что у заявок (`_send_admin_message`) |
| Staff layout | Без полной перерисовки |

## Главная — split mobile / desktop (2026-07-30)

| Viewport | Композиция |
|---|---|
| **&lt;1024** (mobile) | Ink hero «Под ключ…» + CTA Рассчитать/Каталог → поиск → tiles → марки → свежие лоты |
| **≥1024** (desktop) | Header nav + ink hero «Подберём…» + фильтр-бар → последние поступления (4) → 3 benefits → consult pill → `/messages` |

Журнал в nav не выводим (cut-list).


| Поверхность | Статус |
|---|---|
| Home ink hero + deal progress | Done |
| Catalog cards / chips / empty | Done |
| Car detail price (ink, не red) + facts + breakdown head | Done |
| Profile hub avatar / stats / list nav | Done |
| Customs segmented engine + desktop sticky result | Done |
| FAQ tabs + stats strip | Done |
| Messages / favorites polish | Partial (tokens) |
| Desktop catalog filter rail / detail 2-col | Partial (follow-up) |
| Auth modal 41/42, filter sheets 24/25 | Follow-up |

## Экраны в scope

01–15, 23–25, 27–29, 33–39, 41–43, 45–46.  
Вырезаны: 16–18, 26, 30–32.
