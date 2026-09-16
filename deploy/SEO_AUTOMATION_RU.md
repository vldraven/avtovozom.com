# SEO-автоматизация: IndexNow, переобход Вебмастера, отчёт в Telegram

После merge этого PR и деплоя `origin/main` парсер сам, раз в сутки по московскому времени:

1. Отправляет в **IndexNow** все URL активного каталога (главная, лендинги, хабы с объявлениями, карточки). Это закрывает дыру: старые машины раньше не пинговались, только новые/изменённые.
2. Ставит в **Яндекс.Вебмастер → Переобход** до 15 приоритетных URL (квота API маленькая — сотни карточек туда не отправляем).
3. Раз в календарную неделю (ISO, с понедельника) пишет **краткий отчёт** в тот же Telegram-чат, что и заявки (`TELEGRAM_ADMIN_CHAT_ID`).

IndexNow ≠ позиции в поиске. Рост выдачи по-прежнему от Яндекс Бизнеса, уникальных текстов хабов и упоминаний вне сайта. Директ SEO не поднимает — его можно подключить отдельно позже.

Состояние джобов: файл `media/.seo_jobs_state.json` (rsync/деплой его не затирает).

---

## Что сделать вам после merge

### 1. Задеплоить и один раз прогнать каталог

На сервере, из каталога с `docker-compose.prod.yml`:

```bash
docker compose -f docker-compose.prod.yml exec parser python -m app.seo_jobs full-indexnow
```

Ожидаем HTTP 200/202 и число URL около размера sitemap (~700). Логи:

```bash
docker logs avtovozom_parser 2>&1 | grep -iE 'indexnow|seo ' | tail -20
```

Ключ IndexNow уже должен быть в `.env` (`INDEXNOW_KEY`); файл `https://avtovozom.com/indexnow-key.txt` уже отдаётся.

Без этого разового запуска полный каталог уйдёт в IndexNow только после 07:00 МСК следующего дня (см. `SEO_JOBS_HOUR_MSK`).

### 2. Токен Яндекс.Вебмастера (переобход API)

Пока `YANDEX_WEBMASTER_TOKEN` пустой, переобход через API **выключен** (IndexNow и отчёт работают). Квота переобхода маленькая: не больше ~10–15 URL в сутки — этого хватает на главную, лендинги и топ хабов.

**Как получить токен (один раз, под ваш аккаунт Вебмастера):**

1. Войдите в тот Яндекс-аккаунт, которым подтверждён **avtovozom.com** в [Вебмастере](https://webmaster.yandex.ru/).
2. Создайте приложение: [oauth.yandex.ru/client/new](https://oauth.yandex.ru/client/new)
   - Платформа: **Веб-сервисы**
   - Redirect URI: `https://oauth.yandex.ru/verification_code`
   - Доступ: **Яндекс.Вебмастер** (чтение данных сайта + постановка страниц на переобход)
3. Скопируйте **ClientID** приложения.
4. Откройте в браузере (подставьте ClientID):

   ```
   https://oauth.yandex.ru/authorize?response_type=token&client_id=CLIENT_ID
   ```

5. Разрешите доступ. На странице «код подтверждения» в URL после `#access_token=` будет токен. Скопируйте его целиком.
6. На сервере в `/opt/avtovozom/.env` (или где лежит прод-`.env`) добавьте:

   ```
   YANDEX_WEBMASTER_TOKEN=сюда_токен
   ```

   Обычно `host_id` находится сам (`https:avtovozom.com:443`). Если нет — явно:

   ```
   YANDEX_WEBMASTER_HOST_ID=https:avtovozom.com:443
   ```

7. Перезапустите парсер (пересборка web не нужна):

   ```bash
   docker compose -f docker-compose.prod.yml up -d parser
   docker compose -f docker-compose.prod.yml exec parser python -m app.seo_jobs hosts
   docker compose -f docker-compose.prod.yml exec parser python -m app.seo_jobs recrawl
   ```

`hosts` печатает `user_id` и выбранный `host_id`. Если список пустой — сайт не привязан к этому аккаунту или токен без права webmaster.

Sitemap по-прежнему добавляется **вручную** один раз: Вебмастер → Индексирование → Файлы Sitemap → `https://avtovozom.com/sitemap.xml`. Это не заменяет этот PR.

### 3. Telegram-отчёт

Отдельный чат не нужен, если заявки уже приходят. Проверьте, что в `.env` есть те же:

```
TELEGRAM_BOT_TOKEN=...
TELEGRAM_ADMIN_CHAT_ID=...
```

Парсер раньше эти переменные не видел — в compose они проброшены. После деплоя:

```bash
docker compose -f docker-compose.prod.yml exec parser python -m app.seo_jobs report
```

Должно прийти сообщение «SEO Avtovozom — еженедельный отчёт». Если `exit code 2` — нет токена/chat id **внутри контейнера parser**.

Автоотправка — в первый тик новой ISO-недели после `SEO_JOBS_HOUR_MSK` (обычно понедельник утром).

### 4. Не обязательно сразу

| Задача | Зачем | Когда |
|--------|--------|--------|
| Яндекс Бизнес, NAP как на `/contacts` | Локальная выдача и доверие хосту | Вручную, кабинет |
| Уникальные тексты живых model-хабов | Иначе хабы thin content | Контент, не этот PR |
| Гайд `/kak-privezti-avto-iz-kitaya` | Информационный спрос | Контент |
| Реклама в Директе по бренду | Трафик, не SEO | Бюджет, позже |
| Google Search Console | Дубль sitemap | По желанию |

---

## Команды и переменные

```bash
python -m app.seo_jobs              # tick (то же, что воркер)
python -m app.seo_jobs full-indexnow
python -m app.seo_jobs recrawl
python -m app.seo_jobs report
python -m app.seo_jobs hosts
```

| Переменная | Смысл | По умолчанию |
|------------|--------|----------------|
| `INDEXNOW_KEY` | Ключ протокола, тот же что в `/indexnow-key.txt` | выкл. если пусто |
| `PUBLIC_WEB_ORIGIN` | Канонический origin URL | — |
| `YANDEX_WEBMASTER_TOKEN` | OAuth Вебмастера | переобход выкл. |
| `YANDEX_WEBMASTER_HOST_ID` | `https:avtovozom.com:443` | авто |
| `YANDEX_WEBMASTER_USER_ID` | uid владельца токена | авто `GET /v4/user` |
| `SEO_JOBS_ENABLED` | `0` — не тикать из воркера | `1` |
| `SEO_JOBS_HOUR_MSK` | Не раньше этого часа МСК | `7` |
| `SEO_RECRAWL_MAX` | Потолок URL в Вебмастер/сутки | `15` |
| `TELEGRAM_BOT_TOKEN` / `TELEGRAM_ADMIN_CHAT_ID` | Отчёт | как у заявок |

Ручной чеклист кабинетов (sitemap, www, PageSpeed): `deploy/SEO_WEBMASTER_RU.md`.
