# Публикация объявлений в группу VK

Админка: карточка объявления → **В VK** → `/staff/publish-vk/{id}`.

Backend вызывает VK API напрямую (без n8n): загрузка фото на стену + `wall.post` от имени сообщества.

## Что нужно в VK

1. **Сообщество (группа)** — ID без минуса, например `123456789` (в API `owner_id=-123456789`).
2. **Standalone-приложение** на [dev.vk.com](https://dev.vk.com/) (или VK ID).
3. **User access token** пользователя, который **админ или редактор** группы.

   Нужны права (scopes): `photos`, `wall`, желательно `offline` (долгий токен).

   Важно: для загрузки фото на стену **community (group) token обычно не подходит** (ошибка 27 на `photos.getWallUploadServer`). Нужен именно **user token**.

   Право `wall` у пользовательских токенов VK иногда выдаётся ограниченно — при отказе пишите в поддержку VK / проверяйте Implicit Flow со `scope=photos,wall,offline,groups`.

Пример Implicit Flow (подставьте `client_id` приложения):

```
https://oauth.vk.com/authorize?client_id=APP_ID&display=page&redirect_uri=https://oauth.vk.com/blank.html&scope=photos,wall,offline,groups&response_type=token&v=5.199
```

После редиректа скопируйте `access_token` из фрагмента URL.

## Переменные окружения

В `.env` на сервере (и в `docker-compose.prod.yml` они пробрасываются в backend):

```env
VK_GROUP_ID=123456789
VK_USER_ACCESS_TOKEN=vk1.a....
VK_API_VERSION=5.199
```

Перезапустите backend после изменения `.env`.

## Ручная проверка (spike)

С машины, где есть доступ к API и токену:

```bash
cd backend
export VK_GROUP_ID=...
export VK_USER_ACCESS_TOKEN=...
PYTHONPATH=. python -m scripts.test_vk_wall_post --message "Тест avtovozom"
# с фото:
PYTHONPATH=. python -m scripts.test_vk_wall_post --message "Тест" --photo "https://avtovozom.com/media/..."
```

Ожидается строка `OK post_id=… url=https://vk.com/wall-…_…`.

## API

- `GET /admin/cars/{id}/vk-compose` — данные карточки, шаблон текста, статус прошлой публикации.
- `POST /admin/cars/{id}/vk/publish` — тело `{ "text", "photo_ids": [], "attach_listing_link": true }`.

Учёт: строка в `car_external_publications` с `channel=vk` (`avito_item_id` = post_id, `avito_url` = URL поста).

## Ограничения

- До 10 вложений на пост (фото + опционально ссылка на сайт).
- Токен пользователя нужно хранить в секретах и ротировать при компрометации.
- Массовая автопубликация из плана импорта в первой версии не делается — только ручная кнопка админа.
