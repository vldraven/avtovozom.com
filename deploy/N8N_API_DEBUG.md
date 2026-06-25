# Отладка n8n через Public API и curl

Бэкенд **avtovozom не использует** n8n API — только ваши два **webhook**. API n8n удобен, чтобы из терминала или из агента в Cursor смотреть workflows, ошибки executions и триггерить тестовые запросы.

Подробности по ключам см. официально: [n8n Public REST API](https://docs.n8n.io/api/) (название пунктов меню может отличаться в вашей сборке).

## 1. Что положить в локальный `.env` (не в git)

В [`.env.example`](../.env.example) добавлены **закомментированные**:

- **`N8N_PUBLIC_BASE_URL`** — origin вашего инстанса, без слэша в конце, например `https://n8n.example.com`.
- **`N8N_API_KEY`** — ключ из UI n8n (Settings → **API** / «API Key»).

Скопируйте строки в свой **`.env`**, который **не коммитится**, и заполните значения.

## 2. Примеры curl (из корня проекта)

Подставьте переменные из окружения:

```bash
# Linux/macOS, из shell где экспортированы N8N_PUBLIC_BASE_URL и N8N_API_KEY
curl -sS "${N8N_PUBLIC_BASE_URL}/api/v1/workflows" \
  -H "X-N8N-API-KEY: ${N8N_API_KEY}" \
  | head -c 2000
```

Список последних выполнений (часто полезнее для отладки):

```bash
curl -sS "${N8N_PUBLIC_BASE_URL}/api/v1/executions?limit=5" \
  -H "X-N8N-API-KEY: ${N8N_API_KEY}"
```

Детали одного выполнения (подставьте `EXEC_ID` из ответа выше):

```bash
curl -sS "${N8N_PUBLIC_BASE_URL}/api/v1/executions/${EXEC_ID}" \
  -H "X-N8N-API-KEY: ${N8N_API_KEY}"
```

## 3. Проверка именно ваших webhook (без API ключа)

Полезно воспроизвести то, что шлёт бэкенд: **POST** на **Production Webhook URL** с заголовком секрета.

```bash
curl -sS -X POST "${N8N_TELEGRAM_AI_WEBHOOK_URL}" \
  -H "Content-Type: application/json" \
  -H "X-N8N-Webhook-Secret: ${N8N_TELEGRAM_AI_WEBHOOK_SECRET}" \
  -d '{"event":"telegram_ai_draft","car_id":1,"listing_web_url":"https://example.com","body":{"listing_web_url":"https://example.com/car","car":{"title":"Test","brand":"B","model":"M","year":2022,"price_cny":100}}}'

curl -sS -X POST "${N8N_TELEGRAM_PUBLISH_WEBHOOK_URL}" \
  -H "Content-Type: application/json" \
  -H "X-N8N-Webhook-Secret: ${N8N_TELEGRAM_PUBLISH_WEBHOOK_SECRET}" \
  -d '{"event":"telegram_publish","car_id":1,"listing_web_url":"https://example.com","text":"Тест поста","photo_urls":[],"media_count":0}'
```

## 4. «Интеграция с агентом в Cursor»

Полная настройка (MCP + синк workflow): **[N8N_CURSOR_SETUP_RU.md](N8N_CURSOR_SETUP_RU.md)**.

Кратко:

1. **`N8N_PUBLIC_BASE_URL` + `N8N_API_KEY` в `.env`** — агент может `python3 scripts/n8n_api.py list-workflows` / `sync-workflow deploy/….json`.
2. **MCP `n8n-mcp`** — в проекте [`.cursor/mcp.json`](../.cursor/mcp.json) + [scripts/n8n-mcp-wrapper.sh](../scripts/n8n-mcp-wrapper.sh); ключи из `.env`.
3. **Вручную** — JSON execution / ошибка из UI n8n в чат.

Не вставляйте **боевые** ключи в чат: лучше «замазывать» ключи или давать уже обезличенные логи.
