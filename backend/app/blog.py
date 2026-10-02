"""Публичный блог, редактор авторов и модерация."""

from __future__ import annotations

import os
from datetime import datetime

from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile
from fastapi.security import OAuth2PasswordBearer
from pydantic import BaseModel, Field
from sqlalchemy import case, delete, func, or_, select
from sqlalchemy.orm import Session, joinedload, selectinload

from .admin_request_chat import find_platform_chat_id
from .blog_content import (
    SEO_DESCRIPTION_MAX,
    BlogError,
    apply_transition,
    clean_slug,
    is_staff_role,
    normalize_blocks,
    normalize_tag_names,
    validate_ready_to_publish,
)
from .db import get_db
from .media_storage import save_blog_image
from .models import (
    BlogAuthorProfile,
    BlogComment,
    BlogCommentLike,
    BlogPost,
    BlogPostLike,
    BlogPostTag,
    BlogSection,
    BlogTag,
    CarBrand,
    CarModel,
    Chat,
    ChatMessage,
    User,
)
from .security import decode_access_token

router = APIRouter(prefix="/blog", tags=["blog"])
_oauth_required = OAuth2PasswordBearer(tokenUrl="/auth/login")
_oauth_optional = OAuth2PasswordBearer(tokenUrl="/auth/login", auto_error=False)

EDITORIAL_SLUG = "redaktsiya"
EDITORIAL_NAME = "Редакция Avtovozom"
EDITORIAL_BIO = "Новости площадки, разборы импорта и материалы об эксплуатации автомобилей из Китая."

DEFAULT_SECTIONS = (
    ("import-i-tamozhnya", "Импорт и таможня", "Правила ввоза, пошлины, утильсбор", 10),
    ("obzory-modelej", "Обзоры моделей", "Новинки и опыт эксплуатации", 20),
    ("tehnicheskie-harakteristiki", "Технические характеристики", "Двигатели, платформы, батареи", 30),
    ("obsluzhivanie-i-to", "Обслуживание и ТО", "Регламенты, расходники, сервис", 40),
    ("opyt-vladelcev", "Опыт владельцев", "Публикации сообщества", 50),
)


class PostWriteIn(BaseModel):
    title: str = ""
    excerpt: str = ""
    seo_description: str = ""
    slug: str = ""
    section_id: int | None = None
    brand_id: int | None = None
    model_id: int | None = None
    cover_url: str = ""
    body: list = Field(default_factory=list)
    tags: list[str] = Field(default_factory=list)
    as_editorial: bool = False
    bio: str = ""


class CommentIn(BaseModel):
    body: str = ""
    parent_id: int | None = None


class RejectIn(BaseModel):
    reason: str = ""


class SectionWriteIn(BaseModel):
    title: str = ""
    description: str = ""
    slug: str = ""
    sort_order: int = 0
    is_hidden: bool = False


class BioIn(BaseModel):
    bio: str = ""


def ensure_blog_sections(db: Session) -> None:
    existing = {
        row[0]
        for row in db.execute(select(BlogSection.slug)).all()
    }
    if existing:
        return
    for slug, title, description, order in DEFAULT_SECTIONS:
        db.add(
            BlogSection(
                slug=slug,
                title=title,
                description=description,
                sort_order=order,
                is_hidden=False,
            )
        )
    db.commit()


def _user_from_token(db: Session, token: str | None) -> User | None:
    if not token:
        return None
    user_id = decode_access_token(token)
    if not user_id:
        return None
    user = (
        db.execute(
            select(User).where(User.id == int(user_id)).options(joinedload(User.role))
        )
        .unique()
        .scalar_one_or_none()
    )
    if not user or not user.is_active:
        return None
    return user


def get_current_user(
    token: str = Depends(_oauth_required), db: Session = Depends(get_db)
) -> User:
    user = _user_from_token(db, token)
    if not user:
        raise HTTPException(status_code=401, detail="Invalid or expired token")
    return user


def get_optional_user(
    token: str | None = Depends(_oauth_optional), db: Session = Depends(get_db)
) -> User | None:
    return _user_from_token(db, token)


def require_staff(user: User = Depends(get_current_user)) -> User:
    if not is_staff_role(user.role.code if user.role else ""):
        raise HTTPException(status_code=403, detail="Insufficient permissions")
    return user


def require_admin(user: User = Depends(get_current_user)) -> User:
    if not user.role or user.role.code != "admin":
        raise HTTPException(status_code=403, detail="Insufficient permissions")
    return user


def _role(user: User) -> str:
    return user.role.code if user.role else ""


def _initials(name: str) -> str:
    parts = [p for p in (name or "").split() if p]
    if len(parts) >= 2:
        return (parts[0][0] + parts[1][0]).upper()
    raw = (name or "AV").strip()
    return raw[:2].upper() or "AV"


def _public_name(user: User | None, as_editorial: bool) -> str:
    if as_editorial:
        return EDITORIAL_NAME
    if not user:
        return "Автор"
    name = (user.display_name or user.full_name or "").strip()
    return name or "Автор"


def _author_card(
    user: User | None,
    profile: BlogAuthorProfile | None,
    *,
    as_editorial: bool,
    bio: str = "",
    posts_count: int | None = None,
) -> dict:
    if as_editorial:
        card = {
            "slug": EDITORIAL_SLUG,
            "name": EDITORIAL_NAME,
            "initials": "AV",
            "is_editorial": True,
            "bio": EDITORIAL_BIO,
        }
    else:
        name = _public_name(user, False)
        card = {
            "slug": profile.slug if profile else "",
            "name": name,
            "initials": _initials(name),
            "is_editorial": False,
            "bio": bio or (profile.bio if profile else ""),
        }
    if posts_count is not None:
        card["posts_count"] = posts_count
    return card


def _section_card(section: BlogSection | None) -> dict | None:
    if not section:
        return None
    return {
        "id": section.id,
        "slug": section.slug,
        "title": section.title,
        "description": section.description or "",
    }


def _iso(value: datetime | None) -> str | None:
    return value.isoformat() if value else None


def _post_card(
    post: BlogPost,
    *,
    profile: BlogAuthorProfile | None,
    liked: bool = False,
    include_body: bool = False,
    mine: bool = False,
) -> dict:
    data = {
        "id": post.id,
        "slug": post.slug,
        "title": post.title,
        "excerpt": post.excerpt or "",
        "seo_description": post.seo_description or "",
        "cover_url": post.cover_url or "",
        "status": post.status,
        "published_at": _iso(post.published_at),
        "updated_at": _iso(post.updated_at),
        "created_at": _iso(post.created_at),
        "section": _section_card(post.section),
        "tags": [{"slug": tag.slug, "name": tag.name} for tag in (post.tags or [])],
        "author": _author_card(post.author, profile, as_editorial=bool(post.as_editorial)),
        "like_count": int(post.like_count or 0),
        "comment_count": int(post.comment_count or 0),
        "view_count": int(post.view_count or 0),
        "liked_by_me": liked,
        "brand_id": post.brand_id,
        "model_id": post.model_id,
        "brand_name": post.brand.name if post.brand else "",
        "model_name": post.model.name if post.model else "",
        "as_editorial": bool(post.as_editorial),
    }
    if include_body:
        data["body"] = post.body or []
    if mine:
        data["rejection_reason"] = post.rejection_reason or ""
        data["submitted_at"] = _iso(post.submitted_at)
    return data


def _load_profiles(db: Session, user_ids: set[int]) -> dict[int, BlogAuthorProfile]:
    if not user_ids:
        return {}
    rows = db.execute(
        select(BlogAuthorProfile).where(BlogAuthorProfile.user_id.in_(user_ids))
    ).scalars()
    return {row.user_id: row for row in rows}


def _liked_post_ids(db: Session, user: User | None, post_ids: list[int]) -> set[int]:
    if not user or not post_ids:
        return set()
    rows = db.execute(
        select(BlogPostLike.post_id).where(
            BlogPostLike.user_id == user.id, BlogPostLike.post_id.in_(post_ids)
        )
    ).all()
    return {row[0] for row in rows}


def _post_query():
    return select(BlogPost).options(
        selectinload(BlogPost.tags),
        joinedload(BlogPost.section),
        joinedload(BlogPost.author).joinedload(User.role),
        joinedload(BlogPost.brand),
        joinedload(BlogPost.model),
    )


def _ensure_author(db: Session, user: User) -> BlogAuthorProfile:
    row = db.get(BlogAuthorProfile, user.id)
    if row:
        return row
    base = clean_slug(user.display_name or user.full_name or "", fallback=f"user-{user.id}")
    if base == EDITORIAL_SLUG:
        base = f"user-{user.id}"
    slug = base
    n = 2
    while db.execute(
        select(BlogAuthorProfile.user_id).where(BlogAuthorProfile.slug == slug)
    ).first():
        slug = f"{base}-{n}"[:90]
        n += 1
    row = BlogAuthorProfile(user_id=user.id, slug=slug, bio="")
    db.add(row)
    db.flush()
    return row


def _unique_post_slug(db: Session, raw: str, *, exclude_id: int | None) -> str:
    base = clean_slug(raw, fallback="post")
    slug = base
    n = 2
    while True:
        stmt = select(BlogPost.id).where(BlogPost.slug == slug)
        if exclude_id:
            stmt = stmt.where(BlogPost.id != exclude_id)
        if not db.execute(stmt).first():
            return slug
        slug = f"{base}-{n}"[:96]
        n += 1


def _clean_media(url: str, user: User) -> str:
    url = (url or "").strip()
    if not url:
        return ""
    staff = is_staff_role(_role(user))
    if not url.startswith("/media/blog/") or ".." in url:
        raise HTTPException(status_code=400, detail="Некорректное изображение.")
    if not staff and not url.startswith(f"/media/blog/{user.id}/"):
        raise HTTPException(status_code=400, detail="Изображение должно быть загружено вами.")
    return url[:512]


def _apply_write(db: Session, post: BlogPost, payload: PostWriteIn, user: User) -> None:
    title = (payload.title or "").strip()[:180] or "Черновик"
    post.title = title
    post.excerpt = (payload.excerpt or "").strip()[:400]
    post.seo_description = (payload.seo_description or "").strip()[:SEO_DESCRIPTION_MAX]
    post.cover_url = _clean_media(payload.cover_url, user)
    body = normalize_blocks(payload.body)
    for block in body:
        if block.get("type") == "image":
            block["url"] = _clean_media(block["url"], user)
    post.body = body
    staff = is_staff_role(_role(user))
    post.as_editorial = bool(payload.as_editorial) and staff
    if payload.section_id:
        section = db.get(BlogSection, payload.section_id)
        if not section or section.is_hidden:
            raise HTTPException(status_code=400, detail="Раздел не найден.")
        post.section_id = section.id
    else:
        post.section_id = None
    brand = None
    if payload.brand_id:
        brand = db.get(CarBrand, payload.brand_id)
        if not brand:
            raise HTTPException(status_code=400, detail="Марка не найдена.")
        post.brand_id = brand.id
    else:
        post.brand_id = None
    if payload.model_id:
        model = db.get(CarModel, payload.model_id)
        if not model or (brand and model.brand_id != brand.id) or (not brand):
            raise HTTPException(status_code=400, detail="Модель не найдена.")
        post.model_id = model.id
        post.brand_id = model.brand_id
    else:
        post.model_id = None
    manual_slug = (payload.slug or "").strip()
    if staff and manual_slug:
        post.slug = _unique_post_slug(db, manual_slug, exclude_id=post.id)
    elif post.status != "published":
        slug_source = title if title != "Черновик" else (post.slug or title)
        post.slug = _unique_post_slug(db, slug_source, exclude_id=post.id)
    _set_tags(db, post, normalize_tag_names(payload.tags))
    _ensure_author(db, user)


def _set_tags(db: Session, post: BlogPost, names: list[str]) -> None:
    tags: list[BlogTag] = []
    for name in names:
        slug = clean_slug(name, fallback="tag")[:48]
        tag = db.execute(select(BlogTag).where(BlogTag.slug == slug)).scalar_one_or_none()
        if not tag:
            tag = BlogTag(slug=slug, name=name[:48])
            db.add(tag)
            db.flush()
        elif tag.name != name:
            tag.name = name[:48]
        tags.append(tag)
    post.tags = tags


def _owned_or_404(db: Session, post_id: int, user: User) -> BlogPost:
    post = db.execute(_post_query().where(BlogPost.id == post_id)).unique().scalar_one_or_none()
    if not post or post.author_id != user.id:
        raise HTTPException(status_code=404, detail="Публикация не найдена.")
    return post


def _notify_author(db: Session, *, author_id: int, sender_id: int, text: str) -> None:
    if sender_id == author_id:
        return
    chat_id = find_platform_chat_id(db, author_id)
    if not chat_id:
        return
    db.add(
        ChatMessage(
            chat_id=chat_id,
            sender_user_id=sender_id,
            message_type="text",
            text=text[:2000],
        )
    )
    chat = db.get(Chat, chat_id)
    if chat:
        chat.last_message_at = datetime.utcnow()


def _ping(slug: str) -> None:
    origin = (os.getenv("PUBLIC_WEB_ORIGIN") or os.getenv("NEXT_PUBLIC_SITE_URL") or "").strip().rstrip("/")
    if not origin or not slug:
        return
    try:
        from .indexnow import submit_urls

        submit_urls([f"{origin}/blog/{slug}", f"{origin}/blog"])
    except Exception:
        return


def _cards(db: Session, posts: list[BlogPost], viewer: User | None, *, mine: bool = False, body: bool = False) -> list[dict]:
    profiles = _load_profiles(db, {p.author_id for p in posts})
    liked = _liked_post_ids(db, viewer, [p.id for p in posts])
    return [
        _post_card(
            post,
            profile=profiles.get(post.author_id),
            liked=post.id in liked,
            include_body=body,
            mine=mine,
        )
        for post in posts
    ]


def _section_rows(db: Session, *, include_hidden: bool) -> list[dict]:
    stmt = select(BlogSection).order_by(BlogSection.sort_order, BlogSection.id)
    if not include_hidden:
        stmt = stmt.where(BlogSection.is_hidden.is_(False))
    sections = db.execute(stmt).scalars().all()
    counts = dict(
        db.execute(
            select(BlogPost.section_id, func.count())
            .where(BlogPost.status == "published")
            .group_by(BlogPost.section_id)
        ).all()
    )
    return [
        {
            **(_section_card(section) or {}),
            "sort_order": section.sort_order,
            "is_hidden": bool(section.is_hidden),
            "posts_count": int(counts.get(section.id) or 0),
        }
        for section in sections
    ]


@router.get("/sections")
def list_sections(db: Session = Depends(get_db)):
    ensure_blog_sections(db)
    return _section_rows(db, include_hidden=False)


@router.get("/admin/sections")
def admin_sections(db: Session = Depends(get_db), user: User = Depends(require_admin)):
    ensure_blog_sections(db)
    return _section_rows(db, include_hidden=True)


@router.get("/tags")
def list_tags(db: Session = Depends(get_db), limit: int = Query(12, ge=1, le=40)):
    assoc = BlogPost.tags.property.secondary
    rows = db.execute(
        select(BlogTag.slug, BlogTag.name, func.count(func.distinct(BlogPost.id)))
        .select_from(BlogTag)
        .join(assoc, assoc.c.tag_id == BlogTag.id)
        .join(BlogPost, BlogPost.id == assoc.c.post_id)
        .where(BlogPost.status == "published")
        .group_by(BlogTag.id)
        .order_by(func.count(func.distinct(BlogPost.id)).desc(), BlogTag.name)
        .limit(limit)
    ).all()
    return [{"slug": slug, "name": name, "posts_count": int(count)} for slug, name, count in rows]


@router.get("/posts")
def list_posts(
    db: Session = Depends(get_db),
    viewer: User | None = Depends(get_optional_user),
    section: str = "",
    tag: str = "",
    q: str = "",
    sort: str = "new",
    page: int = Query(1, ge=1),
    limit: int = Query(12, ge=1, le=50),
):
    ensure_blog_sections(db)
    visible = select(BlogSection.id).where(BlogSection.is_hidden.is_(False))
    filters = [BlogPost.status == "published", BlogPost.section_id.in_(visible)]
    if section.strip():
        filters.append(BlogPost.section.has(BlogSection.slug == section.strip()))
    if tag.strip():
        filters.append(BlogPost.tags.any(BlogTag.slug == tag.strip()))
    if q.strip():
        like = f"%{q.strip()}%"
        filters.append(or_(BlogPost.title.ilike(like), BlogPost.excerpt.ilike(like)))
    total = int(db.execute(select(func.count()).select_from(BlogPost).where(*filters)).scalar() or 0)
    stmt = _post_query().where(*filters)
    if sort == "popular":
        stmt = stmt.order_by(BlogPost.like_count.desc(), BlogPost.published_at.desc())
    else:
        stmt = stmt.order_by(BlogPost.published_at.desc(), BlogPost.id.desc())
    posts = db.execute(stmt.offset((page - 1) * limit).limit(limit)).unique().scalars().all()
    return {"items": _cards(db, posts, viewer), "total": total, "page": page, "limit": limit}


@router.get("/related")
def related_posts(
    db: Session = Depends(get_db),
    viewer: User | None = Depends(get_optional_user),
    brand_id: int | None = None,
    model_id: int | None = None,
    limit: int = Query(3, ge=1, le=6),
):
    if not brand_id and not model_id:
        return []
    filters = []
    if model_id:
        filters.append(BlogPost.model_id == model_id)
    if brand_id:
        filters.append(BlogPost.brand_id == brand_id)
    visible = select(BlogSection.id).where(BlogSection.is_hidden.is_(False))
    whens = []
    if model_id:
        whens.append((BlogPost.model_id == model_id, 2))
    if brand_id:
        whens.append((BlogPost.brand_id == brand_id, 1))
    score = case(*whens, else_=0)
    stmt = (
        _post_query()
        .where(BlogPost.status == "published", BlogPost.section_id.in_(visible), or_(*filters))
        .order_by(score.desc(), BlogPost.published_at.desc())
        .limit(limit)
    )
    posts = db.execute(stmt).unique().scalars().all()
    return _cards(db, posts, viewer)


@router.get("/sitemap")
def blog_sitemap(db: Session = Depends(get_db)):
    ensure_blog_sections(db)
    visible = select(BlogSection.id).where(BlogSection.is_hidden.is_(False))
    posts = db.execute(
        select(BlogPost.slug, BlogPost.updated_at, BlogPost.published_at)
        .where(BlogPost.status == "published", BlogPost.section_id.in_(visible))
        .order_by(BlogPost.published_at.desc())
        .limit(5000)
    ).all()
    sections = db.execute(
        select(BlogSection.slug).where(BlogSection.is_hidden.is_(False)).order_by(BlogSection.sort_order)
    ).all()
    authors = db.execute(
        select(BlogAuthorProfile.slug)
        .join(BlogPost, BlogPost.author_id == BlogAuthorProfile.user_id)
        .where(BlogPost.status == "published", BlogPost.as_editorial.is_(False))
        .distinct()
    ).all()
    editorial = db.execute(
        select(func.count()).select_from(BlogPost).where(
            BlogPost.status == "published", BlogPost.as_editorial.is_(True)
        )
    ).scalar()
    author_slugs = [row[0] for row in authors]
    if editorial:
        author_slugs.insert(0, EDITORIAL_SLUG)
    return {
        "posts": [
            {"slug": slug, "updated_at": _iso(updated or published)}
            for slug, updated, published in posts
        ],
        "sections": [row[0] for row in sections],
        "authors": author_slugs,
    }


@router.get("/posts/{slug}")
def get_post(slug: str, db: Session = Depends(get_db), viewer: User | None = Depends(get_optional_user)):
    post = db.execute(_post_query().where(BlogPost.slug == slug)).unique().scalar_one_or_none()
    if not post or post.status != "published" or (post.section and post.section.is_hidden):
        raise HTTPException(status_code=404, detail="Публикация не найдена.")
    post.view_count = int(post.view_count or 0) + 1
    db.commit()
    card = _cards(db, [post], viewer, body=True)[0]
    card["comments"] = _comment_tree(db, post, viewer)
    visible = select(BlogSection.id).where(BlogSection.is_hidden.is_(False))
    related_filters = [BlogPost.section_id == post.section_id]
    if post.model_id:
        related_filters.append(BlogPost.model_id == post.model_id)
    related = db.execute(
        _post_query()
        .where(
            BlogPost.status == "published",
            BlogPost.id != post.id,
            BlogPost.section_id.in_(visible),
            or_(*related_filters),
        )
        .order_by(BlogPost.published_at.desc())
        .limit(3)
    ).unique().scalars().all()
    card["related"] = _cards(db, related, viewer)
    return card


def _comment_tree(db: Session, post: BlogPost, viewer: User | None) -> list[dict]:
    comments = db.execute(
        select(BlogComment)
        .where(BlogComment.post_id == post.id)
        .options(joinedload(BlogComment.user))
        .order_by(BlogComment.created_at.asc())
    ).unique().scalars().all()
    liked: set[int] = set()
    if viewer and comments:
        liked = {
            row[0]
            for row in db.execute(
                select(BlogCommentLike.comment_id).where(
                    BlogCommentLike.user_id == viewer.id,
                    BlogCommentLike.comment_id.in_([c.id for c in comments]),
                )
            ).all()
        }
    by_parent: dict[int | None, list] = {}
    for comment in comments:
        by_parent.setdefault(comment.parent_id, []).append(_comment_card(comment, post, liked, viewer))
    roots = []
    for card in by_parent.get(None, []):
        card["replies"] = by_parent.get(card["id"], [])
        roots.append(card)
    return roots


def _comment_card(comment: BlogComment, post: BlogPost, liked: set[int], viewer: User | None) -> dict:
    editorial = bool(post.as_editorial and comment.user_id == post.author_id)
    name = _public_name(comment.user, editorial)
    staff = bool(viewer and is_staff_role(_role(viewer)))
    return {
        "id": comment.id,
        "parent_id": comment.parent_id,
        "body": comment.body,
        "created_at": _iso(comment.created_at),
        "like_count": int(comment.like_count or 0),
        "liked_by_me": comment.id in liked,
        "is_post_author": comment.user_id == post.author_id,
        "can_delete": bool(viewer and (comment.user_id == viewer.id or staff)),
        "author": {
            "name": name,
            "initials": "AV" if editorial else _initials(name),
            "is_editorial": editorial,
        },
    }


@router.get("/authors/{slug}")
def get_author(
    slug: str,
    db: Session = Depends(get_db),
    viewer: User | None = Depends(get_optional_user),
    page: int = Query(1, ge=1),
    limit: int = Query(12, ge=1, le=50),
):
    if slug == EDITORIAL_SLUG:
        author_filter = [BlogPost.status == "published", BlogPost.as_editorial.is_(True)]
        stmt = _post_query().where(*author_filter)
        author = _author_card(None, None, as_editorial=True)
    else:
        profile = db.execute(
            select(BlogAuthorProfile).where(BlogAuthorProfile.slug == slug)
        ).scalar_one_or_none()
        if not profile:
            raise HTTPException(status_code=404, detail="Автор не найден.")
        user = db.execute(
            select(User).where(User.id == profile.user_id).options(joinedload(User.role))
        ).unique().scalar_one_or_none()
        author_filter = [
            BlogPost.status == "published",
            BlogPost.author_id == profile.user_id,
            BlogPost.as_editorial.is_(False),
        ]
        stmt = _post_query().where(*author_filter)
        author = _author_card(user, profile, as_editorial=False, bio=profile.bio)
    total = int(db.execute(select(func.count()).select_from(BlogPost).where(*author_filter)).scalar() or 0)
    author["posts_count"] = total
    posts = db.execute(
        stmt.order_by(BlogPost.published_at.desc()).offset((page - 1) * limit).limit(limit)
    ).unique().scalars().all()
    return {"author": author, "items": _cards(db, posts, viewer), "total": total, "page": page}


@router.post("/uploads")
async def upload_image(
    file: UploadFile = File(...),
    user: User = Depends(get_current_user),
):
    data = await file.read()
    try:
        url = save_blog_image(user.id, data)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return {"url": url}


@router.get("/me/posts")
def my_posts(
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
    status: str = "",
):
    stmt = _post_query().where(BlogPost.author_id == user.id).order_by(BlogPost.updated_at.desc())
    if status.strip() in {"draft", "pending", "published", "rejected"}:
        stmt = stmt.where(BlogPost.status == status.strip())
    posts = db.execute(stmt).unique().scalars().all()
    return _cards(db, posts, user, mine=True)


@router.get("/me/posts/{post_id}")
def my_post(post_id: int, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    post = _owned_or_404(db, post_id, user)
    return _cards(db, [post], user, mine=True, body=True)[0]


@router.post("/me/posts")
def create_post(
    payload: PostWriteIn,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    ensure_blog_sections(db)
    post = BlogPost(
        author_id=user.id,
        slug=_unique_post_slug(db, payload.slug or payload.title or "chernovik", exclude_id=None),
        title="Черновик",
        status="draft",
        body=[],
    )
    db.add(post)
    db.flush()
    try:
        _apply_write(db, post, payload, user)
    except BlogError as exc:
        raise HTTPException(status_code=400, detail=exc.message) from exc
    db.commit()
    db.refresh(post)
    fresh = _owned_or_404(db, post.id, user)
    return _cards(db, [fresh], user, mine=True, body=True)[0]


@router.put("/me/posts/{post_id}")
def update_post(
    post_id: int,
    payload: PostWriteIn,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    post = _owned_or_404(db, post_id, user)
    try:
        _apply_write(db, post, payload, user)
        post.status = apply_transition(post.status, _role(user), "save")
    except BlogError as exc:
        raise HTTPException(status_code=400, detail=exc.message) from exc
    if post.status == "pending" and not post.submitted_at:
        post.submitted_at = datetime.utcnow()
    if post.status != "rejected":
        post.rejection_reason = ""
    post.updated_at = datetime.utcnow()
    db.commit()
    fresh = _owned_or_404(db, post.id, user)
    return _cards(db, [fresh], user, mine=True, body=True)[0]


def _transition(db: Session, post: BlogPost, user: User, action: str) -> dict:
    try:
        if action in ("submit", "publish"):
            validate_ready_to_publish(
                title=post.title,
                section_id=post.section_id,
                cover_url=post.cover_url,
                body=post.body or [],
            )
        post.status = apply_transition(post.status, _role(user), action)
    except BlogError as exc:
        raise HTTPException(status_code=400, detail=exc.message) from exc
    now = datetime.utcnow()
    post.updated_at = now
    if post.status == "pending":
        post.submitted_at = now
        post.rejection_reason = ""
    if post.status == "published":
        post.published_at = post.published_at or now
        post.rejection_reason = ""
    if post.status == "draft":
        post.submitted_at = None
    db.commit()
    if post.status == "published":
        _ping(post.slug)
    fresh = _owned_or_404(db, post.id, user)
    return _cards(db, [fresh], user, mine=True, body=True)[0]


@router.post("/me/posts/{post_id}/submit")
def submit_post(post_id: int, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    return _transition(db, _owned_or_404(db, post_id, user), user, "submit")


@router.post("/me/posts/{post_id}/publish")
def publish_post(post_id: int, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    return _transition(db, _owned_or_404(db, post_id, user), user, "publish")


@router.post("/me/posts/{post_id}/withdraw")
def withdraw_post(post_id: int, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    return _transition(db, _owned_or_404(db, post_id, user), user, "withdraw")


@router.delete("/me/posts/{post_id}")
def delete_post(post_id: int, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    post = _owned_or_404(db, post_id, user)
    # С «на проверке» снимаем сами, чтобы одна кнопка «Удалить» работала в профиле.
    if post.status == "pending":
        try:
            post.status = apply_transition(post.status, _role(user), "withdraw")
        except BlogError as exc:
            raise HTTPException(status_code=400, detail=exc.message) from exc
        post.submitted_at = None
        post.updated_at = datetime.utcnow()
        db.flush()
    # Сначала чистим коллекцию в сессии — иначе SQL DELETE тегов + ORM delete поста дают 500.
    post.tags = []
    db.flush()
    _delete_post_children(db, post.id)
    db.delete(post)
    db.commit()
    return {"ok": True}


def _delete_post_children(db: Session, post_id: int) -> None:
    comment_ids = [
        row[0] for row in db.execute(select(BlogComment.id).where(BlogComment.post_id == post_id)).all()
    ]
    if comment_ids:
        db.execute(
            delete(BlogCommentLike).where(BlogCommentLike.comment_id.in_(comment_ids)),
            execution_options={"synchronize_session": False},
        )
        # Снять self-FK, иначе один DELETE по post_id может упереться в parent_id.
        db.execute(
            BlogComment.__table__.update()
            .where(BlogComment.post_id == post_id)
            .values(parent_id=None)
        )
        db.execute(
            delete(BlogComment).where(BlogComment.post_id == post_id),
            execution_options={"synchronize_session": False},
        )
    db.execute(
        delete(BlogPostLike).where(BlogPostLike.post_id == post_id),
        execution_options={"synchronize_session": False},
    )
    db.execute(
        delete(BlogPostTag).where(BlogPostTag.post_id == post_id),
        execution_options={"synchronize_session": False},
    )


@router.get("/me/profile")
def get_my_blog_profile(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    profile = _ensure_author(db, user)
    db.commit()
    return {"bio": profile.bio or ""}


@router.put("/me/profile")
def update_bio(payload: BioIn, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    profile = _ensure_author(db, user)
    profile.bio = (payload.bio or "").strip()[:500]
    db.commit()
    return _author_card(user, profile, as_editorial=False, bio=profile.bio)


@router.post("/posts/{slug}/comments")
def add_comment(
    slug: str,
    payload: CommentIn,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    post = db.execute(select(BlogPost).where(BlogPost.slug == slug)).scalar_one_or_none()
    if not post or post.status != "published":
        raise HTTPException(status_code=404, detail="Публикация не найдена.")
    body = (payload.body or "").strip()
    if len(body) < 2 or len(body) > 2000:
        raise HTTPException(status_code=400, detail="Комментарий — от 2 до 2000 символов.")
    parent_id = None
    if payload.parent_id:
        parent = db.get(BlogComment, payload.parent_id)
        if not parent or parent.post_id != post.id or parent.parent_id:
            raise HTTPException(status_code=400, detail="Ответить можно только на комментарий верхнего уровня.")
        parent_id = parent.id
    comment = BlogComment(post_id=post.id, user_id=user.id, parent_id=parent_id, body=body)
    db.add(comment)
    post.comment_count = int(post.comment_count or 0) + 1
    db.commit()
    db.refresh(comment)
    comment.user = user
    return _comment_card(comment, post, set(), user)


@router.delete("/comments/{comment_id}")
def delete_comment(
    comment_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    comment = db.get(BlogComment, comment_id)
    if not comment:
        raise HTTPException(status_code=404, detail="Комментарий не найден.")
    staff = is_staff_role(_role(user))
    if comment.user_id != user.id and not staff:
        raise HTTPException(status_code=403, detail="Недостаточно прав.")
    post = db.get(BlogPost, comment.post_id)
    ids = [comment.id]
    child_ids = [
        row[0]
        for row in db.execute(select(BlogComment.id).where(BlogComment.parent_id == comment.id)).all()
    ]
    ids.extend(child_ids)
    if child_ids:
        db.execute(delete(BlogCommentLike).where(BlogCommentLike.comment_id.in_(child_ids)))
        db.execute(delete(BlogComment).where(BlogComment.id.in_(child_ids)))
    db.execute(delete(BlogCommentLike).where(BlogCommentLike.comment_id == comment.id))
    db.delete(comment)
    if post:
        post.comment_count = max(0, int(post.comment_count or 0) - len(ids))
    db.commit()
    return {"ok": True}


@router.post("/posts/{slug}/likes")
def toggle_post_like(
    slug: str,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    post = db.execute(select(BlogPost).where(BlogPost.slug == slug)).scalar_one_or_none()
    if not post or post.status != "published":
        raise HTTPException(status_code=404, detail="Публикация не найдена.")
    existing = db.get(BlogPostLike, (post.id, user.id))
    if existing:
        db.delete(existing)
        post.like_count = max(0, int(post.like_count or 0) - 1)
        liked = False
    else:
        db.add(BlogPostLike(post_id=post.id, user_id=user.id))
        post.like_count = int(post.like_count or 0) + 1
        liked = True
    db.commit()
    return {"liked": liked, "like_count": int(post.like_count or 0)}


@router.post("/comments/{comment_id}/likes")
def toggle_comment_like(
    comment_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    comment = db.get(BlogComment, comment_id)
    if not comment:
        raise HTTPException(status_code=404, detail="Комментарий не найден.")
    existing = db.get(BlogCommentLike, (comment.id, user.id))
    if existing:
        db.delete(existing)
        comment.like_count = max(0, int(comment.like_count or 0) - 1)
        liked = False
    else:
        db.add(BlogCommentLike(comment_id=comment.id, user_id=user.id))
        comment.like_count = int(comment.like_count or 0) + 1
        liked = True
    db.commit()
    return {"liked": liked, "like_count": int(comment.like_count or 0)}


@router.get("/admin/posts")
def admin_posts(
    db: Session = Depends(get_db),
    user: User = Depends(require_staff),
    status: str = "pending",
):
    stmt = _post_query().order_by(BlogPost.submitted_at.desc().nullslast(), BlogPost.updated_at.desc())
    if status.strip() in {"draft", "pending", "published", "rejected"}:
        stmt = stmt.where(BlogPost.status == status.strip())
    posts = db.execute(stmt.limit(100)).unique().scalars().all()
    return _cards(db, posts, user, mine=True)


@router.post("/admin/posts/{post_id}/approve")
def approve_post(post_id: int, db: Session = Depends(get_db), user: User = Depends(require_staff)):
    post = db.execute(_post_query().where(BlogPost.id == post_id)).unique().scalar_one_or_none()
    if not post:
        raise HTTPException(status_code=404, detail="Публикация не найдена.")
    try:
        validate_ready_to_publish(
            title=post.title,
            section_id=post.section_id,
            cover_url=post.cover_url,
            body=post.body or [],
        )
        post.status = apply_transition(post.status, _role(user), "approve")
    except BlogError as exc:
        raise HTTPException(status_code=400, detail=exc.message) from exc
    post.published_at = post.published_at or datetime.utcnow()
    post.rejection_reason = ""
    _notify_author(
        db,
        author_id=post.author_id,
        sender_id=user.id,
        text=f"Публикация «{post.title}» вышла в блоге: /blog/{post.slug}",
    )
    db.commit()
    _ping(post.slug)
    fresh = db.execute(_post_query().where(BlogPost.id == post_id)).unique().scalar_one()
    return _cards(db, [fresh], user, mine=True)[0]


@router.post("/admin/posts/{post_id}/reject")
def reject_post(
    post_id: int,
    payload: RejectIn,
    db: Session = Depends(get_db),
    user: User = Depends(require_staff),
):
    reason = (payload.reason or "").strip()
    if len(reason) < 4:
        raise HTTPException(status_code=400, detail="Напишите причину отклонения.")
    post = db.get(BlogPost, post_id)
    if not post:
        raise HTTPException(status_code=404, detail="Публикация не найдена.")
    try:
        post.status = apply_transition(post.status, _role(user), "reject")
    except BlogError as exc:
        raise HTTPException(status_code=400, detail=exc.message) from exc
    post.rejection_reason = reason[:500]
    _notify_author(
        db,
        author_id=post.author_id,
        sender_id=user.id,
        text=f"Публикация «{post.title}» не прошла проверку. Причина: {post.rejection_reason}",
    )
    db.commit()
    return {"ok": True, "status": post.status}


@router.post("/admin/sections")
def create_section(
    payload: SectionWriteIn,
    db: Session = Depends(get_db),
    user: User = Depends(require_admin),
):
    title = (payload.title or "").strip()
    if len(title) < 2:
        raise HTTPException(status_code=400, detail="Укажите название раздела.")
    slug = _unique_section_slug(db, payload.slug or title, exclude_id=None)
    section = BlogSection(
        slug=slug,
        title=title[:120],
        description=(payload.description or "").strip()[:240],
        sort_order=int(payload.sort_order or 0),
        is_hidden=bool(payload.is_hidden),
    )
    db.add(section)
    db.commit()
    db.refresh(section)
    return {**(_section_card(section) or {}), "sort_order": section.sort_order, "is_hidden": section.is_hidden}


@router.put("/admin/sections/{section_id}")
def update_section(
    section_id: int,
    payload: SectionWriteIn,
    db: Session = Depends(get_db),
    user: User = Depends(require_admin),
):
    section = db.get(BlogSection, section_id)
    if not section:
        raise HTTPException(status_code=404, detail="Раздел не найден.")
    title = (payload.title or "").strip()
    if len(title) < 2:
        raise HTTPException(status_code=400, detail="Укажите название раздела.")
    section.title = title[:120]
    section.description = (payload.description or "").strip()[:240]
    section.sort_order = int(payload.sort_order or 0)
    section.is_hidden = bool(payload.is_hidden)
    if payload.slug.strip():
        section.slug = _unique_section_slug(db, payload.slug, exclude_id=section.id)
    db.commit()
    return {**(_section_card(section) or {}), "sort_order": section.sort_order, "is_hidden": section.is_hidden}


def _unique_section_slug(db: Session, raw: str, *, exclude_id: int | None) -> str:
    base = clean_slug(raw, fallback="section")
    slug = base
    n = 2
    while True:
        stmt = select(BlogSection.id).where(BlogSection.slug == slug)
        if exclude_id:
            stmt = stmt.where(BlogSection.id != exclude_id)
        if not db.execute(stmt).first():
            return slug
        slug = f"{base}-{n}"[:80]
        n += 1
