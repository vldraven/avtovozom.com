import Head from "next/head";
import Link from "next/link";

import BlogChrome from "../../../components/blog/BlogChrome";
import { BlogCompactCard } from "../../../components/blog/BlogCards";
import { likesLabel, postsCountLabel } from "../../../lib/blogFormat";
import { getServerApiBase } from "../../../lib/serverApiUrl";
import { absoluteUrl } from "../../../lib/siteUrl";

export async function getServerSideProps({ params }) {
  const slug = Array.isArray(params?.slug) ? params.slug[0] : params?.slug;
  if (!slug) return { notFound: true };
  const api = getServerApiBase();
  try {
    const res = await fetch(`${api}/blog/authors/${encodeURIComponent(slug)}`, {
      headers: { Accept: "application/json" },
    });
    if (res.status === 404) return { notFound: true };
    if (!res.ok) return { props: { payload: null } };
    return { props: { payload: await res.json() } };
  } catch {
    return { props: { payload: null } };
  }
}

export default function BlogAuthorPage({ payload }) {
  if (!payload?.author) {
    return (
      <BlogChrome>
        <p className="muted">Автор не найден.</p>
      </BlogChrome>
    );
  }
  const { author, items } = payload;
  const title = `${author.name} — блог Автовозом`;
  const description = author.bio || `Публикации автора ${author.name} об автомобилях из Китая.`;
  return (
    <BlogChrome>
      <Head>
        <title>{title}</title>
        <meta name="description" content={description} />
        <link rel="canonical" href={absoluteUrl(`/blog/authors/${author.slug}`)} />
      </Head>
      <p className="blog-crumb">
        <Link href="/blog">Блог</Link>
      </p>
      <header className="blog-author">
        <span className="blog-avatar blog-avatar--lg">{author.initials}</span>
        <div>
          <h1>{author.name}</h1>
          <p className="muted">
            {author.is_editorial ? "Редакция" : "Автор"} · {postsCountLabel(author.posts_count)}
          </p>
          {author.bio ? <p>{author.bio}</p> : null}
        </div>
      </header>
      <h2>Публикации автора</h2>
      <div className="blog-feed">
        {(items || []).map((post) => (
          <div key={post.id}>
            <BlogCompactCard post={post} />
            <p className="blog-compact__meta">{likesLabel(post.like_count)} · {post.comment_count || 0} комментариев</p>
          </div>
        ))}
      </div>
    </BlogChrome>
  );
}
