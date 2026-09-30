import Head from "next/head";
import Link from "next/link";
import { useRouter } from "next/router";

import BlogChrome from "../../components/blog/BlogChrome";
import { BlogCompactCard, BlogEmpty, BlogFeaturedCard } from "../../components/blog/BlogCards";
import { getStoredToken } from "../../lib/auth";
import { absoluteUrl } from "../../lib/siteUrl";
import { getServerApiBase } from "../../lib/serverApiUrl";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";
const TITLE = "Блог Автовозом — импорт, обзоры и эксплуатация авто из Китая";
const DESCRIPTION =
  "Разборы утильсбора и таможни, обзоры китайских моделей, обслуживание и опыт владельцев. Материалы редакции Автовозом и сообщества.";

export async function getServerSideProps({ query }) {
  const api = getServerApiBase();
  const params = new URLSearchParams({ limit: "12" });
  if (query.section) params.set("section", String(query.section));
  if (query.tag) params.set("tag", String(query.tag));
  if (query.q) params.set("q", String(query.q));
  try {
    const [postsRes, sectionsRes, popularRes, tagsRes] = await Promise.all([
      fetch(`${api}/blog/posts?${params}`, { headers: { Accept: "application/json" } }),
      fetch(`${api}/blog/sections`, { headers: { Accept: "application/json" } }),
      fetch(`${api}/blog/posts?sort=popular&limit=3`, { headers: { Accept: "application/json" } }),
      fetch(`${api}/blog/tags?limit=8`, { headers: { Accept: "application/json" } }),
    ]);
    const posts = postsRes.ok ? await postsRes.json() : { items: [], total: 0 };
    const sections = sectionsRes.ok ? await sectionsRes.json() : [];
    const popular = popularRes.ok ? await popularRes.json() : { items: [] };
    const tags = tagsRes.ok ? await tagsRes.json() : [];
    return {
      props: {
        posts,
        sections: Array.isArray(sections) ? sections : [],
        popular: popular.items || [],
        tags: Array.isArray(tags) ? tags : [],
        section: query.section ? String(query.section) : "",
        tag: query.tag ? String(query.tag) : "",
        q: query.q ? String(query.q) : "",
      },
    };
  } catch {
    return {
      props: { posts: { items: [], total: 0 }, sections: [], popular: [], tags: [], section: "", tag: "", q: "" },
    };
  }
}

function PlusIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path d="M12 5v14M5 12h14" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
    </svg>
  );
}

export default function BlogIndexPage({ posts, sections, popular, tags, section, tag, q }) {
  const router = useRouter();
  const items = posts?.items || [];
  const [featured, ...rest] = items;
  const canonical = absoluteUrl(section ? `/blog?section=${section}` : "/blog");

  async function startWriting() {
    const token = getStoredToken();
    if (!token) {
      router.push("/auth?next=/blog/write");
      return;
    }
    const res = await fetch(`${API_URL}/blog/me/posts`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ title: "" }),
    });
    if (res.status === 401) {
      router.push("/auth?next=/blog/write");
      return;
    }
    const data = await res.json().catch(() => ({}));
    if (res.ok && data.id) router.push(`/blog/write/${data.id}`);
  }

  return (
    <BlogChrome>
      <Head>
        <title>{TITLE}</title>
        <meta name="description" content={DESCRIPTION} />
        <link rel="canonical" href={canonical} />
        <meta property="og:title" content={TITLE} />
        <meta property="og:description" content={DESCRIPTION} />
        <meta property="og:url" content={canonical} />
      </Head>
      <header className="blog-hero">
        <div className="blog-hero__intro">
          <h1 className="blog-hero__title">Блог</h1>
          <p className="blog-hero__lead">Импорт, обзоры моделей, обслуживание и опыт владельцев</p>
        </div>
        <button type="button" className="btn btn-primary blog-hero__write" onClick={startWriting}>
          <PlusIcon />
          Написать публикацию
        </button>
      </header>
      <form
        className="blog-search"
        onSubmit={(event) => {
          event.preventDefault();
          const value = new FormData(event.currentTarget).get("q");
          router.push({ pathname: "/blog", query: { ...(section ? { section } : {}), ...(value ? { q: value } : {}) } });
        }}
      >
        <input name="q" defaultValue={q} placeholder="Поиск по публикациям" aria-label="Поиск по публикациям" />
      </form>
      <div className="blog-chips" role="tablist" aria-label="Разделы блога">
        <Link href="/blog" className={!section && !tag ? "is-active" : ""}>
          Все
        </Link>
        {sections.map((item) => (
          <Link key={item.id} href={`/blog?section=${item.slug}`} className={section === item.slug ? "is-active" : ""}>
            {item.title}
          </Link>
        ))}
      </div>
      {tag ? <p className="muted">Тег: #{tag}</p> : null}
      <div className="blog-layout">
        <div className="blog-feed">
          {items.length ? (
            <>
              <BlogFeaturedCard post={featured} />
              {rest.map((post) => (
                <BlogCompactCard key={post.id} post={post} />
              ))}
            </>
          ) : (
            <BlogEmpty
              title="Публикаций пока нет"
              text="Когда редакция или авторы отправят материалы и они пройдут проверку, они появятся здесь."
            />
          )}
        </div>
        <aside className="blog-side">
          <div className="blog-side__panel">
            <h2>Популярное за неделю</h2>
            {popular.length ? (
              <ol className="blog-popular">
                {popular.map((post, index) => (
                  <li key={post.id}>
                    <Link href={`/blog/${post.slug}`} className="blog-popular__item">
                      <span className="blog-popular__rank" aria-hidden>
                        {index + 1}
                      </span>
                      <span className="blog-popular__title">{post.title}</span>
                    </Link>
                  </li>
                ))}
              </ol>
            ) : (
              <p className="muted">Пока нечего показать.</p>
            )}
          </div>
          {tags.length ? (
            <div className="blog-side__panel">
              <h2>Теги</h2>
              <div className="blog-side__tags">
                {tags.map((item) => (
                  <Link key={item.slug} href={`/blog?tag=${item.slug}`} className={tag === item.slug ? "is-active" : ""}>
                    {item.name}
                  </Link>
                ))}
              </div>
            </div>
          ) : null}
          <div className="blog-side__promo">
            <p className="blog-side__promo-title">Считаем цену под ключ</p>
            <p className="blog-side__promo-text">Курс, пошлины и доставка до вашего города — в одном расчёте.</p>
            <Link href="/customs-calculator" className="btn btn-primary">
              Открыть калькулятор
            </Link>
          </div>
        </aside>
      </div>
      <button type="button" className="blog-fab" onClick={startWriting}>
        <PlusIcon />
        Написать
      </button>
    </BlogChrome>
  );
}
