import Head from "next/head";
import Link from "next/link";

import BlogChrome from "../../components/blog/BlogChrome";
import { getServerApiBase } from "../../lib/serverApiUrl";
import { absoluteUrl } from "../../lib/siteUrl";

export async function getServerSideProps() {
  const api = getServerApiBase();
  try {
    const [sectionsRes, tagsRes] = await Promise.all([
      fetch(`${api}/blog/sections`, { headers: { Accept: "application/json" } }),
      fetch(`${api}/blog/tags?limit=16`, { headers: { Accept: "application/json" } }),
    ]);
    return {
      props: {
        sections: sectionsRes.ok ? await sectionsRes.json() : [],
        tags: tagsRes.ok ? await tagsRes.json() : [],
      },
    };
  } catch {
    return { props: { sections: [], tags: [] } };
  }
}

const TITLE = "Разделы блога Автовозом";
const DESCRIPTION = "Импорт и таможня, обзоры моделей, технические характеристики, обслуживание и опыт владельцев.";

export default function BlogSectionsPage({ sections, tags }) {
  return (
    <BlogChrome>
      <Head>
        <title>{TITLE}</title>
        <meta name="description" content={DESCRIPTION} />
        <link rel="canonical" href={absoluteUrl("/blog/sections")} />
      </Head>
      <header className="blog-hero">
        <div>
          <p className="blog-crumb">
            <Link href="/blog">Блог</Link>
          </p>
          <h1>Разделы</h1>
        </div>
      </header>
      <div className="blog-sections">
        {(sections || []).map((section) => (
          <Link key={section.id} href={`/blog?section=${section.slug}`} className="blog-section-card">
            <h2>{section.title}</h2>
            <p>
              {section.description}
              {section.description ? " · " : ""}
              {section.posts_count}
            </p>
          </Link>
        ))}
      </div>
      <section className="blog-tag-cloud">
        <h2>Популярные теги</h2>
        <div className="blog-chips">
          {(tags || []).map((tag) => (
            <Link key={tag.slug} href={`/blog?tag=${tag.slug}`}>
              {tag.name}
            </Link>
          ))}
        </div>
      </section>
    </BlogChrome>
  );
}
