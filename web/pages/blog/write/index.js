import { useRouter } from "next/router";
import { useEffect } from "react";

import BlogChrome from "../../../components/blog/BlogChrome";
import { getStoredToken } from "../../../lib/auth";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

export default function BlogWriteStartPage() {
  const router = useRouter();

  useEffect(() => {
    const token = getStoredToken();
    if (!token) {
      router.replace("/auth?next=/blog/write");
      return undefined;
    }
    let cancelled = false;
    (async () => {
      const res = await fetch(`${API_URL}/blog/me/posts`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ title: "" }),
      });
      if (cancelled) return;
      if (res.status === 401) {
        router.replace("/auth?next=/blog/write");
        return;
      }
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.id) router.replace(`/blog/write/${data.id}`);
    })();
    return () => {
      cancelled = true;
    };
  }, [router]);

  return (
    <BlogChrome>
      <p className="muted">Открываем редактор…</p>
    </BlogChrome>
  );
}
