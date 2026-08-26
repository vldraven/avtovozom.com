# Публикация объявлений в группу VK

Админка: карточка → **В соцсети** → `/staff/publish-social/{id}` (каналы Telegram + VK).

Backend вызывает VK API напрямую (без n8n): опционально загрузка фото + `wall.post` от имени сообщества.

## Что нужно

1. **`VK_GROUP_ID` + `VK_GROUP_ACCESS_TOKEN`** в `/opt/avtovozom/.env` — ключ сообщества (бессрочный).
2. **User-токен для фотокарусели** — в админке на странице поста (хранится в БД `app_settings`, ~24 ч). Env `VK_USER_ACCESS_TOKEN` — только fallback.

Ссылка OAuth для токена фото (App ID из `VK_OAUTH_CLIENT_ID`, по умолчанию `54689021`):

```text
https://oauth.vk.com/authorize?client_id=54689021&display=page&redirect_uri=https://oauth.vk.com/blank.html&scope=photos&response_type=token&v=5.199
```

После редиректа вставьте URL или `access_token` в блок «Токен VK для фотокарусели» и нажмите **Сохранить**.

## Переменные на проде

```env
VK_GROUP_ID=34626704
VK_GROUP_ACCESS_TOKEN=vk1.a....
VK_API_VERSION=5.199
# VK_OAUTH_CLIENT_ID=54689021
```

Миграция: `backend/migrations/022_app_settings.sql` (или `create_all` при старте backend).

Перезапуск:

```bash
cd /opt/avtovozom && docker compose -f docker-compose.prod.yml up -d backend
```

## API

- `GET /admin/integrations/vk` — статус group config + user token (preview, expires).
- `PUT /admin/integrations/vk/user-token` — тело `{ "token", "expires_in": 86400 }` (можно полный redirect URL).
- `GET /admin/cars/{id}/vk-compose` / `POST /admin/cars/{id}/vk/publish`.

Учёт: `car_external_publications` с `channel=vk`.
