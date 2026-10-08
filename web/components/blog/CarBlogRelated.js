import Link from "next/link";
import { useEffect, useState } from "react";

import { formatBlogRelative, postsCountLabel } from "../../lib/blogFormat";
import { mediaSrc } from "../../lib/media";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

export default function CarBlogRelated({ brandId, modelId, label }) {
  const [items, setItems] = useState([]);
  const [total, setTotal] = useState(0);

  useEffect(() => {
    if (!brandId && !modelId) return undefined;
    const params = new URLSearchParams();
    if (brandId) params.set("brand_id", String(brandId));
    if (modelId) params.set("model_id", String(modelId));
    params.set("limit", "1");
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`${API_URL}/blog/related?${params}`);
        if (!res.ok) {
          if (!cancelled) {
            setItems([]);
            setTotal(0);
          }
          return;
        }
        const body = await res.json();
        const nextItems = Array.isArray(body) ? body : body?.items || [];
        const nextTotal = Array.isArray(body) ? body.length : Number(body?.total) || nextItems.length;
        if (!cancelled) {
          setItems(nextItems);
          setTotal(nextTotal);
        }
      } catch {
        if (!cancelled) {
          setItems([]);
          setTotal(0);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [brandId, modelId]);

  const post = items[0];
  if (!post) return null;

  const title = label ? `${label} в блоге` : "В блоге";
  const sectionTitle = post.section?.title || "";
  const relative = formatBlogRelative(post.published_at);
  const mobileKicker = [sectionTitle, relative].filter(Boolean).join(" · ");
  const desktopKicker = [title, sectionTitle, relative].filter(Boolean).join(" · ");
  const authorName = post.author?.name || "";
  const allHref = "/blog";
  const allMobile = total > 0 ? `Все ${total}` : "Весь блог";
  const allDesktop = total > 0 ? `Все ${postsCountLabel(total)} →` : "Весь блог →";

  return (
    <section className="panel detail-panel blog-car-related" aria-label={title}>
      <div className="blog-car-related__head">
        <h2 className="blog-car-related__heading">{title}</h2>
        <Link href={allHref} className="blog-car-related__all">
          {allMobile}
        </Link>
      </div>

      <div className="blog-car-related__card">
        <Link href={`/blog/${post.slug}`} className="blog-car-related__main">
          <span className="blog-car-related__cover" aria-hidden>
            {post.cover_url ? <img src={mediaSrc(post.cover_url, 640)} alt="" /> : null}
          </span>
          <span className="blog-car-related__body">
            <span className="blog-car-related__kicker blog-car-related__kicker--mobile">
              {mobileKicker}
            </span>
            <span className="blog-car-related__kicker blog-car-related__kicker--desktop">
              {desktopKicker}
            </span>
            <span className="blog-car-related__title">{post.title}</span>
            {authorName ? <span className="blog-car-related__byline">{authorName}</span> : null}
          </span>
        </Link>
        <Link href={allHref} className="blog-car-related__all-desktop">
          {allDesktop}
        </Link>
      </div>
    </section>
  );
}
