# n8n: агент публикаций в соцсети (Telegram)

Целевой процесс: в слоты **08:00, 09:00, 10:00, 13:00, 17:00, 18:00, 19:00 Europe/Moscow** агент берёт свежие лоты каталога, выбирает **1 объявление** без публикации в Telegram, генерирует текст **тем же ИИ**, что кнопка «Сгенерировать» в админке, прикладывает **все фото** (до 10) и присылает вам на апрув. Вы принимаете, отклоняете это объявление, просите **другое авто** или **поправить текст**.

Импорт: n8n → **Import from File** → [n8n-social-agent.workflow.json](n8n-social-agent.workflow.json)

Ручной флоу `/staff/publish-telegram/[id]` **не меняется**. Публикация в канал по-прежнему через [n8n-telegram-publish.workflow.json](n8n-telegram-publish.workflow.json). Агент после вашего ✅ вызывает backend `POST /agent/v1/social/publish`.

**Отдельный Telegram-бот.** Не используйте sourcing-бота и не вешайте второй Trigger на тот же токен — оба workflow будут получать одни и те же апдейты.

---

## 1. Расписание

Workflow timezone: **Europe/Moscow**. Cron: `0 8,9,10,13,17,18,19 * * *` — 08:00, 09:00, 10:00, 13:00, 17:00, 18:00, 19:00.

Вне слотов: в личку боту `/run` (тот же прогон, что cron) или свободный текст (`/status`, правки текста, другое авто, ✅/❌).

---

## 2. Что делает прогон

1. Воркер (без LLM) вызывает `GET /agent/v1/social/queue` — свежие активные лоты **с фото**, без `published` / `pending_review` и без `skipped` **за сегодня (МСК)**.
2. ИИ выбирает **1 лот** (свежесть, popular, цена под ключ, мощность).
3. `generate_text` → тот же n8n webhook, что кнопка «Сгенерировать» (цена под ключ, эмодзи, льготный УС, @avtovozombot, sales-points).
4. `send_draft`: все фото (до 10) вам в личку + кнопки ✅/❌, лот `pending_review`.
5. Вы:
   - **✅ Опубликовать** → канал, статус `published`.
   - **❌ Отклонить** → это объявление не предлагать **до конца сегодняшнего дня (МСК)**; завтра снова можно. Другую машину той же модели — сразу.
   - **🔄 Другое авто** / «возьми другую» / «возьми X5» → текущий лот **возвращается в очередь** (`release`, не skip), агент присылает другой.
   - Правки текста («короче», «без эмодзи») → `generate_text` с revision → новый черновик того же лота.
   - Готовый новый текст в чат → `send_draft` с этим текстом, тот же лот.

Ручная публикация из `/staff/publish-telegram/[id]` тоже ставит `published`, поэтому агент этот лот больше не возьмёт. Другой лот той же модели в тот же день — можно.

Telegram принимает **не больше 10 фото** в альбоме — лишние обрезаются.

---

## 3. Backend API (`X-Agent-Secret` = `AGENT_API_SECRET`)

| Метод | Путь | Назначение |
|--------|------|------------|
| GET | `/agent/v1/social/queue` | Очередь неопубликованных лотов |
| GET | `/agent/v1/social/pending` | Черновики на апруве |
| GET | `/agent/v1/social/cars/{id}` | Факты, `skeleton_text`, фото |
| POST | `/agent/v1/social/ai-draft` | Текст тем же webhook, что админка |
| POST | `/agent/v1/social/draft` | Пометить `pending_review` |
| POST | `/agent/v1/social/publish` | В канал + `published` |
| POST | `/agent/v1/social/skip` | Не предлагать это объявление до конца сегодняшнего дня (МСК) |
| POST | `/agent/v1/social/release` | Снять черновик, лот снова в очереди |
| GET/POST | `/agent/v1/memory?agent_key=social` | Уроки из правок |

Учёт: строка `car_external_publications` с `channel=telegram`.

Нужны уже существующие переменные бэкенда: `AGENT_API_SECRET`, `PUBLIC_WEB_ORIGIN`, `PUBLIC_API_ORIGIN`, `N8N_TELEGRAM_PUBLISH_WEBHOOK_URL`, `N8N_TELEGRAM_PUBLISH_WEBHOOK_SECRET`.

---

## 4. Настройка после импорта

1. **BotFather** — новый бот (например `@avtovozom_social_bot`). Credential **Telegram** на узлах Trigger / ответ / отказ.
2. Напишите боту `/start`, узнайте свой user id (@userinfobot) и chat id (обычно совпадает с user id в личке).
3. Узел **«Настройки workflow»**:

| Поле | Значение |
|------|----------|
| `apiBaseUrl` | `https://api.avtovozom.com` |
| `agentApiSecret` | тот же, что `AGENT_API_SECRET` на backend |
| `operatorTelegramUserId` | ваш numeric user id |
| `operatorChatId` | chat id лички |
| `telegramBotToken` | токен **этого** бота (Code-tools не видят credential) |
| `llmModel` | как у sourcing, например `gpt-5.5` |
| `picksPerRun` | `1` |

4. **OpenAI Chat Model** — тот же OpenAI credential, что у sourcing.
5. Активировать workflow. Проверка: боту `/run` → должен прийти 1 альбом или сообщение «нет свежих лотов».

Синк с git (после первого импорта): `python3 scripts/n8n_api.py sync-workflow deploy/n8n-social-agent.workflow.json` — секреты и operator id из живого n8n не затираются плейсхолдерами.

---

## 5. Типичные проблемы

| Симптом | Что проверить |
|---------|----------------|
| Два ответа на одно сообщение | Trigger этого бота висит ещё в sourcing/consultant workflow |
| Черновик в БД, в Telegram тишина | `telegramBotToken` / `operatorChatId` в «Настройки workflow» |
| 403 от API | `agentApiSecret` ≠ `AGENT_API_SECRET` |
| Publish ок=false | Publish-workflow канала, `PUBLIC_API_ORIGIN` для фото |
| Одни и те же машины каждый час | Не нажимаете ✅/❌ — они висят в `pending_review` до решения |
