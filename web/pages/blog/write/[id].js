import Head from "next/head";
import { useRouter } from "next/router";
import { useEffect, useState } from "react";

import BlogChrome from "../../../components/blog/BlogChrome";
import BlogEditor, { blocksFromPost } from "../../../components/blog/BlogEditor";
import { getStoredToken } from "../../../lib/auth";
import { isStaffRole } from "../../../lib/roles";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

function toEditor(post) {
  return {
    title: post.title || "",
    excerpt: post.excerpt || "",
    seo_description: post.seo_description || "",
    slug: post.slug || "",
    section_id: post.section?.id || null,
    brand_id: post.brand_id || null,
    model_id: post.model_id || null,
    cover_url: post.cover_url || "",
    body: blocksFromPost(post.body),
    tags: (post.tags || []).map((tag) => tag.name),
    as_editorial: Boolean(post.as_editorial),
    status: post.status,
    rejection_reason: post.rejection_reason || "",
  };
}

function payloadOf(post, staff) {
  const body = {
    title: post.title,
    excerpt: post.excerpt,
    seo_description: post.seo_description,
    section_id: post.section_id,
    brand_id: post.brand_id,
    model_id: post.model_id,
    cover_url: post.cover_url,
    body: post.body,
    tags: post.tags,
    as_editorial: post.as_editorial,
  };
  if (staff) body.slug = post.slug;
  return body;
}

export default function BlogWritePage() {
  const router = useRouter();
  const postId = router.query.id;
  const [token, setToken] = useState("");
  const [staff, setStaff] = useState(false);
  const [post, setPost] = useState(null);
  const [sections, setSections] = useState([]);
  const [brands, setBrands] = useState([]);
  const [models, setModels] = useState([]);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState(false);

  useEffect(() => {
    const next = getStoredToken();
    setToken(next);
    if (!next) router.replace(`/auth?next=/blog/write/${postId || ""}`);
  }, [router, postId]);

  useEffect(() => {
    if (!token || !postId) return undefined;
    let cancelled = false;
    (async () => {
      const headers = { Authorization: `Bearer ${token}` };
      const [meRes, postRes, sectionRes, brandRes] = await Promise.all([
        fetch(`${API_URL}/auth/me`, { headers }),
        fetch(`${API_URL}/blog/me/posts/${postId}`, { headers }),
        fetch(`${API_URL}/blog/sections`),
        fetch(`${API_URL}/catalog/brands`),
      ]);
      if (cancelled) return;
      if (meRes.ok) {
        const me = await meRes.json();
        setStaff(isStaffRole(me.role));
      }
      if (postRes.ok) {
        const found = await postRes.json();
        setPost(toEditor(found));
        setNotice(statusNotice(found));
      } else {
        setError("Публикация не найдена.");
      }
      if (sectionRes.ok) setSections(await sectionRes.json());
      if (brandRes.ok) setBrands(await brandRes.json());
    })();
    return () => {
      cancelled = true;
    };
  }, [token, postId]);

  useEffect(() => {
    if (!post?.brand_id) {
      setModels([]);
      return undefined;
    }
    let cancelled = false;
    (async () => {
      const res = await fetch(`${API_URL}/catalog/models?brand_id=${post.brand_id}`);
      if (!cancelled && res.ok) setModels(await res.json());
    })();
    return () => {
      cancelled = true;
    };
  }, [post?.brand_id]);

  async function save(action) {
    setBusy(true);
    setError("");
    try {
      const headers = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
      const saved = await fetch(`${API_URL}/blog/me/posts/${postId}`, {
        method: "PUT",
        headers,
        body: JSON.stringify(payloadOf(post, staff)),
      });
      const savedData = await saved.json().catch(() => ({}));
      if (!saved.ok) {
        setError(typeof savedData.detail === "string" ? savedData.detail : "Не удалось сохранить.");
        return;
      }
      setPost(toEditor(savedData));
      let current = savedData;
      if (action === "submit" && savedData.status !== "pending") {
        const next = await fetch(`${API_URL}/blog/me/posts/${postId}/submit`, { method: "POST", headers });
        const nextData = await next.json().catch(() => ({}));
        if (!next.ok) {
          setError(typeof nextData.detail === "string" ? nextData.detail : "Не удалось отправить.");
          return;
        }
        current = nextData;
        setPost(toEditor(current));
      }
      if (action === "publish" && savedData.status !== "published") {
        const next = await fetch(`${API_URL}/blog/me/posts/${postId}/publish`, { method: "POST", headers });
        const nextData = await next.json().catch(() => ({}));
        if (!next.ok) {
          setError(typeof nextData.detail === "string" ? nextData.detail : "Не удалось опубликовать.");
          return;
        }
        current = nextData;
        setPost(toEditor(current));
      }
      setNotice(statusNotice(current));
      if (current.status === "published" && action === "publish") router.push(`/blog/${current.slug}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <BlogChrome>
      <Head>
        <title>Редактор публикации</title>
        <meta name="robots" content="noindex" />
      </Head>
      {!post ? (
        <p className="muted">{error || "Загрузка редактора…"}</p>
      ) : (
        <BlogEditor
          post={post}
          sections={sections}
          brands={brands}
          models={models}
          token={token}
          staff={staff}
          editorKey={String(postId || "")}
          busy={busy}
          error={error}
          notice={notice}
          preview={preview}
          onChange={setPost}
          onError={setError}
          onBrand={() => {}}
          onPreview={() => setPreview((value) => !value)}
          onSave={() => save("")}
          onSubmit={() => save("submit")}
          onPublish={() => save("publish")}
        />
      )}
    </BlogChrome>
  );
}

function statusNotice(post) {
  if (post.status === "pending") return "На проверке";
  if (post.status === "published") return "Опубликовано";
  if (post.status === "rejected") return `Отклонено: ${post.rejection_reason || "без комментария"}`;
  return "Черновик";
}
