# n8n: гостевой чат сайта (тот же консультант)

ИИ в чате на сайте для неавторизованных пользователей работает **в том же workflow**, что и Telegram-бот:

[n8n-telegram-consultant.workflow.json](n8n-telegram-consultant.workflow.json)

Отдельный workflow не нужен.

---

## Как это работает

1. Гость пишет в `/messages` → `POST /public/guest-chats/messages`.
2. Backend (если менеджер ещё не отвечал в треде) вызывает webhook узла **«Webhook (сайт)»** в консультанте:
   `N8N_GUEST_CHAT_WEBHOOK_URL`.
3. Тот же AI Agent + инструменты (`search_cars`, `get_car`, `get_faq`, `create_lead`).
4. Узел **«Канал ответа»** → **«Ответ в чат сайта»** → `POST /integrations/n8n/bot/guest-reply`.
5. Фронт подтягивает сообщение с `message_type=assistant`.

Telegram-ветка не меняется: Trigger → личка → Agent → ответ в Telegram.

---

## Backend `.env`

| Переменная | Обязательно | Описание |
|------------|-------------|----------|
| `N8N_TELEGRAM_BOT_API_SECRET` | да | Секрет для `create-request` и `guest-reply` |
| `N8N_GUEST_CHAT_WEBHOOK_URL` | да для ИИ на сайте | Production URL узла **Webhook (сайт)** |
| `N8N_GUEST_CHAT_WEBHOOK_SECRET` | нет | Опциональный заголовок к n8n |
| `N8N_GUEST_CHAT_TIMEOUT_SEC` | нет | По умолчанию `120` |

Пока URL пуст — гостевой чат только с людьми.

---

## Что сделать в n8n

1. Обновить существующий **«Avtovozom — Telegram консультант (бот)»** из JSON  
   (Import/overwrite или `python3 scripts/n8n_api.py sync-workflow deploy/n8n-telegram-consultant.workflow.json`).
2. Убедиться, что появился узел **Webhook (сайт)** (path `avtovozom-guest-consultant`).
3. **Activate** (или пересохранить) → скопировать Production URL webhook в `N8N_GUEST_CHAT_WEBHOOK_URL`.
4. Задеплоить backend с кодом guest-reply / триггером.

Настройки (`apiBaseUrl`, `backendApiSecret`, OpenAI) — те же, что для Telegram.

---

## Payload webhook (backend → n8n)

```json
{
  "guest_token": "...",
  "chat_id": 123,
  "message_id": 456,
  "text": "Текст гостя",
  "created": true
}
```

Заявки из web-чата уходят с `source: "guest_web"`.
