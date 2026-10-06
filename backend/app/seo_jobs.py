"""Периодические SEO-задачи: IndexNow по всему каталогу, переобход Вебмастера, отчёт в Telegram.

Запуск вручную (в контейнере parser):

  python -m app.seo_jobs              # tick: что положено сегодня
  python -m app.seo_jobs full-indexnow
  python -m app.seo_jobs recrawl
  python -m app.seo_jobs report
  python -m app.seo_jobs hosts

Воркер парсера вызывает tick() раз в цикл; состояние — MEDIA_ROOT/.seo_jobs_state.json.
"""

from __future__ import annotations

import json
import logging
import os
import sys
from collections import defaultdict
from datetime import datetime, timedelta, timezone
from pathlib import Path

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from .db import SessionLocal
from .indexnow import car_url, post_urls_blocking, web_origin
from .models import Car
from .telegram_notify import notify_seo_report
from . import yandex_webmaster as webmaster

try:
    from zoneinfo import ZoneInfo

    MSK = ZoneInfo("Europe/Moscow")
except Exception:  # pragma: no cover
    MSK = timezone(timedelta(hours=3))

logger = logging.getLogger(__name__)

STATIC_PATHS = (
    "/",
    "/catalog",
    "/about",
    "/contacts",
    "/customs-calculator",
    "/dostavka-avto-iz-kitaya",
    "/dostavka-avtovozom-iz-kitaya",
    "/faq",
    "/request-quote",
)

_STATE_NAME = ".seo_jobs_state.json"


def jobs_enabled() -> bool:
    raw = (os.getenv("SEO_JOBS_ENABLED") or "1").strip().lower()
    return raw not in {"0", "false", "no", "off"}


def _min_hour_msk() -> int:
    try:
        return int(os.getenv("SEO_JOBS_HOUR_MSK", "7"))
    except ValueError:
        return 7


def _recrawl_limit() -> int:
    try:
        return max(0, int(os.getenv("SEO_RECRAWL_MAX", "15") or 15))
    except ValueError:
        return 15


def _abs(origin: str, path: str) -> str:
    if not path.startswith("/"):
        path = "/" + path
    return f"{origin.rstrip('/')}{path}"


def _state_path() -> Path:
    return Path(os.getenv("MEDIA_ROOT", "/app/media")) / _STATE_NAME


def load_state() -> dict:
    path = _state_path()
    try:
        raw = path.read_text(encoding="utf-8")
        data = json.loads(raw)
        return data if isinstance(data, dict) else {}
    except FileNotFoundError:
        return {}
    except Exception as exc:  # noqa: BLE001
        logger.warning("SEO state: не прочитали %s: %s", path, exc)
        return {}


def save_state(state: dict) -> None:
    path = _state_path()
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        tmp = path.with_suffix(".tmp")
        tmp.write_text(json.dumps(state, ensure_ascii=False, indent=2), encoding="utf-8")
        tmp.replace(path)
    except Exception as exc:  # noqa: BLE001
        logger.warning("SEO state: не записали %s: %s", path, exc)


def _iso_week_key(now: datetime) -> str:
    iso = now.isocalendar()
    return f"{iso.year}-W{iso.week:02d}"


def _attempt_fresh(iso_ts: str | None, *, minutes: int = 30) -> bool:
    if not iso_ts:
        return True
    try:
        last = datetime.fromisoformat(iso_ts)
        if last.tzinfo is None:
            last = last.replace(tzinfo=timezone.utc)
    except ValueError:
        return True
    return datetime.now(timezone.utc) - last >= timedelta(minutes=minutes)


def hub_counts(db: Session) -> tuple[dict[int, int], dict[tuple[int, int], int]]:
    """Сколько активных объявлений у марки и у пары марка+модель."""
    rows = db.execute(
        select(Car.brand_id, Car.model_id, func.count())
        .where(Car.is_active.is_(True))
        .group_by(Car.brand_id, Car.model_id)
    ).all()
    brands: dict[int, int] = defaultdict(int)
    models: dict[tuple[int, int], int] = {}
    for brand_id, model_id, n in rows:
        count = int(n)
        brands[int(brand_id)] += count
        models[(int(brand_id), int(model_id))] = count
    return dict(brands), models


def collect_indexnow_urls(db: Session, origin: str | None = None) -> list[str]:
    """Те же классы URL, что в sitemap: статика, хабы с объявлениями, активные карточки."""
    origin = (origin or web_origin()).rstrip("/")
    if not origin.startswith("http"):
        return []
    urls: list[str] = [_abs(origin, path) for path in STATIC_PATHS]
    from .catalog_slug import build_catalog_slug_maps

    bmap, mmap = build_catalog_slug_maps(db)
    brand_n, model_n = hub_counts(db)
    for brand_id, _n in sorted(brand_n.items(), key=lambda x: (-x[1], x[0])):
        slug = bmap.get(brand_id)
        if slug:
            urls.append(_abs(origin, f"/catalog/{slug}"))
    for (brand_id, model_id), _n in sorted(model_n.items(), key=lambda x: (-x[1], x[0][0], x[0][1])):
        bslug = bmap.get(brand_id)
        mslug = mmap.get((brand_id, model_id))
        if bslug and mslug:
            urls.append(_abs(origin, f"/catalog/{bslug}/{mslug}"))
    cars = db.execute(select(Car).where(Car.is_active.is_(True)).order_by(Car.id.asc())).scalars().all()
    for car in cars:
        url = car_url(db, car)
        if url:
            urls.append(url)
    return list(dict.fromkeys(urls))


def priority_recrawl_urls(db: Session, origin: str | None = None, *, limit: int | None = None) -> list[str]:
    """Главное + лендинги + самые наполненные хабы. Карточки каталога сюда не входят."""
    origin = (origin or web_origin()).rstrip("/")
    if not origin.startswith("http"):
        return []
    cap = _recrawl_limit() if limit is None else max(0, limit)
    urls: list[str] = [_abs(origin, path) for path in STATIC_PATHS]
    from .catalog_slug import build_catalog_slug_maps

    bmap, mmap = build_catalog_slug_maps(db)
    brand_n, model_n = hub_counts(db)
    for brand_id, _n in sorted(brand_n.items(), key=lambda x: (-x[1], x[0])):
        slug = bmap.get(brand_id)
        if slug:
            urls.append(_abs(origin, f"/catalog/{slug}"))
    for (brand_id, model_id), _n in sorted(model_n.items(), key=lambda x: (-x[1], x[0][0], x[0][1])):
        bslug = bmap.get(brand_id)
        mslug = mmap.get((brand_id, model_id))
        if bslug and mslug:
            urls.append(_abs(origin, f"/catalog/{bslug}/{mslug}"))
    return list(dict.fromkeys(urls))[:cap]


def active_car_count(db: Session) -> int:
    return int(db.execute(select(func.count()).select_from(Car).where(Car.is_active.is_(True))).scalar() or 0)


def run_full_indexnow(db: Session) -> dict:
    origin = web_origin()
    urls = collect_indexnow_urls(db, origin)
    status, detail = post_urls_blocking(urls)
    result = {
        "http_status": status,
        "detail": detail,
        "count": len(urls),
        "skipped": status == 0 and detail.startswith("skip:"),
    }
    logger.info("SEO IndexNow: %s (%s, %d URL)", status, detail, len(urls))
    return result


def run_recrawl(db: Session) -> dict:
    origin = web_origin()
    urls = priority_recrawl_urls(db, origin)
    result = webmaster.recrawl_urls(urls, origin, limit=_recrawl_limit())
    logger.info(
        "SEO recrawl: skipped=%s ok=%s already=%s errors=%s (%s)",
        result.get("skipped"),
        result.get("ok"),
        result.get("already"),
        result.get("errors"),
        result.get("reason") or "ok",
    )
    return result


def build_report(db: Session, state: dict | None = None) -> str:
    state = state or load_state()
    origin = web_origin() or "https://avtovozom.com"
    cars = active_car_count(db)
    idx = state.get("last_indexnow") or {}
    rec = state.get("last_recrawl") or {}
    lines = [
        "SEO Avtovozom — еженедельный отчёт",
        f"Активных объявлений: {cars}",
        f"Сайт: {origin}",
        f"Sitemap: {origin.rstrip('/')}/sitemap.xml",
    ]
    idx_date = state.get("last_indexnow_date") or "—"
    if idx.get("skipped"):
        lines.append(f"IndexNow ({idx_date}): пропуск — {idx.get('detail') or idx.get('reason') or 'нет ключа'}")
    else:
        lines.append(
            f"IndexNow ({idx_date}): HTTP {idx.get('http_status', '—')}, "
            f"{idx.get('count', '—')} URL, {idx.get('detail') or '—'}"
        )
    rec_date = state.get("last_recrawl_date") or "—"
    if rec.get("skipped"):
        lines.append(f"Вебмастер переобход ({rec_date}): выключен — {rec.get('reason') or 'нет токена'}")
    else:
        quota = rec.get("quota") or {}
        lines.append(
            f"Вебмастер переобход ({rec_date}): ok={rec.get('ok', 0)} "
            f"already={rec.get('already', 0)} errors={rec.get('errors', 0)}; "
            f"квота {quota.get('quota_remainder', '—')}/{quota.get('daily_quota', '—')}"
        )
        if rec.get("summary"):
            lines.append(f"Сводка Вебмастера: {rec['summary']}")
        sent = rec.get("sent") or []
        if sent:
            preview = ", ".join(sent[:8])
            extra = f" (+{len(sent) - 8})" if len(sent) > 8 else ""
            lines.append(f"В очереди переобхода: {preview}{extra}")
    lines.append(
        "IndexNow ≠ позиции в выдаче. Для роста нужны Яндекс Бизнес, уникальные тексты хабов "
        "и упоминания вне сайта — см. deploy/SEO_AUTOMATION_RU.md."
    )
    return "\n".join(lines)


def send_report(db: Session, state: dict | None = None) -> dict:
    text = build_report(db, state)
    sent = notify_seo_report(text)
    logger.info("SEO report sent=%s (%d chars)", sent, len(text))
    return {"sent": sent, "text": text}


def tick(now: datetime | None = None) -> dict:
    """Идемпотентный суточный/недельный тик. Безопасен при вызове каждые N секунд."""
    if not jobs_enabled():
        return {"skipped": True, "reason": "SEO_JOBS_ENABLED=0"}
    now = now or datetime.now(MSK)
    if now.tzinfo is None:
        now = now.replace(tzinfo=MSK)
    else:
        now = now.astimezone(MSK)
    if now.hour < _min_hour_msk():
        return {"skipped": True, "reason": "hour"}
    today = now.date().isoformat()
    week = _iso_week_key(now)
    state = load_state()
    out: dict = {"today": today, "week": week, "indexnow": None, "recrawl": None, "report": None}
    need_indexnow = state.get("last_indexnow_date") != today
    need_recrawl = state.get("last_recrawl_date") != today
    need_report = state.get("last_report_week") != week
    if not (need_indexnow or need_recrawl or need_report):
        return {**out, "skipped": True, "reason": "already"}
    db = SessionLocal()
    try:
        if state.get("last_indexnow_date") != today:
            if _attempt_fresh(state.get("last_indexnow_attempt")):
                result = run_full_indexnow(db)
                state["last_indexnow"] = result
                state["last_indexnow_attempt"] = datetime.now(timezone.utc).isoformat()
                if result.get("skipped") or (
                    isinstance(result.get("http_status"), int)
                    and 200 <= int(result["http_status"]) < 300
                ):
                    state["last_indexnow_date"] = today
                out["indexnow"] = result
            else:
                out["indexnow"] = {"skipped": True, "reason": "cooldown"}
        if state.get("last_recrawl_date") != today:
            if _attempt_fresh(state.get("last_recrawl_attempt")):
                result = run_recrawl(db)
                state["last_recrawl"] = {
                    k: result.get(k)
                    for k in ("skipped", "reason", "ok", "already", "errors", "quota", "sent", "summary")
                }
                state["last_recrawl_attempt"] = datetime.now(timezone.utc).isoformat()
                # Нет токена/квоты — не дёргаем API весь день. Сетевые ошибки — повтор через cooldown.
                if result.get("skipped") or result.get("ok") or result.get("already"):
                    state["last_recrawl_date"] = today
                out["recrawl"] = result
            else:
                out["recrawl"] = {"skipped": True, "reason": "cooldown"}
        if state.get("last_report_week") != week:
            result = send_report(db, state)
            state["last_report_week"] = week
            state["last_report"] = {"sent": result["sent"], "at": today}
            out["report"] = {"sent": result["sent"]}
    finally:
        db.close()
    save_state(state)
    return out


def _print_hosts() -> int:
    if not webmaster.enabled():
        print("YANDEX_WEBMASTER_TOKEN не задан", file=sys.stderr)
        return 1
    user_id = webmaster.fetch_user_id()
    if not user_id:
        print("Не удалось получить user_id", file=sys.stderr)
        return 1
    print(f"user_id={user_id}")
    origin = web_origin()
    picked = webmaster.fetch_host_id(user_id, origin)
    for host in webmaster.list_hosts(user_id):
        hid = host.get("host_id")
        mark = "  <- выбран" if hid == picked else ""
        print(f"  {hid}  {host.get('ascii_host_url') or ''}{mark}")
    if picked:
        print(f"YANDEX_WEBMASTER_HOST_ID={picked}")
    return 0


def main(argv: list[str] | None = None) -> int:
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s: %(message)s")
    args = list(sys.argv[1:] if argv is None else argv)
    cmd = (args[0] if args else "tick").strip().lower()
    if cmd in {"-h", "--help", "help"}:
        print(__doc__)
        return 0
    if cmd == "hosts":
        return _print_hosts()
    if cmd in {"tick", "run"}:
        print(json.dumps(tick(), ensure_ascii=False, indent=2))
        return 0
    db = SessionLocal()
    try:
        if cmd in {"full-indexnow", "indexnow"}:
            result = run_full_indexnow(db)
            state = load_state()
            today = datetime.now(MSK).date().isoformat()
            state["last_indexnow"] = result
            state["last_indexnow_date"] = today
            state["last_indexnow_attempt"] = datetime.now(timezone.utc).isoformat()
            save_state(state)
            print(json.dumps(result, ensure_ascii=False, indent=2))
            return 0 if result.get("skipped") or (
                isinstance(result.get("http_status"), int) and result["http_status"] < 400
            ) else 1
        if cmd == "recrawl":
            result = run_recrawl(db)
            state = load_state()
            today = datetime.now(MSK).date().isoformat()
            state["last_recrawl"] = result
            state["last_recrawl_date"] = today
            state["last_recrawl_attempt"] = datetime.now(timezone.utc).isoformat()
            save_state(state)
            print(json.dumps(result, ensure_ascii=False, indent=2, default=str))
            return 0
        if cmd == "report":
            result = send_report(db)
            print(result["text"])
            return 0 if result["sent"] else 2
        print(f"Неизвестная команда: {cmd}", file=sys.stderr)
        print(__doc__, file=sys.stderr)
        return 2
    finally:
        db.close()


if __name__ == "__main__":
    raise SystemExit(main())
