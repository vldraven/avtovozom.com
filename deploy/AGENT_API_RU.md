# Agent API — capabilities для sourcing-агента (n8n)

Сайт не «думает»: внешний агент (n8n) вызывает HTTP API. LLM / Telegram / search credentials — **только в n8n**.

## Auth

```http
X-Agent-Secret: <тот же, что AGENT_API_SECRET в backend .env>
```

Сгенерировать: `openssl rand -hex 32`  
Прописать в `/opt/avtovozom/.env` → `AGENT_API_SECRET=...` и в HTTP Request credentials n8n.

Префикс: `https://api.avtovozom.com/agent/v1/...`

## Эндпоинты

| Метод | Путь | Назначение |
|--------|------|------------|
| GET | `/profiles` | Профили отбора (`?enabled_only=true`) |
| PATCH | `/profiles/{id}` | Обновить criteria / brief / max_select |
| GET | `/quota?profile_id=` | Дневная квота: `already_today`, `needed` (MSK) |
| POST | `/discover` | Сбор ссылок с `criteria.series_urls` (whitelist по умолчанию **выкл.**) |
| POST | `/enrich` | Парсинг карточек: year / price / mileage / registration_date |
| POST | `/filter` | Hard filter: возраст рег. 3–5 лет, пробег, mid/upper цена, дубли каталога |
| POST | `/collect` | **Рекомендуемый** one-shot: discover(+ретраи)→enrich→filter → компактный `listings[]` + статус |
| GET/PUT | `/profiles/{id}/market-research` | `market_research_at` + `market_hot_models` (раз в ≥7 дней) |
| GET | `/candidates?profile_id=&status=` | Staging |
| POST | `/candidates/score` | Запись score/reasons от LLM |
| POST | `/apply-to-import-plan` | Добор в `/staff/import-plan` (учитывает quota) |
| GET | `/import-plan` | Сводка для TG `/status` и апрува |
| POST | `/import-plan/start` | После ✅ в TG |
| POST | `/import-plan/stop` | Остановка |
| GET/POST | `/memory?agent_key=` | Долгосрочная память (`sourcing` / `social`) |
| GET | `/social/queue` | Шортлист лотов без публикации (`compact=1` — без skeleton/draft) |
| GET | `/social/pending` | Черновики на апруве |
| GET | `/social/cars/{id}` | Каркас поста + фото |
| POST | `/social/ai-draft` | Тот же ИИ-текст, что кнопка «Сгенерировать» |
| POST | `/social/draft` | Пометить `pending_review` |
| POST | `/social/publish` | В канал (через существующий n8n publish-webhook) |
| POST | `/social/skip` | Не предлагать лот до конца сегодняшнего дня (МСК) |
| POST | `/social/release` | Снять черновик, лот снова в очереди |
| POST/GET/PATCH | `/approval-sessions` | Сессия апрува (переживает рестарт n8n) |

Staff UI (JWT): `/staff/search-profiles` (series URL), `/staff/import-candidates`, `/staff/import-plan`.  
Admin: `GET/PATCH /admin/search-profiles`, `GET /admin/import-candidates`.

## Рекомендуемый прогон n8n

1. Cron **16:00 и 17:00 Europe/Moscow** + Telegram `/run` (allowlist ваш user id).
2. `GET /quota` → если `needed=0`, выйти («квота на сегодня закрыта»).
3. `GET /profiles/{id}/market-research` → если `stale`, Tavily + `PUT .../market-research` (иначе **не** ходить в интернет).
4. **`POST /collect`** один раз (discover+ретраи → enrich → filter) → компактный `listings[]`.
5. Если `status=empty` → LLM возвращает **статус запуска**, без score/apply.
6. LLM shortlist → `POST /candidates/score` → `POST /apply-to-import-plan` с `candidate_ids`.
7. TG сводка + ✅ → `POST /import-plan/start`.

Лимиты (`parse_limit`, `filter_limit`, `llm_shortlist_limit`, `discover_retries`, …) задаются в **Настройки workflow** n8n и пробрасываются в `/collect`.  
Устаревший ручной путь: `discover` → `enrich` → `filter` по отдельности (для отладки).

Импорт / актуальный workflow: [n8n-sourcing-agent.workflow.json](n8n-sourcing-agent.workflow.json)

Соцсети (очередь лотов + апрув, текст/канал — существующие webhook): [N8N_SOCIAL_AGENT_RU.md](N8N_SOCIAL_AGENT_RU.md), [n8n-social-agent.workflow.json](n8n-social-agent.workflow.json).

Схема как у **Telegram консультант**: `Telegram Trigger` → `Настройки` → `AI Agent` + `toolCode` к `/agent/v1/*` + ответ в TG.  
Дополнительно: cron **16:00/17:00 Europe/Moscow** → тот же агент с промптом `/run`.

В «Настройки workflow» прописать:
- `agentApiSecret` = `AGENT_API_SECRET`
- `operatorTelegramUserId` / `operatorChatId`
- Credentials: **новый** Telegram-бот; OpenAI; web-search — нода **Search in Tavily** (отдельный tool агента, не `searchApiKey` в Set).

## Env

```env
AGENT_API_SECRET=...
CHE168_NEW_PER_RUN=0
PARSER_DAILY_MIN_HOUR_MSK=16
```

`CHE168_NEW_PER_RUN=0` отключает whitelist auto-import сразу в каталог; отбор идёт через агента → import-plan → ваш апрув.
