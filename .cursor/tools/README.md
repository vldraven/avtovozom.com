# Tools

## n8n (Cursor + агент)

См. [deploy/N8N_CURSOR_SETUP_RU.md](../deploy/N8N_CURSOR_SETUP_RU.md).

| Скрипт | Назначение |
|--------|------------|
| `scripts/n8n_api.py` | Public API: список workflow, executions, синк `deploy/*.workflow.json` |
| `scripts/n8n-mcp-wrapper.sh` | Запуск `n8n-mcp` для `.cursor/mcp.json` |

**Env (корневой `.env`, не в git):**

- `N8N_PUBLIC_BASE_URL` — origin n8n без слэша
- `N8N_API_KEY` — Settings → API в n8n

**Примеры:**

```bash
python3 scripts/n8n_api.py list-workflows
python3 scripts/n8n_api.py sync-workflow deploy/n8n-telegram-consultant.workflow.json
```
