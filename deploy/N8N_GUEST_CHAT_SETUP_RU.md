# n8n: гостевой чат сайта ↔ ИИ-консультант

Тот же консультант, что отвечает в Telegram-боте, отвечает гостям в `/messages` **без входа**.

**n8n с телефона не нужен.** Workflow крутится на сервере. С телефона вы только:
- читаете алерты в Telegram (`TELEGRAM_ADMIN_CHAT_ID`);
- при handoff отвечаете гостю в веб-чате `/messages` (мобильный браузер) или из staff-инбокса.

Импорт: n8n → **Import from File** → [n8n-guest-chat-consultant.workflow.json](n8n-guest-chat-consultant.workflow.json)

Telegram-бот: [N8N_TELEGRAM_BOT_SETUP_RU.md](N8N_TELEGRAM_BOT_SETUP_RU.md)

---

## 1. Поток

```
Гость пишет на сайте (/messages)
  → POST /public/guest-chats/messages
  → уведомление админу в Telegram (как раньше)
  → фон: POST N8N_GUEST_CHAT_WEBHOOK_URL  { chat_id, text, history, … }
  → n8n AI Agent (search_cars / get_car / get_faq / create_lead / handoff_to_manager)
  → POST /integrations/n8n/guest-chats/{chat_id}/messages  { text }
  → гость видит ответ при polling (~26 с)
```

Если `N8N_GUEST_CHAT_WEBHOOK_URL` не задан — чат работает как раньше (только человек + TG-пинг).

---

## 2. Переменные `.env` бэкенда

| Переменная | Обязательно | Описание |
|------------|-------------|----------|
| `N8N_GUEST_CHAT_WEBHOOK_URL` | да (для ИИ) | Production URL webhook n8n (после Activate) |
| `N8N_GUEST_CHAT_WEBHOOK_SECRET` | нет | Если пусто — берётся `N8N_TELEGRAM_BOT_API_SECRET` |
| `N8N_TELEGRAM_BOT_API_SECRET` | да | Секрет для reply / handoff / create-request |
| `N8N_GUEST_CHAT_TIMEOUT_SEC` | нет | Таймаут вызова webhook (по умолчанию 120). При `onReceived` n8n отвечает сразу |
| `N8N_GUEST_CHAT_SENDER_USER_ID` | нет | `users.id` от чьего имени пишется ответ; иначе первый активный `admin` |
| `TELEGRAM_BOT_TOKEN` / `TELEGRAM_ADMIN_CHAT_ID` | да | Алерты и handoff |
| `PUBLIC_WEB_ORIGIN` | да | Ссылки «Открыть чат» |

---

## 3. Настройка после импорта

1. Узел **«Настройки workflow»**: `apiBaseUrl`, `backendApiSecret` (= `N8N_TELEGRAM_BOT_API_SECRET`), `llmModel`, `webOrigin` — как у Telegram-консультанта.
2. Credential **OpenAI** на узле **OpenAI Chat Model**.
3. **Activate** workflow.
4. Скопируйте Production Webhook URL → `N8N_GUEST_CHAT_WEBHOOK_URL` в backend `.env`.
5. Перезапустите backend.

Синк из git (после ручного импорта и credentials):

```bash
python3 scripts/n8n_api.py sync-workflow deploy/n8n-guest-chat-consultant.workflow.json
```

---

## 4. API для n8n

Общий заголовок: `X-N8N-Webhook-Secret: <backendApiSecret>`

```
POST /integrations/n8n/guest-chats/{chat_id}/messages
Body: { "text": "…" }

POST /integrations/n8n/guest-chats/{chat_id}/handoff
Body: { "reason": "…" }

POST /integrations/n8n/bot/create-request
Body: { …, "source": "guest_chat", "guest_chat_id": 123 }
```

---

## 5. Проверка

1. Не задавая webhook URL — гостевой чат шлёт только TG-алерт (регрессия).
2. С URL — напишите с инкогнито в `/messages`; через ~30 с должен появиться ответ консультанта.
3. «Позовите менеджера» — в admin Telegram приходит handoff; ответьте из `/messages` под staff.

---

## 6. Типичные проблемы

| Симптом | Решение |
|---------|---------|
| Гость пишет, ответа нет | Workflow не Active / неверный `N8N_GUEST_CHAT_WEBHOOK_URL` / смотрите executions в n8n |
| 403 на reply | `backendApiSecret` ≠ `N8N_TELEGRAM_BOT_API_SECRET` |
| 503 «Нет активного admin» | Задайте `N8N_GUEST_CHAT_SENDER_USER_ID` |
| Отказ (секрет) в n8n | Заголовок с бэкенда не совпал с `backendApiSecret` в «Настройки workflow» |
