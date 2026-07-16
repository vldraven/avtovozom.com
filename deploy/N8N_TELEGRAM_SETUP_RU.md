# n8n: черновик текста и публикация в Telegram для avtovozom

Файлы workflow для импорта (n8n → **Import from File**):

- [n8n-telegram-ai-draft.workflow.json](n8n-telegram-ai-draft.workflow.json)
- [n8n-telegram-publish.workflow.json](n8n-telegram-publish.workflow.json)

Под ваш бэкенд уже заведены **два webhook** (`ai-draft` и `publish`). Этот документ описывает:

1. что положить в **`.env` на сервере API** и откуда взять значения;
2. что настроить **внутри n8n** (секреты, Telegram, ИИ);
3. как собрать **два workflow** (можно импортировать JSON из этого же каталога или собрать вручную).

---

## 1. Переменные в `.env` бэкенда (FastAPI)

Файл: **`.env` рядом с backend / docker-compose** (копия из [.env.example](/.env.example)).

| Переменная | Обязательно | Зачем | Откуда взять |
|------------|-------------|--------|----------------|
| `PUBLIC_WEB_ORIGIN` | да | Абсолютные ссылки на карточку в тексте поста (`https://сайт...`) | Сайт в браузере: `https://avtovozom.com` **без** слэша в конце. Уже есть у вас для чата и ссылок. |
| `PUBLIC_API_ORIGIN` | да для продакшена | В **абсолютные URL фото** (`https://api.../media/...`). Telegram загружает картинки по этим HTTPS-ссылкам | Обычно **тот же origin**, что и публичный API: если фронт ходит на `https://api.avtovozom.com`, сюда тоже **`https://api.avtovozom.com`** (без `/` в конце). Локально: `http://localhost:8000`. |
| `N8N_TELEGRAM_AI_WEBHOOK_URL` | для ИИ-текста | Production URL второго узла Webhook workflow «AI draft» | После включения workflow в n8n: узел **Webhook** → вкладка **Production URL** → скопировать полный HTTPS URL. Это не Test URL из «Listen for test». |
| `N8N_TELEGRAM_AI_WEBHOOK_SECRET` | сильно рекомендуется | Серый общий секрет; бэкенд шлёт его в заголовке `X-N8N-Webhook-Secret` | Сгенерируйте длинную случайную строку, например: `openssl rand -hex 32`. **Точно такое же значение** пропишите в n8n (см. ниже `$env`). |
| `N8N_TELEGRAM_AI_TIMEOUT_SEC` | нет | Таймаут HTTP к n8n (сек.), по умолчанию у кода **120** | С web_search генерация дольше; при обрывах поднимите до `150`–`180`. |
| `N8N_TELEGRAM_PUBLISH_WEBHOOK_URL` | для отправки в канал | Production URL второго workflow «publish» | Как для AI URL, но из второго workflow. |
| `N8N_TELEGRAM_PUBLISH_WEBHOOK_SECRET` | сильно рекомендуется | Отдельный секрет под публикацию (не обязан совпадать с AI-секретом) | Так же `openssl rand -hex 32`, тот же принцип: один и тот же на backend и в n8n для этого webhook. |
| `N8N_TELEGRAM_PUBLISH_TIMEOUT_SEC` | нет | По умолчанию **45** с | При сложном медиа можно поднять. |

После изменения `.env` перезапустите контейнер/процесс **backend**.

**Проверка:** с серера, где крутится API, выполнился бы `curl -I "$(echo $N8N_TELEGRAM_AI_WEBHOOK_URL)"` — не обязательно 200 на GET; важно, что hostname n8n **доступен** из вашей Docker-сети/VPC и по HTTPS действует ваш сертификат.

---

## 2. Настройки Telegram и переменные окружения

**Chat ID и токен бота** — в workflow публикации, узел **«Настройки Telegram»** (редактируется в UI n8n).

В `.env` / docker n8n нужны **секреты webhook** и (для ИИ) OpenAI:

| Переменная в n8n | Описание |
|------------------|-----------|
| `AVTOVOZOM_AI_WEBHOOK_SECRET` | Должна совпадать с **`N8N_TELEGRAM_AI_WEBHOOK_SECRET`** в бэкенде. |
| `AVTOVOZOM_PUBLISH_WEBHOOK_SECRET` | Должна совпадать с **`N8N_TELEGRAM_PUBLISH_WEBHOOK_SECRET`**. |
| `TELEGRAM_BOT_TOKEN` | **Обязательно для альбома (2+ фото):** тот же токен, что в credential Telegram. Узел **Данные для поста** (Set) читает `$env` и передаёт `botToken` дальше — Code в n8n 2.1.4 **не видит** `$env` и `getCredentials`. |
| `TELEGRAM_CHANNEL_ID` | `@username_канала` или числовой id `-100…` — подставляется в **Chat ID** нод через `$env`; можно зафиксировать id канала прямо в нодах, тогда переменную не задают. |

**Важно для Docker:** одной строки в `.env` недостаточно — переменные должны попасть **внутрь контейнера** n8n:

```yaml
# docker-compose.yml (фрагмент сервиса n8n)
services:
  n8n:
    env_file: .env
    environment:
      TELEGRAM_BOT_TOKEN: ${TELEGRAM_BOT_TOKEN}
      TELEGRAM_CHANNEL_ID: ${TELEGRAM_CHANNEL_ID}
      AVTOVOZOM_AI_WEBHOOK_SECRET: ${AVTOVOZOM_AI_WEBHOOK_SECRET}
      AVTOVOZOM_PUBLISH_WEBHOOK_SECRET: ${AVTOVOZOM_PUBLISH_WEBHOOK_SECRET}
      N8N_BLOCK_ENV_ACCESS_IN_NODE: "false"
```

После правки: `docker compose down && docker compose up -d`. Проверка: execution → **Данные для поста** → Output → `botToken` не пустой.

**Telegram канал:**

1. Создайте бота в BotFather, получите `TELEGRAM_BOT_TOKEN`.
2. Добавьте бота в канал **администратором** и дайте право **публиковать сообщения** (Posting messages / Publish messages).
3. Узнайте channel id:
   - по `@имяканала`; или
   - перешлите пост из канала боту @getidsbot / @RawDataBot и возьмите `chat.id` вида `-100xxxxxxxxxx`.

Эти значения **не** должны попадать в git — после импорта workflow правьте **«Настройки Telegram»** только в n8n UI.

---

## 3. Контракт webhook #1 — черновик текста (ИИ)

**Вызывает бэкенд:** `POST /admin/cars/{id}/telegram/ai-draft`

**Тело** на ваш n8n приходит как полезная нагрузка webhook (обычно в **`$json.body`** при включённом «JSON body»):

- `event`: `"telegram_ai_draft"`
- `car_id`: число
- `listing_web_url`, `canonical_path`
- `style_hint`: строка или `null`
- `selected_photo_absolute_urls`: массив URL строк
- `car`: объект с полями `title`, `description`, `brand`, `model`, `generation`, `year`, пробег, двигатель, цены и т.д.

**Ответ в HTTP** того же запроса: JSON **строго**:

```json
{ "text": "готовый текст поста одной строкой или с \\n" }
```

Дополнительно бэкенд умеет прочитать `text`, вложенный в `body`/`data`, но проще всего вернуть плоско `{ "text": "..." }`.

**Проверка секрета:** HTTP-заголовок входящего запроса: **`X-N8N-Webhook-Secret`** (регистр не важен для сравнения в примерах ниже используйте тот ключ, который реально видит узел webhook).

Импортируйте файл **[n8n-telegram-ai-draft.workflow.json](n8n-telegram-ai-draft.workflow.json)**.

Workflow вызывает **AI Agent** + **OpenAI Chat Model** (credential **OpenAI** в UI n8n, как у бота-консультанта). В узле OpenAI Chat Model включены **Use Responses API** и встроенный **Web Search** — модель может искать sales-поинты модели в интернете. Факты конкретного лота (цена, год, пробег) по-прежнему только из JSON webhook. **`OPENAI_API_KEY` в env n8n не нужен.**

После импорта откройте узел **Webhook AI**: при конфликте пути (`avtovozom-telegram-ai`) n8n может предложить другой — тогда в `.env` бэкенда укажите **полный Production URL**, который покажет интерфейс n8n после активации workflow.

---

## 4. Контракт webhook #2 — публикация в канал

**Вызывает бэкенд:** `POST /admin/cars/{id}/telegram/publish`

**Тело webhook (`$json.body`):**

- `event`: `"telegram_publish"`
- `car_id`
- `listing_web_url`
- `text`: полный текст поста
- `photo_urls`: массив **0–10** абсолютных HTTPS URL
- `media_count`: число (дубликат для удобства)

В импортируемом **[n8n-telegram-publish.workflow.json](n8n-telegram-publish.workflow.json)** — заполните узел **«Настройки Telegram»**; credential Telegram — у **Telegram: текст** и **Telegram: одно фото**; альбом: **Сборка альбома** → **HTTP: sendMediaGroup**.

- **0 фото:** только текст — `sendMessage`
- **1 фото:** `sendPhoto` с подписью (обрезка под лимит Telegram ~1024)
- **2–10:** HTTP `sendMediaGroup` (узлы **Сборка альбома** + **HTTP: sendMediaGroup**)

Успешный ответ бэкенду (браузер/админка): JSON с **`"ok": true`** (можно добавить своё поле `telegram_message_id`).

Ошибка: **`{ "ok": false, "error": "краткое сообщение" }`**

Путь webhook по умолчанию `avtovozom-telegram-publish` (при смене пути обновите **Production URL** в `.env` бэкенда).

---

## 5. Отладка через n8n API и curl

См. отдельно **[N8N_API_DEBUG.md](N8N_API_DEBUG.md)** — там примеры `curl` для Public API (`X-N8N-API-KEY`) и для ваших webhook. Переменные `N8N_PUBLIC_BASE_URL` / `N8N_API_KEY` описаны как **необязательные** строки в [`.env.example`](../.env.example); бэкенд их не читает.

## 6. После деплоя

1. Импорт обоих JSON → в **«Настройки Telegram»** укажите chat ID и bot token; credential Telegram — у двух Telegram-нод; для ИИ — credential **OpenAI** в узле **OpenAI Chat Model** workflow «Telegram текст (ИИ)».
2. Включить **Production** режим webhook, активировать workflows.
3. Скопировать **Production webhook URL** каждого в `.env` бэкенда.
4. Секреты: одинаковые пары **`N8N_TELEGRAM_AI_WEBHOOK_SECRET` ↔ `AVTOVOZOM_AI_WEBHOOK_SECRET`** и **`…PUBLISH…` ↔ `…PUBLISH…`** в n8n.
5. В админке открыть **«В Telegram»** для объявления → «Сгенерировать» → «Опубликовать».

Если версия вашего n8n не принимает JSON импорт, откройте эти два файла в редакторе: там видны типы узлов и выражения — соберите вручную 1 в 1.

---

## 7. Замечания по безопасности и типичные проблемы

- Выражения вроде `{{ $env.OPENAI_API_KEY }}` в workflow ИИ **больше не используются** — ключ OpenAI хранится в credential узла **OpenAI Chat Model**.
- Если в ответ админке приходит **«Forbidden»**, проверьте совпадение заголовка `X-N8N-Webhook-Secret` между бэкендом и переменными `AVTOVOZOM_*_WEBHOOK_SECRET` в n8n (без пробелов по краям).
- Если Telegram пишет **«Wrong file …»** или не качает фото — чаще всего `PUBLIC_API_ORIGIN` на API указывает не ту схему/домен (должен быть доступен Telegram по публичному HTTPS).
