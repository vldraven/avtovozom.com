# Как выкатывать изменения в прод

Цель: один предсказуемый способ обновить код на VPS и пересобрать контейнеры, не затирая секреты и пользовательские данные.

**Рекомендуемый поток:** пуш в ветку `main` на GitHub → workflow [Deploy production](../.github/workflows/deploy-production.yml) (нужны секреты, см. [GITHUB_AND_DOMAIN.md](GITHUB_AND_DOMAIN.md)).

## Что нельзя затирать при деплое

| Путь на сервере | Почему |
|-----------------|--------|
| `.env` | Пароли БД, SMTP, URL продакшена |
| `media/` | Загруженные фото объявлений и вложения |
| Том Docker `postgres_data` | База (живёт в volume, не в каталоге проекта) |

Скрипт [`scripts/deploy-to-prod.sh`](../scripts/deploy-to-prod.sh) **исключает** `.env` и `media` из синхронизации.

## Вариант 1 — с Mac/ПК: rsync + Docker (рекомендуем для старта)

1. Один раз настроить SSH-ключ к серверу (`ssh root@ВАШ_IP`).
2. Задать переменные окружения (можно в `~/.zshrc` или перед вызовом):

```bash
export DEPLOY_HOST=91.196.33.68
export DEPLOY_USER=root
export DEPLOY_PATH=/opt/avtovozom
```

3. Из корня репозитория:

```bash
chmod +x scripts/deploy-to-prod.sh
./scripts/deploy-to-prod.sh
```

Скрипт: копирует код на сервер, затем по SSH выполняет `docker compose -f docker-compose.prod.yml up -d --build`, если в корне есть [`docker-compose.prod.yml`](../docker-compose.prod.yml), иначе — обычный `docker compose up`.

**Ветка и качество:** перед `./scripts/deploy-to-prod.sh` имеет смысл мержить в `main` только то, что прошло `npm run build` (web) и локально проверено.

## Вариант 2 — Git прямо на сервере

На VPS один раз: `git clone` (или bare + hook), настроить deploy key для приватного репозитория.

Дальше на сервере:

```bash
cd /opt/avtovozom && git pull && docker compose -f docker-compose.prod.yml up -d --build
```

Плюс: не нужен rsync с ноутбука. Минус: на сервере должен быть доступ к git и аккуратность с `.env` (в `.gitignore`, не коммитить).

## Вариант 3 — CI/CD (GitHub Actions / GitLab CI)

Идея: по пушу в `main` или по кнопке **Run workflow** runner подключается по SSH к VPS и выполняет те же шаги, что скрипт.

Нужны секреты в репозитории:

- `DEPLOY_SSH_KEY` — приватный ключ (только для деплоя, не ваш личный)
- `DEPLOY_HOST`, `DEPLOY_USER`, `DEPLOY_PATH`

Пример job (упрощённо):

```yaml
on:
  workflow_dispatch:
  push:
    branches: [main]

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: rsync
        run: |
          mkdir -p ~/.ssh
          echo "${{ secrets.DEPLOY_SSH_KEY }}" > ~/.ssh/id_ed25519
          chmod 600 ~/.ssh/id_ed25519
          rsync -avz --delete \
            -e "ssh -o StrictHostKeyChecking=accept-new" \
            --exclude '.git' --exclude 'node_modules' --exclude 'web/.next' \
            --exclude '__pycache__' --exclude '.env' --exclude 'media' \
            ./ ${{ secrets.DEPLOY_USER }}@${{ secrets.DEPLOY_HOST }}:${{ secrets.DEPLOY_PATH }}/
      - name: compose
        run: |
          ssh -o StrictHostKeyChecking=accept-new ${{ secrets.DEPLOY_USER }}@${{ secrets.DEPLOY_HOST }} \
            "cd ${{ secrets.DEPLOY_PATH }} && (test -f docker-compose.prod.yml && docker compose -f docker-compose.prod.yml up -d --build || docker compose up -d --build)"
```

Скопируйте в `.github/workflows/deploy.yml` и заполните секреты, когда будете готовы.

## Короткий чеклист после каждого деплоя

1. `docker compose ps` на сервере — все сервисы `running`.
2. Открыть сайт и `https://api.…/docs` (или ваш health).
3. При изменениях только в `NEXT_PUBLIC_*` — нужна **пересборка образа web** (скрипт уже делает `--build`).

## Дальше по мере роста

- Отдельный staging-сервер или тот же compose с другим `.env` и портами.
- Теги релизов `v1.2.3` и деплой только с тега.
- Бэкап БД перед деплоем (cron + `pg_dump`), не только после инцидентов.
