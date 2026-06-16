# n8n: Telegram-бот консультант avtovozom

Workflow для **входящих сообщений** клиентам в личку бота: поиск авто на сайте, ответы по FAQ, заявки на расчёт (в т.ч. авто **вне каталога**).

Импорт: n8n → **Import from File** → [n8n-telegram-consultant.workflow.json](n8n-telegram-consultant.workflow.json)

Существующие workflow для **канала** (черновик + публикация) описаны в [N8N_TELEGRAM_SETUP_RU.md](N8N_TELEGRAM_SETUP_RU.md).

---

## 1. Где что настраивать

| Что | Где |
|-----|-----|
| URL API, секрет бэкенда, модель LLM, промпт, лимит поиска | Узел **«Настройки workflow»** в этом workflow |
| Токен Telegram-бота | Credential **Telegram** (узлы Trigger / ответ) |
| Ключ OpenAI (или другой LLM) | Credential **OpenAI** у узла **OpenAI Chat Model** |
| Секрет для проверки на бэкенде | `.env` бэкенда: `N8N_TELEGRAM_BOT_API_SECRET` |
| Уведомления о заявках вам | `.env` бэкенда: `TELEGRAM_BOT_TOKEN`, `TELEGRAM_ADMIN_CHAT_ID` |

**Параметры workflow не требуют переменных окружения n8n** — всё редактируется в UI узла «Настройки workflow».

---

## 2. Про секрет `backendApiSecret`

Да, вы понимаете верно.

**`N8N_TELEGRAM_BOT_API_SECRET`** (бэкенд) и **`backendApiSecret`** (узел «Настройки workflow») — **одно и то же значение**, общий пароль между n8n и API:

- n8n при создании заявки (`Tool: create_lead`) шлёт заголовок `X-N8N-Webhook-Secret`
- бэкенд сверяет его с `N8N_TELEGRAM_BOT_API_SECRET` из `.env`
- если не совпало → **403 Forbidden** (POST `/integrations/n8n/bot/create-request` не для публики)

Публичные `GET /cars`, `GET /faq` секрета **не требуют** — их может вызывать любой. Секрет нужен только для **записи заявок в БД**.

Сгенерировать: `openssl rand -hex 32`

1. Прописать в **backend `.env`**: `N8N_TELEGRAM_BOT_API_SECRET=...`
2. Тот же текст в **«Настройки workflow»** → поле **`backendApiSecret`**
3. Перезапустить backend

Хранить секрет в workflow n8n **нормально** для вашего сценария: доступ к n8n уже ограничен, а дублировать в docker env не обязательно. Не экспортируйте workflow в публичный git с реальным секретом (в репозитории — placeholder).

---

## 3. Поля узла «Настройки workflow»

| Поле | Назначение | Пример |
|------|------------|--------|
| `apiBaseUrl` | Базовый URL API **без** слэша в конце; должен быть доступен из n8n | `https://api.avtovozom.com` или `http://backend:8000` в Docker |
| `backendApiSecret` | = `N8N_TELEGRAM_BOT_API_SECRET` на бэкенде | длинная случайная строка |
| `llmModel` | Модель OpenAI | `gpt-5.5`, `gpt-4o`, `gpt-4o-mini` |
| `llmTemperature` | Температура LLM | `0.35` |
| `searchCarsLimit` | Сколько объявлений возвращать в search_cars | `5` |
| `systemPrompt` | Системный промпт AI Agent | текст правил бота |
| `channelHintText` | Текст, если пишут не в личку (канал/группа) | … |

Поля `chatId`, `username`, `userText`, `firstName` заполняются автоматически из Telegram — не трогайте.

---

## 4. Переменные в `.env` бэкенда

| Переменная | Обязательно | Описание |
|------------|-------------|----------|
| `N8N_TELEGRAM_BOT_API_SECRET` | да | Секрет для `POST /integrations/n8n/bot/create-request` |
| `TELEGRAM_BOT_TOKEN` | да | Уведомления о новых заявках |
| `TELEGRAM_ADMIN_CHAT_ID` | да | Куда летят уведомления |
| `PUBLIC_WEB_ORIGIN` | да | Ссылки на карточки в уведомлениях |

---

## 5. Настройка после импорта

1. Откройте **«Настройки workflow»** → задайте `apiBaseUrl`, `backendApiSecret`, `llmModel`.
2. **Credentials → Telegram** — токен бота.
3. **Credentials → OpenAI** — API key (или замените **OpenAI Chat Model** на другой LLM-узел n8n).
4. Во всех Telegram-нодах выберите credential.
5. **Активируйте workflow** (нужен публичный HTTPS n8n для webhook Telegram).

---

## 6. Смена модели LLM

Меняете только **`llmModel`** в «Настройки workflow» (например `gpt-5.5` → `gpt-4o-mini`). Перезапуск n8n не нужен.

Другой провайдер (Anthropic и т.д.): замените узел **OpenAI Chat Model**, подключите **ai_languageModel** к **AI Agent** — остальное без изменений.

---

## 7. API для tool `create_lead`

```
POST /integrations/n8n/bot/create-request
Header: X-N8N-Webhook-Secret: <backendApiSecret из workflow>
```

`car_id` опционален — без него заявка на авто вне каталога.

---

## 8. Проверка

```bash
curl -sS -X POST "https://api.avtovozom.com/integrations/n8n/bot/create-request" \
  -H "Content-Type: application/json" \
  -H "X-N8N-Webhook-Secret: ВАШ_СЕКРЕТ" \
  -d '{"user_name":"Test","user_contact":"test@test.com","comment":"BMW X5 2022 из Китая"}'
```

Ожидается: `{"ok":true,"request_id":...}`

---

## 9. Типичные проблемы

| Симптом | Решение |
|---------|---------|
| 403 Forbidden | `backendApiSecret` в workflow ≠ `N8N_TELEGRAM_BOT_API_SECRET` в backend `.env` |
| Бот молчит | Workflow не активен; HTTPS webhook; credential Telegram |
| Tool не видит API | `apiBaseUrl` недоступен из контейнera n8n |
| «Модель не найдена» | Проверьте `llmModel` и доступ в аккаунте OpenAI |
