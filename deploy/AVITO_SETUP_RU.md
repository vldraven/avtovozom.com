# Настройка Avito Autoload для avtovozom

Пошаговая инструкция перед включением публикации объявлений на Avito из админки.

## 1. Аккаунт и тариф

1. Зарегистрируйте **профессиональный** аккаунт Avito.
2. Убедитесь, что тариф позволяет размещения в категории **«Автомобили»**.

## 2. Автозагрузка

1. Откройте [autoload.avito.ru](https://autoload.avito.ru/) или раздел «Автозагрузка» в кабинете.
2. Подключите автозагрузку для аккаунта.
3. В настройках профиля укажите **URL фида**:

   ```
   https://api.avtovozom.com/integrations/avito/feed.xml?secret=<AVITO_FEED_SECRET>
   ```

   Значение `AVITO_FEED_SECRET` — длинная случайная строка из `.env` (см. ниже).

4. Укажите контактный телефон и email для отчётов о загрузках.

## 3. OAuth-приложение

1. **Настройки → Avito API → Регистрация приложения**.
2. Получите `client_id` и `client_secret`.
3. Тип авторизации для серверной интеграции: **client_credentials**.

## 4. Переменные окружения

Добавьте в `.env` на сервере (см. также `deploy/env.production.example`):

```bash
AVITO_CLIENT_ID=
AVITO_CLIENT_SECRET=
AVITO_USER_ID=                    # опционально; иначе определяется через /core/v1/accounts/self
AVITO_FEED_SECRET=                # openssl rand -hex 32
AVITO_DEFAULT_REGION=Москва
AVITO_DEFAULT_CONTACT_PHONE=+7...
AVITO_CAR_TYPE=С пробегом
```

После первого запуска с валидными credentials backend может записать `AVITO_USER_ID` в лог при обращении к API.

## 5. Проверка фида

1. Опубликуйте тестовое объявление из админки: **«На Avito»** на карточке авто.
2. Откройте URL фида в браузере (с секретом) — должен вернуться XML с одним `<Ad>`.
3. Прогоните XML через [валидатор Avito](https://autoload.avito.ru/format/xmlcheck/).
4. В кабинете Autoload запустите загрузку или дождитесь расписания; статус смотрите в админке avtovozom (кнопка «Обновить статус»).

## 6. Ограничения

- Запуск загрузки через API (`POST /autoload/v1/upload`) — **не чаще 1 раза в час**.
- Фото должны быть доступны по публичному HTTPS (`PUBLIC_API_ORIGIN`).
- Поддержка: supportautoload@avito.ru (укажите URL запроса в описании проблемы).

## 7. Документация API

- [Каталог API](https://developers.avito.ru/api-catalog)
- [Autoload](https://developers.avito.ru/api-catalog/autoload/documentation)
- [Формат XML для авто](https://autoload.avito.ru/format/)
