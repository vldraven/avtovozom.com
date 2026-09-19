# Дайджест новых поступлений (Telegram / MAX)

Админка: **`/staff/publish-digest`** — период (МСК), список всех новых авто за период, ручной отбор (до 10 в пост), каркас/ИИ-текст, публикация в TG и/или MAX с обложками.

Не помечает лоты как `published` в `car_external_publications` (очередь social agent не блокируется).

## Поток

1. Backend выбирает активные `Car` с `created_at` в диапазоне дат (МСК) + фото-обложка.
2. Собирает skeleton-текст в формате подборки.
3. Опционально: n8n AI улучшает текст (`event=social_digest_ai_draft`).
4. Публикация: существующий Telegram publish webhook + прямой MAX API.

## Backend API (admin JWT)

| Метод | Путь |
|-------|------|
| GET | `/admin/social/digest/compose?date_from=&date_to=` |
| POST | `/admin/social/digest/ai-draft` |
| POST | `/admin/social/digest/publish` |

Agent API (`X-Agent-Secret`):

| Метод | Путь |
|-------|------|
| GET | `/agent/v1/social/digest` |
| POST | `/agent/v1/social/digest/ai-draft` |
| POST | `/agent/v1/social/digest/publish` |

## n8n

Импорт: [n8n-social-digest-ai.workflow.json](n8n-social-digest-ai.workflow.json)

Webhook path: `avtovozom-digest-ai`.

Секрет: `AVTOVOZOM_DIGEST_AI_WEBHOOK_SECRET` в n8n env (или fallback на `AVTOVOZOM_AI_WEBHOOK_SECRET`).

На backend:

```env
N8N_DIGEST_AI_WEBHOOK_URL=https://n8n…/webhook/avtovozom-digest-ai
N8N_DIGEST_AI_WEBHOOK_SECRET=
# если DIGEST URL не задан — используется N8N_TELEGRAM_AI_WEBHOOK_*
```

Публикация TG — те же `N8N_TELEGRAM_PUBLISH_WEBHOOK_*`, что для одиночных постов.
MAX — `MAX_BOT_TOKEN` + `MAX_CHANNEL_CHAT_ID`.

## Формат поста

```
Вступление от ИИ

🚗 Brand Model Year — ≈ X,XX млн ₽

N км · объём · л.с.

Короткое описание

https://avtovozom.com/catalog/...

…

Заключение
```

К посту прикладываются **заглавные фото** выбранных авто (до 10).
