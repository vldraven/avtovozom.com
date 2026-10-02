import Head from "next/head";
import Link from "next/link";
import { useRouter } from "next/router";
import { useEffect, useMemo, useState } from "react";

import SiteHeader from "../../components/SiteHeader";
import { getStoredToken } from "../../lib/auth";
import { formatBlogDate } from "../../lib/blogFormat";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";
const FILTERS = [
  ["", "Все"],
  ["published", "Опубликовано"],
  ["pending", "На проверке"],
  ["draft", "Черновики"],
  ["rejected", "Отклонено"],
];

export default function MyPostsPage() {
  const router = useRouter();
  const [token, setToken] = useState("");
  const [posts, setPosts] = useState([]);
  const [filter, setFilter] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    const next = getStoredToken();
    if (!next) {
      router.replace("/auth?next=/profile/posts");
      return;
    }
    setToken(next);
  }, [router]);

  useEffect(() => {
    if (!token) return undefined;
    let cancelled = false;
    (async () => {
      const res = await fetch(`${API_URL}/blog/me/posts`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (cancelled) return;
      if (!res.ok) {
        setError("Не удалось загрузить публикации.");
        return;
      }
      setPosts(await res.json());
    })();
    return () => {
      cancelled = true;
    };
  }, [token]);

  const visible = useMemo(
    () => posts.filter((post) => !filter || post.status === filter),
    [posts, filter]
  );
  const pending = posts.filter((post) => post.status === "pending").length;

  async function act(post, action) {
    if (action === "delete" && !window.confirm("Удалить публикацию?")) return;
    const res = await fetch(
      action === "delete" ? `${API_URL}/blog/me/posts/${post.id}` : `${API_URL}/blog/me/posts/${post.id}/${action}`,
      {
        method: action === "delete" ? "DELETE" : "POST",
        headers: { Authorization: `Bearer ${token}` },
      }
    );
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      const detail = data.detail;
      setError(
        typeof detail === "string"
          ? detail
          : Array.isArray(detail)
            ? detail.map((item) => item.msg || JSON.stringify(item)).join(" ")
            : "Не удалось выполнить действие."
      );
      return;
    }
    if (action === "delete") setPosts((list) => list.filter((item) => item.id !== post.id));
    else {
      const updated = await res.json();
      setPosts((list) => list.map((item) => (item.id === post.id ? { ...item, ...updated } : item)));
    }
  }

  return (
    <div className="layout">
      <Head>
        <title>Мои публикации</title>
      </Head>
      <SiteHeader tagline="Профиль">
        <Link href="/profile" className="btn btn-ghost btn-sm">
          Профиль
        </Link>
        <Link href="/blog" className="btn btn-secondary btn-sm">
          Блог
        </Link>
      </SiteHeader>
      <main className="site-main">
        <div className="container blog-mine">
          <header className="blog-hero">
            <div>
              <h1>Мои публикации</h1>
              <p className="muted">
                {posts.length} в списке
                {pending ? ` · ${pending} ждёт проверки модератором` : ""}
              </p>
            </div>
            <Link href="/blog/write" className="btn btn-primary">
              Написать публикацию
            </Link>
          </header>
          {error ? <p className="blog-form-error">{error}</p> : null}
          <div className="blog-chips">
            {FILTERS.map(([id, label]) => (
              <button key={id || "all"} type="button" className={filter === id ? "is-active" : ""} onClick={() => setFilter(id)}>
                {label}
                {id ? ` · ${posts.filter((post) => post.status === id).length}` : ` · ${posts.length}`}
              </button>
            ))}
          </div>
          <div className="blog-mine__list">
            {visible.map((post) => (
              <article key={post.id} className="blog-mine__card">
                <p className={`blog-status blog-status--${post.status}`}>{statusLabel(post.status)}</p>
                <p className="muted">
                  {post.published_at
                    ? formatBlogDate(post.published_at, { withYear: false })
                    : formatBlogDate(post.updated_at, { withYear: false })}
                  {post.section ? ` · ${post.section.title}` : " · раздел не выбран"}
                </p>
                <h2>{post.title}</h2>
                {post.status === "rejected" && post.rejection_reason ? <p>Причина: {post.rejection_reason}</p> : null}
                {post.status === "pending" ? <p className="muted">Модератор проверит публикацию. Уведомление придёт в чат.</p> : null}
                <div className="blog-mine__actions">
                  <Link href={`/blog/write/${post.id}`} className="btn btn-secondary btn-sm">
                    {post.status === "draft" || post.status === "rejected" ? "Продолжить" : "Редактировать"}
                  </Link>
                  {post.status === "published" ? (
                    <Link href={`/blog/${post.slug}`} className="btn btn-ghost btn-sm">
                      Смотреть
                    </Link>
                  ) : null}
                  {post.status === "pending" ? (
                    <button type="button" className="btn btn-ghost btn-sm" onClick={() => act(post, "withdraw")}>
                      Отозвать
                    </button>
                  ) : null}
                  <button type="button" className="btn btn-ghost btn-sm" onClick={() => act(post, "delete")}>
                    Удалить
                  </button>
                </div>
              </article>
            ))}
            {!visible.length ? <p className="muted">В этом разделе пусто.</p> : null}
          </div>
        </div>
      </main>
    </div>
  );
}

function statusLabel(status) {
  if (status === "published") return "Опубликовано";
  if (status === "pending") return "На проверке";
  if (status === "rejected") return "Отклонено";
  return "Черновик";
}
