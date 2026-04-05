# avtovozom.com (MVP)

Локальный MVP веб-платформы агрегатора авто:
- каталог автомобилей с фото;
- детальная страница автомобиля с галереей, характеристиками и описанием;
- фильтры и поиск;
- заявка на расчет;
- админский ручной запуск парсера;
- ежедневное обновление через отдельный parser service.

## Технологии

- Frontend: Next.js
- Backend: FastAPI + SQLAlchemy
- Database: PostgreSQL
- Infra: Docker Compose

## Быстрый старт

1. Убедитесь, что установлен Docker Desktop.
2. В корне проекта запустите:

```bash
docker compose up --build
```

3. Откройте:
- Web: http://localhost:3000
- API docs: http://localhost:8000/docs

## Базовый сценарий

1. Откройте главную страницу.
2. Выполните вход (по умолчанию):
   - `admin@avtovozom.local`
   - `admin12345`
   - `dealer@avtovozom.local`
   - `dealer12345`
3. Нажмите кнопку `Обновить каталог (парсер)`, чтобы создать/обновить объявления.
4. Используйте поиск и фильтры.
5. Нажмите `Подать заявку на расчет` у выбранного авто.

## Админские API (MVP)

- `GET /admin/model-whitelist`
- `PUT /admin/model-whitelist`
- `POST /admin/parser/run`
- `GET /admin/parser/jobs`

## Auth API (MVP)

- `POST /auth/register`
- `POST /auth/login`
- `GET /auth/me`

## Requests and Offers API (MVP)

- `POST /requests`
- `GET /requests/my`
- `GET /dealer/requests`
- `POST /requests/{id}/offers`
- `GET /requests/{id}/offers`
- `POST /offers/{id}/select`

## Chat API (MVP)

- `GET /chats/my`
- `GET /chats/{chat_id}/messages?limit=50&offset=0`
- `POST /chats/{chat_id}/messages` body: `{ "text": "..." }`

## Карточка авто

- `GET /cars/{id}` возвращает:
  - все доступные фото объявления;
  - характеристики (год, пробег, двигатель, мощность, топливо, трансмиссия, город);
  - описание авто.

## Цены в рублях и таможня

- Курс **CNY → RUB** — по данным [ЦБ РФ](https://www.cbr.ru/scripts/XML_daily.asp) (котировка CNY на дату).
- **Таможенные платежи** на сайте не считаются автоматически (без платных API): в карточке авто — сводка параметров и ссылка на бесплатный [калькулятор ТКС](https://www.tks.ru/auto/calc/) для самостоятельного расчёта.

## Важно

Сейчас парсер реализован как демонстрационный ingestion-worker, который показывает архитектуру и потоки обновления данных. На следующем этапе подключаем реальный интеграционный парсинг источника.
