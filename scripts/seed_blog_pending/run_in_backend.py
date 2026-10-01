#!/usr/bin/env python3
"""Сидит статьи блога в pending без пароля (внутри backend-контейнера).

1) Берёт первого admin/moderator из БД
2) Сохраняет обложки через save_blog_image
3) Создаёт editorial-посты со status=pending

Env:
  BLOG_COVERS_DIR  default /tmp/blog-covers
  BLOG_ARTICLES_PY default /tmp/blog-articles.py  (модуль с ARTICLES)
"""

from __future__ import annotations

import importlib.util
import os
import sys
from datetime import datetime
from pathlib import Path

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.blog import _ensure_author, _set_tags, _unique_post_slug
from app.blog_content import normalize_blocks, normalize_tag_names
from app.db import SessionLocal
from app.media_storage import save_blog_image
from app.models import BlogPost, BlogSection, CarBrand, CarModel, Role, User


COVERS = Path(os.environ.get("BLOG_COVERS_DIR", "/tmp/blog-covers"))
ARTICLES_PATH = Path(os.environ.get("BLOG_ARTICLES_PY", "/tmp/blog-articles.py"))

SECTION_BY_KEY = {
    "to": "obsluzhivanie-i-to",
    "review": "obzory-modelej",
}

# brand_name, model_name_candidates (пусто = только бренд)
CATALOG = {
    "a3l": ("Audi", ["A3L"]),
    "q2l-ev": ("Audi", ["Q2L", "Q2"]),
    "q3-35": ("Audi", ["Q3"]),
    "q3-40": ("Audi", ["Q3"]),
    "bmw-320": ("BMW", ["3系", "3 Series", "320", "3Li", "3 Li"]),
    "bmw-325": ("BMW", ["3系", "3 Series", "325", "3Li", "3 Li"]),
    "a06-to": ("Changan", []),
    "corolla": ("Toyota", ["Corolla"]),
    "a180": ("Mercedes-Benz", ["A-Class", "A Class", "A-класс", "A 180", "A180"]),
    "c260": ("Mercedes-Benz", ["C-Class", "C Class", "C-класс", "C 260", "C260"]),
    "cla260": ("Mercedes-Benz", ["CLA"]),
    "gla200": ("Mercedes-Benz", ["GLA"]),
    "a06-review": ("Changan", []),
}

# Fallback brand aliases if exact name missing
BRAND_ALIASES = {
    "Changan": ["Changan", "Чанган", "Qiyuan", "Deepal"],
    "Mercedes-Benz": ["Mercedes-Benz", "Mercedes", "Mercedes Benz", "Мерседес"],
    "Audi": ["Audi", "Ауди"],
    "BMW": ["BMW", "Bmw", "БМВ"],
    "Toyota": ["Toyota", "Тойота"],
}


def load_articles() -> list[dict]:
    spec = importlib.util.spec_from_file_location("blog_articles", ARTICLES_PATH)
    if not spec or not spec.loader:
        raise SystemExit(f"cannot load {ARTICLES_PATH}")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    articles = getattr(mod, "ARTICLES", None)
    if not articles:
        raise SystemExit("ARTICLES empty")
    return list(articles)


def staff_user(db: Session) -> User:
    row = db.execute(
        select(User)
        .join(Role, User.role_id == Role.id)
        .where(Role.code.in_(("admin", "moderator")))
        .order_by(User.id.asc())
    ).scalars().first()
    if not row:
        raise SystemExit("no admin/moderator user in DB")
    return row


def section_id(db: Session, article: dict) -> int | None:
    key = "review" if article.get("section_id") == 2 else "to"
    # Prefer explicit slug if present
    slug = SECTION_BY_KEY[key]
    if article.get("section_id") == 2:
        slug = "obzory-modelej"
    elif article.get("section_id") == 4:
        slug = "obsluzhivanie-i-to"
    row = db.execute(select(BlogSection).where(BlogSection.slug == slug)).scalar_one_or_none()
    return row.id if row else None


def resolve_catalog(db: Session, key: str) -> tuple[int | None, int | None]:
    brand_name, model_names = CATALOG.get(key, (None, []))
    if not brand_name:
        return None, None
    brand = None
    for alias in BRAND_ALIASES.get(brand_name, [brand_name]):
        brand = db.execute(
            select(CarBrand).where(CarBrand.name.ilike(alias))
        ).scalars().first()
        if brand:
            break
    if not brand:
        # fuzzy contains
        brand = db.execute(
            select(CarBrand).where(CarBrand.name.ilike(f"%{brand_name}%"))
        ).scalars().first()
    if not brand:
        print(f"WARN no brand for {key}/{brand_name}")
        return None, None
    if not model_names:
        return brand.id, None
    for needle in model_names:
        model = db.execute(
            select(CarModel).where(
                CarModel.brand_id == brand.id,
                CarModel.name.ilike(f"%{needle}%"),
            )
        ).scalars().first()
        if model:
            return brand.id, model.id
    print(f"WARN no model for {key} brand={brand.name} candidates={model_names}")
    return brand.id, None


def already_exists(db: Session, title: str) -> BlogPost | None:
    return db.execute(
        select(BlogPost).where(BlogPost.title == title).order_by(BlogPost.id.desc())
    ).scalars().first()


def main() -> None:
    if not COVERS.is_dir():
        raise SystemExit(f"missing covers dir {COVERS}")
    if not ARTICLES_PATH.is_file():
        raise SystemExit(f"missing articles {ARTICLES_PATH}")

    articles = load_articles()
    db = SessionLocal()
    try:
        user = staff_user(db)
        print(f"author={user.email} id={user.id}")
        _ensure_author(db, user)
        db.commit()

        cover_cache: dict[str, str] = {}
        results = []
        for article in articles:
            title = article["title"]
            existing = already_exists(db, title)
            if existing and existing.status in ("pending", "published"):
                print(f"skip existing id={existing.id} status={existing.status} {title[:60]}")
                results.append(
                    {
                        "id": existing.id,
                        "status": existing.status,
                        "slug": existing.slug,
                        "title": existing.title,
                        "skipped": True,
                    }
                )
                continue

            cover_name = article["cover"]
            if cover_name not in cover_cache:
                path = COVERS / cover_name
                if not path.exists():
                    raise SystemExit(f"missing cover {path}")
                cover_cache[cover_name] = save_blog_image(user.id, path.read_bytes())
                print("cover", cover_name, "→", cover_cache[cover_name])

            brand_id, model_id = resolve_catalog(db, article.get("key") or "")
            # Prefer script ids if they still exist on this DB
            if article.get("brand_id"):
                if db.get(CarBrand, article["brand_id"]):
                    brand_id = article["brand_id"]
            if article.get("model_id"):
                m = db.get(CarModel, article["model_id"])
                if m and (not brand_id or m.brand_id == brand_id):
                    model_id = m.id
                    brand_id = m.brand_id

            now = datetime.utcnow()
            post = BlogPost(
                author_id=user.id,
                title=title[:180],
                excerpt=(article.get("excerpt") or "")[:400],
                seo_description=(article.get("seo") or "")[:160],
                cover_url=cover_cache[cover_name],
                body=normalize_blocks(article.get("body") or []),
                status="pending",
                as_editorial=True,
                section_id=section_id(db, article),
                brand_id=brand_id,
                model_id=model_id,
                slug=_unique_post_slug(db, title, exclude_id=None),
                submitted_at=now,
                created_at=now,
                updated_at=now,
            )
            db.add(post)
            db.flush()
            _set_tags(db, post, normalize_tag_names(article.get("tags") or []))
            db.commit()
            print(f"submitted id={post.id} status={post.status} slug={post.slug}")
            results.append(
                {
                    "id": post.id,
                    "status": post.status,
                    "slug": post.slug,
                    "title": post.title,
                    "brand_id": brand_id,
                    "model_id": model_id,
                    "section_id": post.section_id,
                }
            )

        pending = db.execute(
            select(BlogPost.id).where(BlogPost.status == "pending")
        ).all()
        print("pending_count", len(pending))
        import json

        print(json.dumps(results, ensure_ascii=False, indent=2))
    finally:
        db.close()


if __name__ == "__main__":
    main()
