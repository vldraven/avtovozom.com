# Cursor ↔ n8n: чтобы агент сам правил workflow

Два канала:

1. **MCP `n8n-mcp`** — агент в Cursor видит tools (`n8n_list_workflows`, `n8n_update_partial_workflow`, …).
2. **CLI `scripts/n8n_api.py`** — синк JSON из `deploy/` на живой n8n без ручного импорта.

Бэкенд avtovozom эти переменные **не читает**. Только локально / для агента.

---

## 1. API-ключ в n8n

1. Откройте ваш n8n (например `https://n8n.ваш-домен.ru`).
2. **Settings → API** → создайте ключ.
3. Убедитесь, что Public API включён (в self-hosted обычно по умолчанию).

---

## 2. Локальный `.env` (не в git)

В корне проекта в **`.env`** (скопируйте из `.env.example`):

```bash
N8N_PUBLIC_BASE_URL=https://n8n.ваш-домен.ru
N8N_API_KEY=ваш_ключ_из_n8n
```

Без слэша в конце URL.

---

## 3. MCP в Cursor

В репозитории уже есть [`.cursor/mcp.json`](../.cursor/mcp.json) — он запускает [scripts/n8n-mcp-wrapper.sh](../scripts/n8n-mcp-wrapper.sh), который подхватывает `.env`.

1. **Cursor → Settings → Tools & MCP** (или Features → MCP).
2. Убедитесь, что MCP включён для проекта.
3. Должен появиться сервер **`n8n-mcp`** (после перезагрузки окна, если нужно).
4. Нужен **Node.js** и сеть для первого `npx n8n-mcp`.

Проверка: попросите агента «покажи список workflow на n8n».

### Ограничения MCP

- Cursor показывает **ограниченное число tools** — если серверов много, отключите лишние.
- **`backendApiSecret`** и credentials в workflow через API **не трогаем** при синке — только код узлов из git.

---

## 4. CLI: синк workflow из репозитория

Первый раз workflow нужно **импортировать вручную** (n8n → Import → `deploy/n8n-telegram-consultant.workflow.json`), прописать Telegram/OpenAI credentials и `backendApiSecret`.

Дальше агент (или вы) обновляете JSON в `deploy/` и заливаете на сервер:

```bash
# Список workflow
python3 scripts/n8n_api.py list-workflows

# Посмотреть, что уйдёт на сервер (без записи)
python3 scripts/n8n_api.py sync-workflow deploy/n8n-telegram-consultant.workflow.json --dry-run

# Залить изменения узлов (parameters), сохранить id и credentials на n8n
python3 scripts/n8n_api.py sync-workflow deploy/n8n-telegram-consultant.workflow.json
```

Синк **по имени workflow** (`name` в JSON). Для каждого узла с тем же `name` обновляется `parameters`; `id`, `credentials`, `webhookId` на сервере остаются.

### Отладка executions

```bash
python3 scripts/n8n_api.py list-executions --limit 5
python3 scripts/n8n_api.py get-execution EXEC_ID
```

Подробнее curl-примеры: [N8N_API_DEBUG.md](N8N_API_DEBUG.md).

---

## 5. Что просить агента

Примеры:

- «Обнови код в `search_cars` в workflow и залей на n8n»
- «Покажи последние ошибки execution бота-консультанта»
- «Синхронизируй `deploy/n8n-telegram-consultant.workflow.json` на прод n8n»

Агент правит файл в git → `sync-workflow` или MCP `n8n_update_partial_workflow`.

---

## 6. Безопасность

- **Не коммитьте** `N8N_API_KEY` и реальный `backendApiSecret` в workflow JSON.
- API-ключ n8n = полный доступ к automation — храните только в `.env`.
- В чат Cursor не вставляйте боевые ключи; логи execution можно без секретов.

---

## 7. Альтернатива: встроенный MCP n8n 2.14+

Если n8n свежий, в **Settings → Instance-level MCP** можно включить нативный сервер (`https://ваш-n8n/mcp-server/http`). Он удобен для **запуска** workflow как tools; для правки JSON из git удобнее **n8n-mcp** + `n8n_api.py` выше.
