# Публикация объявлений в группу VK

Админка: карточка → **В соцсети** → `/staff/publish-social/{id}` (каналы Telegram + VK).

Backend вызывает VK API напрямую (без n8n): опционально загрузка фото + `wall.post` от имени сообщества.

## Что нужно

1. **`VK_GROUP_ID` + `VK_GROUP_ACCESS_TOKEN`** в `/opt/avtovozom/.env` — ключ сообщества (бессрочный).
2. **User-токен для фотокарусели** — через кнопку **«Подключить через сервер»** в админке (хранится в БД `app_settings`).

### Почему не вставлять токен из браузера

Implicit-токен (`response_type=token` → `blank.html#access_token=…`) привязан к **IP устройства**.
Запросы `photos.*` идут с **IP backend** → ошибка
`access_token was given to another ip address`.

Server-side OAuth (`response_type=code`): обмен code→token делает backend → токен привязан к IP сервера.

## Кабинет приложения (classic oauth.vk.com)

По умолчанию используется **classic** (не VK ID): страница `id.vk.com` у mini-app часто даёт «Ошибка загрузки».

1. [Управление приложениями](https://vk.com/apps?act=manage) → приложение `54689021` → **Настройки**.
2. Скопируйте **Защищённый ключ** → `VK_OAUTH_CLIENT_SECRET` в `/opt/avtovozom/.env`.
3. В **Authorized redirect URI** / базовый домен добавьте **точно**:

```text
https://api.avtovozom.com/admin/integrations/vk/oauth/callback
```

Локально: `http://localhost:8000/admin/integrations/vk/oauth/callback`.

4. `docker compose -f docker-compose.prod.yml up -d backend`

Опционально `VK_OAUTH_MODE=vkid` — только если classic недоступен и в VK ID заведён Trusted redirect.

## Переменные

```env
VK_GROUP_ID=34626704
VK_GROUP_ACCESS_TOKEN=vk1.a....
VK_API_VERSION=5.199
VK_OAUTH_CLIENT_ID=54689021
VK_OAUTH_CLIENT_SECRET=  # обязателен для classic
# VK_OAUTH_MODE=classic
# VK_OAUTH_REDIRECT_URI=https://api.avtovozom.com/admin/integrations/vk/oauth/callback
PUBLIC_API_ORIGIN=https://api.avtovozom.com
```

Миграция: `backend/migrations/022_app_settings.sql` (или `create_all` при старте backend).

## API

- `GET /admin/integrations/vk` — статус + `oauth_redirect_uri` / `oauth_mode`
- `POST /admin/integrations/vk/oauth/start` — `{ return_to }` → `{ authorize_url }`
- `GET /admin/integrations/vk/oauth/callback` — redirect от VK, сохраняет токен в БД
- `PUT /admin/integrations/vk/user-token` — ручная вставка (fallback, обычно ломается из‑за IP)
- `GET /admin/cars/{id}/vk-compose` / `POST /admin/cars/{id}/vk/publish`

Учёт: `car_external_publications` с `channel=vk`.
