# Первый запуск в продакшене

Краткая цепочка: DNS → сервер (Docker, firewall) → `.env` → `docker-compose.prod.yml` → Caddy → проверка. Повторные обновления кода — в [DEPLOY_WORKFLOW.md](DEPLOY_WORKFLOW.md).

## 1. DNS (REG.RU)

В **редакторе DNS-зоны** домена (не раздел «свои NS-серверы»):

| Тип | Имя / поддомен | Значение |
|-----|----------------|----------|
| A | `@` (корень) | IP вашего VPS |
| A | `www` | тот же IP |
| A | `api` | тот же IP |

Дождаться резолва: `ping api.avtovozom.com` → ваш IP.

## 2. Сервер

- Ubuntu/Debian: обновления, пользователь, SSH по ключу.
- Firewall (`ufw`): разрешить **22**, **80**, **443**; порты 3000 и 8000 снаружи не открывать — к ним только Caddy на localhost.
- Установить [Docker Engine](https://docs.docker.com/engine/install/) и плагин Compose.

## 3. Код и каталог

Скопируйте репозиторий на сервер, например в `/opt/avtovozom` (`rsync`, `scp` или `git clone`). Создайте каталог `media` если его нет:

```bash
mkdir -p /opt/avtovozom/media
```

## 4. Файл `.env` в корне проекта

Скопируйте с сервера из `.env.example` и заполните. Обязательно для прод:

| Переменная | Назначение |
|------------|------------|
| `POSTGRES_PASSWORD` | Сильный пароль БД (и при необходимости `POSTGRES_USER` / `POSTGRES_DB`) |
| `NEXT_PUBLIC_API_URL` | Публичный URL API, например `https://api.avtovozom.com` |
| `CORS_ORIGINS` | Список через запятую: `https://avtovozom.com,https://www.avtovozom.com` |
| `PUBLIC_WEB_ORIGIN` | `https://avtovozom.com` |
| `SMTP_*` | Для реальной отправки кодов регистрации (без `SMTP_HOST` письма только в лог backend) |

Если в пароле БД есть символы `@ : / ? #`, их нужно **URL-кодировать** в части пароля внутри строки подключения — проще задать пароль без спецсимволов или использовать [encoding](https://www.postgresql.org/docs/current/libpq-connect.html#LIBPQ-CONNSTRING).

Файл `.env` не коммитить.

## 5. Запуск приложения

```bash
cd /opt/avtovozom
docker compose -f docker-compose.prod.yml up -d --build
docker compose -f docker-compose.prod.yml ps
```

Логи: `docker compose -f docker-compose.prod.yml logs -f web` (и `backend`).

## 6. HTTPS (Caddy)

1. Установите Caddy пакетом дистрибутива или по [официальной инструкции](https://caddyserver.com/docs/install).
2. Скопируйте [Caddyfile](Caddyfile) в конфиг Caddy (часто `/etc/caddy/Caddyfile`), замените `you@example.com` на ваш email для Let’s Encrypt и при необходимости имена хостов.
3. Проверка конфига и перезагрузка:

```bash
sudo caddy validate --config /etc/caddy/Caddyfile
sudo systemctl reload caddy
```

Откройте в браузере `https://avtovozom.com` и `https://api.avtovozom.com/docs`.

## 7. Бэкапы

Настройте периодический `pg_dump` из контейнера `avtovozom_postgres` и копирование каталога `media/` — см. команды в документации PostgreSQL/Docker.

## Локальная разработка

**`docker compose up`** (без prod-файла): сервис `web` собирается из [`web/Dockerfile.dev`](../web/Dockerfile.dev) (`next dev` с hot reload). Прод-образ фронта — из [`web/Dockerfile`](../web/Dockerfile) (`next build` + `next start`), его использует только **`docker-compose.prod.yml`**.

Проверка прод-стека локально: заполните `.env` (в т.ч. `POSTGRES_PASSWORD`) и выполните `docker compose -f docker-compose.prod.yml up -d --build`.
