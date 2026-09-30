import Link from "next/link";
import { useEffect, useState } from "react";

import { BlogCompactCard } from "./BlogCards";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

export default function CarBlogRelated({ brandId, modelId, label }) {
  const [items, setItems] = useState([]);

  useEffect(() => {
    if (!brandId && !modelId) return undefined;
    const params = new URLSearchParams();
    if (brandId) params.set("brand_id", String(brandId));
    if (modelId) params.set("model_id", String(modelId));
    params.set("limit", "3");
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`${API_URL}/blog/related?${params}`);
        if (!cancelled && res.ok) setItems(await res.json());
      } catch {
        if (!cancelled) setItems([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [brandId, modelId]);

  if (!items.length) return null;
  return (
    <section className="blog-car-related" aria-label="Читайте также">
      <div className="blog-car-related__head">
        <h2>Читайте также{label ? ` о ${label}` : ""}</h2>
        <Link href="/blog">Весь блог</Link>
      </div>
      <div className="blog-feed">
        {items.map((post) => (
          <BlogCompactCard key={post.id} post={post} />
        ))}
      </div>
    </section>
  );
}
