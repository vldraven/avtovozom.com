import Link from "next/link";

import { formatBlogDate, likesLabel, publicViewCount, viewsLabel } from "../../lib/blogFormat";
import { mediaSrc } from "../../lib/media";

export function HeartIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function BlogFeaturedCard({ post }) {
  if (!post) return null;
  return (
    <article className="blog-feature">
      <Link href={`/blog/${post.slug}`} className="blog-feature__cover">
        {post.cover_url ? <img src={mediaSrc(post.cover_url, 960)} alt="" /> : <span>Обложка публикации</span>}
      </Link>
      <div className="blog-feature__body">
        {post.section ? <p className="blog-kicker">{post.section.title}</p> : null}
        <h2>
          <Link href={`/blog/${post.slug}`}>{post.title}</Link>
        </h2>
        {post.excerpt ? <p className="blog-feature__excerpt">{post.excerpt}</p> : null}
        <BlogMeta post={post} />
      </div>
    </article>
  );
}

export function BlogCompactCard({ post }) {
  if (!post) return null;
  const views = publicViewCount(post.view_count);
  return (
    <article className="blog-compact">
      <Link href={`/blog/${post.slug}`} className="blog-compact__cover">
        {post.cover_url ? <img src={mediaSrc(post.cover_url, 640)} alt="" /> : null}
      </Link>
      <div>
        {post.section ? <p className="blog-kicker">{post.section.title}</p> : null}
        <h3>
          <Link href={`/blog/${post.slug}`}>{post.title}</Link>
        </h3>
        <p className="blog-compact__meta">
          {post.author?.name}
          {post.published_at ? ` · ${formatBlogDate(post.published_at, { withYear: false })}` : ""}
          {post.like_count > 0 ? (
            <>
              {` · ${post.like_count} `}
              <HeartIcon />
            </>
          ) : null}
          {views ? ` · ${viewsLabel(views)}` : null}
        </p>
      </div>
    </article>
  );
}

export function BlogMeta({ post }) {
  const authorHref = post.author?.slug ? `/blog/authors/${post.author.slug}` : "/blog";
  const views = publicViewCount(post.view_count);
  return (
    <div className="blog-meta">
      <Link href={authorHref} className="blog-avatar">
        {post.author?.initials || "AV"}
      </Link>
      <Link href={authorHref} className="blog-meta__name">
        {post.author?.name}
      </Link>
      {post.published_at ? <span>· {formatBlogDate(post.published_at, { withYear: false })}</span> : null}
      {post.like_count > 0 ? (
        <span className="blog-meta__likes">
          <HeartIcon /> {post.like_count}
        </span>
      ) : null}
      {post.comment_count > 0 ? <span className="blog-meta__comments">{post.comment_count}</span> : null}
      {views ? <span className="blog-meta__views">{viewsLabel(views)}</span> : null}
    </div>
  );
}

export function BlogEmpty({ title, text }) {
  return (
    <div className="blog-empty">
      <p className="blog-empty__title">{title}</p>
      {text ? <p className="muted">{text}</p> : null}
    </div>
  );
}

export function likesText(count) {
  return likesLabel(count);
}
