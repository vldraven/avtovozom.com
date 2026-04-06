# Git + автодеплой + домен avtovozom.com

**Если вы не разработчик** — откройте пошаговую инструкцию: [POLNYJ_PLAN_DLYA_STARTA.md](POLNYJ_PLAN_DLYA_STARTA.md). Отдельно про выкладку на прод: [INSTRUKCIYA_DEPLOY_PROSTYM_YAZYKOM.md](INSTRUKCIYA_DEPLOY_PROSTYM_YAZYKOM.md).

Ассистент **не может** сам зайти на ваш VPS: деплой делается **вы** (один раз сервер) и **GitHub Actions** (после настройки секретов).

## Часть A. Git и GitHub

### 1. На Mac, в корне проекта

```bash
cd /Users/vladislavgusynin/Documents/avtovozom.com
git status   # уже инициализировано в репозитории — см. ниже
```

Если репозитория ещё нет:

```bash
git init
git add -A
git commit -m "Initial commit"
```

### 2. Создать репозиторий на GitHub

- [github.com/new](https://github.com/new) — имя, например `avtovozom`, **без** README (чтобы не конфликтовало).

### 3. Привязать remote и запушить

```bash
git branch -M main
git remote add origin git@github.com:ВАШ_ЛОГИН/avtovozom.git
git push -u origin main
```

(Если используете HTTPS — подставьте URL с токеном или логином.)

Дальше любые изменения: `git add`, `git commit`, `git push origin main` — после пуша в **main** сработает workflow **Deploy production** (если секреты заданы).

---

## Часть B. Ключ только для GitHub → сервер (не ваш личный)

На **Mac**:

```bash
ssh-keygen -t ed25519 -f ~/.ssh/avtovozom_deploy -N "" -C "github-actions-deploy"
cat ~/.ssh/avtovozom_deploy.pub
```

На **сервере** (под своим пользователем, часто `root`):

```bash
mkdir -p ~/.ssh && chmod 700 ~/.ssh
nano ~/.ssh/authorized_keys
```

В конец файла вставьте **одну строку** из `avtovozom_deploy.pub`, сохраните. Права:

```bash
chmod 600 ~/.ssh/authorized_keys
```

Проверка с Mac:

```bash
ssh -i ~/.ssh/avtovozom_deploy root@91.196.33.68
```

Должно пускать без пароля.

### Секреты в GitHub

Репозиторий → **Settings → Secrets and variables → Actions → New repository secret**:

| Имя | Значение |
|-----|----------|
| `DEPLOY_HOST` | `91.196.33.68` (или домен, если резолвится) |
| `DEPLOY_USER` | `root` (или ваш пользователь) |
| `DEPLOY_PATH` | `/opt/avtovozom` (каталог с проектом на сервере) |
| `DEPLOY_SSH_KEY` | **полное** содержимое **приватного** ключа `~/.ssh/avtovozom_deploy` (включая `BEGIN` / `END`) |

После пуша в `main` смотрите **Actions** → вкладка workflow → логи.

### Если деплой падает с exit code 255

Чаще всего виноват **SSH**, а не Docker.

1. **`DEPLOY_SSH_KEY` — это именно приватный ключ**  
   Файл **без** расширения `.pub`. Первая строка должна быть одной из:
   - `-----BEGIN OPENSSH PRIVATE KEY-----`
   - `-----BEGIN RSA PRIVATE KEY-----`  
   Если первая строка начинается с `ssh-ed25519` или `ssh-rsa` — вы скопировали **публичный** ключ (`.pub`). Нужно содержимое **`avtovozom_deploy`**, не `avtovozom_deploy.pub`.

2. **Вставка в GitHub**  
   Вставьте ключ целиком, **без** кавычек вокруг всего текста. Не добавляйте пробелы до первой `-----BEGIN` и после последней `-----END`; при копировании с Windows лишние `\r` workflow убирает.

3. **Публичный ключ на сервере**  
   На VPS в `~/.ssh/authorized_keys` пользователя из `DEPLOY_USER` должна быть **ровно та** строка, что в `cat ~/.ssh/avtovozom_deploy.pub` (для той же пары ключей).

4. **Проверка с Mac** (тот же ключ, что в секрете):
   ```bash
   ssh -i ~/.ssh/avtovozom_deploy -o BatchMode=yes "${DEPLOY_USER}@${DEPLOY_HOST}" "echo ok"
   ```
   Если здесь «Permission denied» — Actions тоже не зайдут, пока не поправите ключи на сервере или секрет.

5. **Остальные секреты**  
   `DEPLOY_HOST` — IP или хост без `ssh://` и без `root@`.  
   `DEPLOY_PATH` — например `/opt/avtovozom`, **без** кавычек; каталог на сервере должен существовать и быть доступен этому пользователю на запись.

После правок секретов: **Actions → Deploy production → Re-run failed jobs** (или новый пуш в `main`).

---

## Часть C. Сервер один раз перед первым деплоем

На VPS должны быть: Docker, каталог проекта, **`.env`** (не в git), пустая или с данными **`media/`**.

```bash
mkdir -p /opt/avtovozom/media
# .env создайте вручную: cp .env.example .env && nano .env
```

Первый раз можно залить код вручную (`rsync`) или дождаться успешного GitHub Action после пуша.

---

## Часть D. Домен avtovozom.com

### 1. DNS в REG.RU (редактор **зоны**, не «свои NS»)

| Тип | Имя | Значение |
|-----|-----|----------|
| A | `@` | IP сервера |
| A | `www` | тот же IP |
| A | `api` | тот же IP |

### 2. Caddy на сервере

Пример: [Caddyfile](Caddyfile) — скопировать в `/etc/caddy/Caddyfile`, указать **email** в блоке `{ email ... }`, проверить:

```bash
sudo caddy validate --config /etc/caddy/Caddyfile
sudo systemctl reload caddy
```

Сайт: `https://avtovozom.com`, API: `https://api.avtovozom.com`. В `.env` на сервере должны быть `NEXT_PUBLIC_API_URL`, `CORS_ORIGINS`, `PUBLIC_WEB_ORIGIN` под эти URL (см. [deploy/env.production.example](./env.production.example)).

### 3. Firewall

Открыты **22, 80, 443**; **3000 и 8000** снаружи не открывать — только за Caddy на `127.0.0.1`.

---

## Быстрый деплой после настройки

1. Локально: `git commit`, `git push origin main`.
2. GitHub Actions выполнит rsync и `docker compose -f docker-compose.prod.yml up -d --build`.

Локально без GitHub: [`scripts/deploy-to-prod.sh`](../scripts/deploy-to-prod.sh) с `DEPLOY_HOST` / `DEPLOY_USER` / `DEPLOY_PATH`.
