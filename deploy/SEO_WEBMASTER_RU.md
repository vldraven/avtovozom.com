# SEO: Яндекс.Вебмастер и Google Search Console

Краткий чеклист кабинетов. Ежедневный IndexNow по каталогу, API переобхода и отчёт в Telegram — в [SEO_AUTOMATION_RU.md](SEO_AUTOMATION_RU.md).

## 1. Sitemap

1. [Яндекс.Вебмастер](https://webmaster.yandex.ru/) → сайт **avtovozom.com** → **Индексирование** → **Файлы Sitemap**.
2. Добавить URL: `https://avtovozom.com/sitemap.xml`
3. В [Google Search Console](https://search.google.com/search-console) → **Sitemap** → тот же URL.

Sitemap генерируется динамически и включает главную, каталог, лендинги и все активные объявления с `<lastmod>`.

## 2. Переобход важных страниц

После настройки `YANDEX_WEBMASTER_TOKEN` парсер ставит главную, лендинги и топ хабов в очередь переобхода сам (квота API, не весь каталог). Разово в кабинете это по-прежнему можно сделать вручную:

| URL | Зачем |
|-----|--------|
| `https://avtovozom.com/` | Главная (SSR, список авто) |
| `https://avtovozom.com/catalog` | Корень каталога |
| `https://avtovozom.com/about` | О компании |
| `https://avtovozom.com/contacts` | Контакты / реквизиты |
| Хаб популярной марки/модели | Раздел с объявлениями |

Не отправляйте сотни URL вручную — для карточек работает **IndexNow** (весь активный каталог раз в сутки + пинг при создании/снятии). Ключ в `.env`, файл `https://avtovozom.com/indexnow-key.txt`.

## 3. Проверка IndexNow

```bash
curl -s https://avtovozom.com/indexnow-key.txt
# должен вернуть значение INDEXNOW_KEY из .env
```

После импорта объявления парсером — в логах backend/parser:

```bash
docker logs avtovozom_backend 2>&1 | grep -i indexnow | tail -5
```

## 4. www → без www

На сервере в `/etc/caddy/Caddyfile` должны быть два блока (см. `deploy/Caddyfile` в репозитории). После обновления:

```bash
sudo caddy validate --config /etc/caddy/Caddyfile
sudo systemctl reload caddy
```

Проверка:

```bash
curl -sI https://www.avtovozom.com/catalog | grep -i location
# Location: https://avtovozom.com/catalog
```

## 5. Мониторинг (раз в 1–2 недели)

- **Вебмастер** → Индексирование → «Страницы в поиске», «Исключённые».
- **Вебмастер** → Диагностика → «Дубли title/description».
- **PageSpeed Insights** для главной и карточки объявления (LCP, CLS).
