-- Блог: разделы, авторы, публикации, теги, комментарии и лайки.

CREATE TABLE IF NOT EXISTS blog_sections (
    id SERIAL PRIMARY KEY,
    slug VARCHAR(80) NOT NULL UNIQUE,
    title VARCHAR(120) NOT NULL,
    description VARCHAR(240) NOT NULL DEFAULT '',
    sort_order INTEGER NOT NULL DEFAULT 0,
    is_hidden BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS blog_author_profiles (
    user_id INTEGER PRIMARY KEY REFERENCES users(id),
    slug VARCHAR(80) NOT NULL UNIQUE,
    bio VARCHAR(500) NOT NULL DEFAULT '',
    updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS blog_tags (
    id SERIAL PRIMARY KEY,
    slug VARCHAR(48) NOT NULL UNIQUE,
    name VARCHAR(48) NOT NULL
);

CREATE TABLE IF NOT EXISTS blog_posts (
    id SERIAL PRIMARY KEY,
    author_id INTEGER NOT NULL REFERENCES users(id),
    section_id INTEGER REFERENCES blog_sections(id),
    brand_id INTEGER REFERENCES car_brands(id),
    model_id INTEGER REFERENCES car_models(id),
    slug VARCHAR(96) NOT NULL UNIQUE,
    title VARCHAR(180) NOT NULL,
    excerpt VARCHAR(400) NOT NULL DEFAULT '',
    seo_description VARCHAR(160) NOT NULL DEFAULT '',
    cover_url VARCHAR(512) NOT NULL DEFAULT '',
    body JSON NOT NULL DEFAULT '[]',
    status VARCHAR(16) NOT NULL DEFAULT 'draft',
    rejection_reason VARCHAR(500) NOT NULL DEFAULT '',
    as_editorial BOOLEAN NOT NULL DEFAULT FALSE,
    like_count INTEGER NOT NULL DEFAULT 0,
    comment_count INTEGER NOT NULL DEFAULT 0,
    view_count INTEGER NOT NULL DEFAULT 0,
    submitted_at TIMESTAMP NULL,
    published_at TIMESTAMP NULL,
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS ix_blog_posts_author_id ON blog_posts (author_id);
CREATE INDEX IF NOT EXISTS ix_blog_posts_section_id ON blog_posts (section_id);
CREATE INDEX IF NOT EXISTS ix_blog_posts_status ON blog_posts (status);
CREATE INDEX IF NOT EXISTS ix_blog_posts_published_at ON blog_posts (published_at);
CREATE INDEX IF NOT EXISTS ix_blog_posts_brand_id ON blog_posts (brand_id);
CREATE INDEX IF NOT EXISTS ix_blog_posts_model_id ON blog_posts (model_id);

CREATE TABLE IF NOT EXISTS blog_post_tags (
    post_id INTEGER NOT NULL REFERENCES blog_posts(id) ON DELETE CASCADE,
    tag_id INTEGER NOT NULL REFERENCES blog_tags(id) ON DELETE CASCADE,
    PRIMARY KEY (post_id, tag_id)
);

CREATE TABLE IF NOT EXISTS blog_comments (
    id SERIAL PRIMARY KEY,
    post_id INTEGER NOT NULL REFERENCES blog_posts(id) ON DELETE CASCADE,
    user_id INTEGER NOT NULL REFERENCES users(id),
    parent_id INTEGER REFERENCES blog_comments(id) ON DELETE CASCADE,
    body VARCHAR(2000) NOT NULL,
    like_count INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS ix_blog_comments_post_id ON blog_comments (post_id);

CREATE TABLE IF NOT EXISTS blog_post_likes (
    post_id INTEGER NOT NULL REFERENCES blog_posts(id) ON DELETE CASCADE,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    PRIMARY KEY (post_id, user_id)
);

CREATE TABLE IF NOT EXISTS blog_comment_likes (
    comment_id INTEGER NOT NULL REFERENCES blog_comments(id) ON DELETE CASCADE,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    PRIMARY KEY (comment_id, user_id)
);
