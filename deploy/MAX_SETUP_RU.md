# Публикация объявлений в канал MAX

Интеграция через [MAX Bot API](https://dev.max.ru/docs-api): бэкенд отправляет пост напрямую в публичный канал (без n8n). Админка: **Пост в соцсети** (`/staff/publish-social/{id}`) — чекбокс **MAX-канал**.

## Предварительные условия

1. Верифицированный профиль в **MAX для бизнеса**
2. **Чат-бот** с токеном API
3. Бот — **администратор** публичного канала, куда публикуем
4. Числовой **`chat_id`** канала

## 1. Токен бота

**MAX для бизнеса** → **Чат-боты** → ваш бот → **Расширенные настройки** → **Настроить** → скопировать access token.

```env
MAX_BOT_TOKEN=...
```

Токен передаётся в заголовке `Authorization` (без префикса `Bearer`).

## 2. chat_id канала

Бот должен быть админом канала. Способы узнать `chat_id`:

### Через API (до июня 2026)

```bash
curl -s "https://platform-api2.max.ru/chats" \
  -H "Authorization: ВАШ_BOT_TOKEN"
```

Найдите канал в списке и поле `chat_id`.

### Через админку avtovozom (после деплоя)

```http
GET /admin/integrations/max/chats
Authorization: Bearer <admin JWT>
```

Требуется только `MAX_BOT_TOKEN` в `.env`.

```env
MAX_CHANNEL_CHAT_ID=123456789
```

## 3. Переменные окружения

```env
MAX_BOT_TOKEN=
MAX_CHANNEL_CHAT_ID=
# опционально:
# MAX_API_BASE=https://platform-api2.max.ru
# MAX_MAX_PHOTOS=10
```

На prod — в `.env` рядом с `docker-compose.prod.yml` (см. `deploy/env.production.example`).

## 4. Smoke-test

```bash
curl -X POST "https://platform-api2.max.ru/messages?chat_id=ВАШ_CHAT_ID" \
  -H "Authorization: ВАШ_BOT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"text":"Тест Avtovozom","notify":true}'
```

Ответ `200` с объектом `message` — канал и токен настроены верно.

## 5. Публикация из админки

1. Откройте `/staff/publish-social/{car_id}`
2. Выберите фото и текст (можно сгенерировать через ИИ)
3. Отметьте **MAX-канал**
4. **Опубликовать**

Пост уходит с фото (прямые URL с `api.avtovozom.com`; при ошибке — fallback через `POST /uploads`) и кнопкой «Открыть на сайте».

Статус сохраняется в `car_external_publications` (`channel=max`).

## 6. API (для отладки)

| Метод | Путь |
|-------|------|
| GET | `/admin/integrations/max` |
| GET | `/admin/integrations/max/chats` |
| GET | `/admin/cars/{id}/max-compose` |
| POST | `/admin/cars/{id}/max/publish` |

Тело publish: `{ "text": "...", "photo_ids": [1,2], "attach_listing_link": true }`

## 7. TLS / сертификат Минцифры

Запросы к `platform-api2.max.ru` используют `backend/app/certs/russian_trusted_ca.pem` (как для ВТБ), если файл есть в образе backend.

## 8. Лимиты MAX

- Не более **2 сообщений/сек** в один канал
- До **30 rps** на API
- Текст поста до **4000** символов
- До **10** фото в одном посте (настраивается `MAX_MAX_PHOTOS`)

## 9. Деплой

1. Добавить env на сервер
2. Merge в `main`, затем `scripts/deploy-to-prod.sh`
3. Проверить публикацию тестового объявления

## Следующие шаги (не в MVP)

- Автопостинг через social agent (n8n)
- Хранение `chat_id` в `app_settings` вместо env
