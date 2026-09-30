import Head from "next/head";
import Link from "next/link";
import { useRouter } from "next/router";
import { useEffect, useState } from "react";

import SiteHeader from "../../components/SiteHeader";
import { getStoredToken } from "../../lib/auth";
import { isAdminRole, isStaffRole } from "../../lib/roles";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

export default function AdminBlogPage() {
  const router = useRouter();
  const [token, setToken] = useState("");
  const [admin, setAdmin] = useState(false);
  const [posts, setPosts] = useState([]);
  const [sections, setSections] = useState([]);
  const [status, setStatus] = useState("pending");
  const [error, setError] = useState("");
  const [draft, setDraft] = useState({ title: "", description: "", slug: "", sort_order: 60, is_hidden: false });

  useEffect(() => {
    const next = getStoredToken();
    if (!next) {
      router.replace("/auth?next=/staff/admin-blog");
      return;
    }
    setToken(next);
  }, [router]);

  useEffect(() => {
    if (!token) return undefined;
    let cancelled = false;
    (async () => {
      const headers = { Authorization: `Bearer ${token}` };
      const meRes = await fetch(`${API_URL}/auth/me`, { headers });
      if (!meRes.ok) return;
      const me = await meRes.json();
      if (cancelled) return;
      if (!isStaffRole(me.role)) {
        setError("Раздел доступен редакции.");
        return;
      }
      setAdmin(isAdminRole(me.role));
      await reload(headers, status, isAdminRole(me.role));
    })();
    return () => {
      cancelled = true;
    };
  }, [token, status]);

  async function reload(headers, nextStatus, isAdmin) {
    const postRes = await fetch(`${API_URL}/blog/admin/posts?status=${nextStatus}`, { headers });
    if (postRes.ok) setPosts(await postRes.json());
    if (isAdmin) {
      const sectionRes = await fetch(`${API_URL}/blog/admin/sections`, { headers });
      if (sectionRes.ok) setSections(await sectionRes.json());
    }
  }

  async function moderate(post, action, reason) {
    const headers = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
    const res = await fetch(`${API_URL}/blog/admin/posts/${post.id}/${action}`, {
      method: "POST",
      headers,
      body: action === "reject" ? JSON.stringify({ reason }) : undefined,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setError(typeof data.detail === "string" ? data.detail : "Не удалось сохранить решение.");
      return;
    }
    setPosts((list) => list.filter((item) => item.id !== post.id));
  }

  async function saveSection(section) {
    const headers = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
    const res = await fetch(`${API_URL}/blog/admin/sections/${section.id}`, {
      method: "PUT",
      headers,
      body: JSON.stringify(section),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(typeof data.detail === "string" ? data.detail : "Не удалось сохранить раздел.");
      return;
    }
    const saved = await res.json();
    setSections((list) => list.map((item) => (item.id === saved.id ? { ...item, ...saved } : item)));
  }

  async function createSection(event) {
    event.preventDefault();
    const headers = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
    const res = await fetch(`${API_URL}/blog/admin/sections`, {
      method: "POST",
      headers,
      body: JSON.stringify(draft),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setError(typeof data.detail === "string" ? data.detail : "Не удалось создать раздел.");
      return;
    }
    setSections((list) => [...list, data]);
    setDraft({ title: "", description: "", slug: "", sort_order: 60, is_hidden: false });
  }

  return (
    <div className="layout">
      <Head>
        <title>Модерация блога</title>
      </Head>
      <SiteHeader tagline="Блог">
        <Link href="/blog" className="btn btn-ghost btn-sm">
          Открыть блог
        </Link>
      </SiteHeader>
      <main className="site-main">
        <div className="container blog-mine">
          <h1>Модерация блога</h1>
          {error ? <p className="blog-form-error">{error}</p> : null}
          <div className="blog-chips">
            {["pending", "published", "rejected", "draft"].map((id) => (
              <button key={id} type="button" className={status === id ? "is-active" : ""} onClick={() => setStatus(id)}>
                {id === "pending" ? "На проверке" : id === "published" ? "Опубликовано" : id === "rejected" ? "Отклонено" : "Черновики"}
              </button>
            ))}
          </div>
          <div className="blog-mine__list">
            {posts.map((post) => (
              <article key={post.id} className="blog-mine__card">
                <h2>{post.title}</h2>
                <p className="muted">
                  {post.author?.name}
                  {post.section ? ` · ${post.section.title}` : ""}
                </p>
                {post.excerpt ? <p>{post.excerpt}</p> : null}
                {post.rejection_reason ? <p>Причина: {post.rejection_reason}</p> : null}
                <div className="blog-mine__actions">
                  {post.status === "published" ? (
                    <Link href={`/blog/${post.slug}`} className="btn btn-ghost btn-sm">
                      Смотреть
                    </Link>
                  ) : null}
                  {post.status === "pending" ? (
                    <>
                      <button type="button" className="btn btn-primary btn-sm" onClick={() => moderate(post, "approve")}>
                        Опубликовать
                      </button>
                      <button
                        type="button"
                        className="btn btn-secondary btn-sm"
                        onClick={() => {
                          const reason = window.prompt("Причина отклонения");
                          if (reason) moderate(post, "reject", reason);
                        }}
                      >
                        Отклонить
                      </button>
                    </>
                  ) : null}
                </div>
              </article>
            ))}
            {!posts.length ? <p className="muted">Список пуст.</p> : null}
          </div>

          {admin ? (
            <section className="panel blog-sections-admin">
              <h2>Разделы</h2>
              {sections.map((section) => (
                <form
                  key={section.id}
                  className="blog-sections-admin__row"
                  onSubmit={(event) => {
                    event.preventDefault();
                    saveSection(section);
                  }}
                >
                  <input
                    value={section.title}
                    onChange={(event) =>
                      setSections((list) => list.map((item) => (item.id === section.id ? { ...item, title: event.target.value } : item)))
                    }
                  />
                  <input
                    value={section.description || ""}
                    onChange={(event) =>
                      setSections((list) =>
                        list.map((item) => (item.id === section.id ? { ...item, description: event.target.value } : item))
                      )
                    }
                  />
                  <label className="blog-check">
                    <input
                      type="checkbox"
                      checked={Boolean(section.is_hidden)}
                      onChange={(event) =>
                        setSections((list) =>
                          list.map((item) => (item.id === section.id ? { ...item, is_hidden: event.target.checked } : item))
                        )
                      }
                    />
                    Скрыт
                  </label>
                  <button type="submit" className="btn btn-secondary btn-sm">
                    Сохранить
                  </button>
                </form>
              ))}
              <form className="blog-sections-admin__row" onSubmit={createSection}>
                <input
                  placeholder="Новый раздел"
                  value={draft.title}
                  onChange={(event) => setDraft({ ...draft, title: event.target.value })}
                />
                <input
                  placeholder="Короткое описание"
                  value={draft.description}
                  onChange={(event) => setDraft({ ...draft, description: event.target.value })}
                />
                <button type="submit" className="btn btn-primary btn-sm">
                  Добавить
                </button>
              </form>
            </section>
          ) : null}
        </div>
      </main>
    </div>
  );
}
