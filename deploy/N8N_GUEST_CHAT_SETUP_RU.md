# Гостевой чат сайта → тот же n8n-консультант, что в Telegram

**Отдельный workflow не нужен.** Гостевой чат сайта подключён ко второму триггеру
в уже настроенном [n8n-telegram-consultant.workflow.json](n8n-telegram-consultant.workflow.json)
(«Avtovozom — Telegram консультант (бот)»).

Секреты / OpenAI / Telegram credentials — те же, что уже стоят в «Настройки workflow».

Базовая настройка бота: [N8N_TELEGRAM_BOT_SETUP_RU.md](N8N_TELEGRAM_BOT_SETUP_RU.md)

---

## 1. Поток

**Бот сам отвечает клиенту в чате на сайте.**

```
Гость пишет на сайте (/messages)
  → POST /public/guest-chats/messages
  → TG-алерт админу (мониторинг)
  → фон: POST N8N_GUEST_CHAT_WEBHOOK_URL
  → тот же AI Agent (search_cars / get_car / get_faq / create_lead / handoff_to_manager)
  → POST /integrations/n8n/guest-chats/{chat_id}/messages
  → гость видит ответ (быстрый poll ~2.5 с)
```

Telegram-личка по-прежнему идёт через **Telegram Trigger** в том же workflow.

---

## 2. Что сделать на уже работающем n8n

1. Залить обновлённый JSON (сохранит `backendApiSecret` и credentials):

```bash
python3 scripts/n8n_api.py sync-workflow deploy/n8n-telegram-consultant.workflow.json
```

Или вручную: Import / обновить узлы из файла — **не затирайте** `backendApiSecret`.

2. В workflow появится узел **«Webhook гостевой чат»** (path `avtovozom-guest-chat`).
3. **Activate** (если был выключен) и скопируйте **Production** URL webhook.
4. В backend `.env`:

```bash
N8N_GUEST_CHAT_WEBHOOK_URL=https://<ваш-n8n>/webhook/avtovozom-guest-chat
# секрет можно не задавать — возьмётся N8N_TELEGRAM_BOT_API_SECRET
```

5. Перезапустите backend.

---

## 3. Переменные `.env`

| Переменная | Обязательно | Описание |
|------------|-------------|----------|
| `N8N_GUEST_CHAT_WEBHOOK_URL` | да (для ИИ на сайте) | Production URL узла «Webhook гостевой чат» |
| `N8N_GUEST_CHAT_WEBHOOK_SECRET` | нет | Пусто = `N8N_TELEGRAM_BOT_API_SECRET` |
| `N8N_TELEGRAM_BOT_API_SECRET` | да | Уже есть для TG-бота |
| `N8N_GUEST_CHAT_SENDER_USER_ID` | нет | `users.id` для сообщений бота; иначе первый admin |
| `TELEGRAM_*` / `PUBLIC_WEB_ORIGIN` | да | Как для бота |

Без `N8N_GUEST_CHAT_WEBHOOK_URL` сайт работает по-старому (только человек + TG-пинг).

---

## 4. API (тот же секрет, что у create-request)

```
POST /integrations/n8n/guest-chats/{chat_id}/messages
Header: X-N8N-Webhook-Secret
Body: { "text": "…" }

POST /integrations/n8n/guest-chats/{chat_id}/handoff
Body: { "reason": "…" }
```

---

## 5. Проверка

1. Напишите боту в Telegram — ответ как раньше.
2. С инкогнито откройте `/messages`, напишите гостем — через несколько секунд ответ бота в чате.
3. «Позовите менеджера» — handoff в admin Telegram.

---

## 6. n8n с телефона

**Не нужен.** Workflow на сервере; с телефона — алерты в Telegram и при handoff ответ из `/messages` под staff.
