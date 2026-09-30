import Head from "next/head";
import Link from "next/link";
import { useState } from "react";

import BlogBody from "../../components/blog/BlogBody";
import BlogChrome from "../../components/blog/BlogChrome";
import { BlogCompactCard, HeartIcon } from "../../components/blog/BlogCards";
import BlogComments from "../../components/blog/BlogComments";
import { getStoredToken } from "../../lib/auth";
import { formatBlogDate, publicViewCount, viewsLabel } from "../../lib/blogFormat";
import { mediaSrc } from "../../lib/media";
import { jsonLdScriptProps } from "../../lib/schema";
import { getServerApiBase } from "../../lib/serverApiUrl";
import { absoluteUrl } from "../../lib/siteUrl";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

export async function getServerSideProps({ params }) {
  const slug = Array.isArray(params?.slug) ? params.slug[0] : params?.slug;
  if (!slug) return { notFound: true };
  const api = getServerApiBase();
  try {
    const res = await fetch(`${api}/blog/posts/${encodeURIComponent(slug)}`, {
      headers: { Accept: "application/json" },
    });
    if (res.status === 404) return { notFound: true };
    if (!res.ok) return { props: { post: null, slug } };
    return { props: { post: await res.json(), slug } };
  } catch {
    return { props: { post: null, slug } };
  }
}

export default function BlogPostPage({ post: initialPost, slug }) {
  const [post, setPost] = useState(initialPost);
  const [likeBusy, setLikeBusy] = useState(false);
  if (!post) {
    return (
      <BlogChrome>
        <p className="muted">Не удалось загрузить публикацию.</p>
      </BlogChrome>
    );
  }

  const path = `/blog/${post.slug}`;
  const views = publicViewCount(post.view_count);
  const description = post.seo_description || post.excerpt || post.title;
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "Article",
    headline: post.title,
    description,
    datePublished: post.published_at || undefined,
    dateModified: post.updated_at || post.published_at || undefined,
    author: { "@type": "Person", name: post.author?.name || "Avtovozom" },
    mainEntityOfPage: absoluteUrl(path),
    image: post.cover_url ? mediaSrc(post.cover_url, 960) : undefined,
  };

  async function reload() {
    const res = await fetch(`${API_URL}/blog/posts/${encodeURIComponent(slug)}`);
    if (res.ok) setPost(await res.json());
  }

  async function toggleLike() {
    const token = getStoredToken();
    if (!token) {
      window.location.href = `/auth?next=${encodeURIComponent(path)}`;
      return;
    }
    setLikeBusy(true);
    try {
      const res = await fetch(`${API_URL}/blog/posts/${encodeURIComponent(post.slug)}/likes`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const data = await res.json();
        setPost((current) => ({ ...current, liked_by_me: data.liked, like_count: data.like_count }));
      }
    } finally {
      setLikeBusy(false);
    }
  }

  return (
    <BlogChrome>
      <Head>
        <title>{`${post.title} — блог Автовозом`}</title>
        <meta name="description" content={description} />
        <link rel="canonical" href={absoluteUrl(path)} />
        <meta property="og:title" content={post.title} />
        <meta property="og:description" content={description} />
        <meta property="og:url" content={absoluteUrl(path)} />
        <meta property="og:type" content="article" />
        {post.cover_url ? <meta property="og:image" content={mediaSrc(post.cover_url, 960)} /> : null}
        <script {...jsonLdScriptProps(jsonLd)} />
      </Head>
      <article className="blog-article">
        <p className="blog-crumb">
          <Link href="/blog">Блог</Link>
          {post.section ? (
            <>
              {" · "}
              <Link href={`/blog?section=${post.section.slug}`}>{post.section.title}</Link>
            </>
          ) : null}
        </p>
        <h1>{post.title}</h1>
        <div className="blog-article__byline">
          <Link href={post.author?.slug ? `/blog/authors/${post.author.slug}` : "/blog"} className="blog-avatar">
            {post.author?.initials || "AV"}
          </Link>
          <div>
            <Link href={post.author?.slug ? `/blog/authors/${post.author.slug}` : "/blog"}>{post.author?.name}</Link>
            <p className="muted">
              {formatBlogDate(post.published_at)}
              {views ? ` · ${viewsLabel(views)}` : ""}
            </p>
          </div>
          <button type="button" className={`blog-like${post.liked_by_me ? " is-on" : ""}`} onClick={toggleLike} disabled={likeBusy}>
            <HeartIcon /> {post.like_count || 0}
          </button>
        </div>
        {post.cover_url ? <img className="blog-article__cover" src={mediaSrc(post.cover_url, 960)} alt="" /> : null}
        <BlogBody blocks={post.body} />
        {post.tags?.length ? (
          <div className="blog-chips">
            {post.tags.map((tag) => (
              <Link key={tag.slug} href={`/blog?tag=${tag.slug}`}>
                #{tag.name}
              </Link>
            ))}
          </div>
        ) : null}
      </article>
      <BlogComments slug={post.slug} comments={post.comments || []} onChanged={reload} />
      {post.related?.length ? (
        <section className="blog-related">
          <h2>Читайте также</h2>
          {post.related.map((item) => (
            <BlogCompactCard key={item.id} post={item} />
          ))}
        </section>
      ) : null}
    </BlogChrome>
  );
}
