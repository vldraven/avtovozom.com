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
| POST | `/discover` | Сбор ссылок che168 (Playwright на сервере) |
| POST | `/filter` | Hard filter: год/пробег/дубли каталога |
| GET | `/candidates?profile_id=&status=` | Staging |
| POST | `/candidates/score` | Запись score/reasons от LLM |
| POST | `/apply-to-import-plan` | Добор в `/staff/import-plan` (учитывает quota) |
| GET | `/import-plan` | Сводка для TG `/status` и апрува |
| POST | `/import-plan/start` | После ✅ в TG |
| POST | `/import-plan/stop` | Остановка |
| GET/POST | `/memory?agent_key=sourcing` | Долгосрочная память |
| POST/GET/PATCH | `/approval-sessions` | Сессия апрува (переживает рестарт n8n) |

Staff UI (JWT): `/staff/import-candidates`, `/staff/import-plan`.  
Admin: `GET /admin/import-candidates`, `GET /admin/search-profiles`.

## Рекомендуемый прогон n8n

1. Cron **16:00 и 17:00 Europe/Moscow** + Telegram `/run` (allowlist ваш user id).
2. `GET /quota` → если `needed=0`, выйти («квота на сегодня закрыта»).
3. `GET /memory` + `GET /profiles` → контекст LLM.
4. `POST /discover` (whitelist / series) → `POST /filter`.
5. Web-research (Tavily/Serper) + LLM score → `POST /candidates/score`.
6. `POST /apply-to-import-plan` с `limit=needed`.
7. TG сводка + кнопки ✅ / ✏️ / ❌.
8. ✅ → `POST /import-plan/start`; ✏️ → memory lesson + повтор apply; ❌ → memory + cancel session.

Импорт / актуальный workflow: [n8n-sourcing-agent.workflow.json](n8n-sourcing-agent.workflow.json)

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
