import Link from "next/link";
import { useEffect, useState } from "react";

import { getStoredToken } from "../../lib/auth";
import { formatBlogRelative } from "../../lib/blogFormat";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

function CommentItem({ comment, onReply, onChanged }) {
  const [busy, setBusy] = useState(false);

  async function toggleLike() {
    const token = getStoredToken();
    if (!token) {
      window.location.href = `/auth?next=${encodeURIComponent(window.location.pathname)}`;
      return;
    }
    setBusy(true);
    try {
      const res = await fetch(`${API_URL}/blog/comments/${comment.id}/likes`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) onChanged();
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    const token = getStoredToken();
    if (!token || !window.confirm("Удалить комментарий?")) return;
    setBusy(true);
    try {
      const res = await fetch(`${API_URL}/blog/comments/${comment.id}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) onChanged();
    } finally {
      setBusy(false);
    }
  }

  return (
    <article className={`blog-comment${comment.parent_id ? " blog-comment--reply" : ""}`}>
      <span className="blog-avatar" aria-hidden>
        {comment.author?.initials || "AV"}
      </span>
      <div>
        <p className="blog-comment__head">
          <strong>{comment.author?.name}</strong>
          {comment.is_post_author ? <span className="blog-comment__badge">Автор</span> : null}
          <span>{formatBlogRelative(comment.created_at)}</span>
        </p>
        <p className="blog-comment__body">{comment.body}</p>
        <div className="blog-comment__actions">
          <button type="button" onClick={toggleLike} disabled={busy}>
            {comment.like_count || 0}
          </button>
          {!comment.parent_id ? (
            <button type="button" onClick={() => onReply(comment)}>
              Ответить
            </button>
          ) : null}
          {comment.can_delete ? (
            <button type="button" onClick={remove} disabled={busy}>
              Удалить
            </button>
          ) : null}
        </div>
        {(comment.replies || []).map((reply) => (
          <CommentItem key={reply.id} comment={reply} onReply={onReply} onChanged={onChanged} />
        ))}
      </div>
    </article>
  );
}

export default function BlogComments({ slug, comments, onChanged }) {
  const [token, setToken] = useState("");
  const [text, setText] = useState("");
  const [replyTo, setReplyTo] = useState(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setToken(getStoredToken());
  }, []);

  async function submit(event) {
    event.preventDefault();
    const auth = getStoredToken();
    if (!auth) {
      window.location.href = `/auth?next=${encodeURIComponent(`/blog/${slug}`)}`;
      return;
    }
    setBusy(true);
    setError("");
    try {
      const res = await fetch(`${API_URL}/blog/posts/${slug}/comments`, {
        method: "POST",
        headers: { Authorization: `Bearer ${auth}`, "Content-Type": "application/json" },
        body: JSON.stringify({ body: text, parent_id: replyTo?.id || null }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.detail || "Не удалось отправить комментарий.");
        return;
      }
      setText("");
      setReplyTo(null);
      onChanged();
    } finally {
      setBusy(false);
    }
  }

  const nextPath = `/blog/${slug}`;
  const total = countComments(comments);

  return (
    <section className="blog-comments" id="comments">
      <h2>{total > 0 ? `Комментарии · ${total}` : "Комментарии"}</h2>
      {token ? (
        <form onSubmit={submit} className="blog-comments__form">
          {replyTo ? (
            <p className="blog-comments__replying">
              Ответ для {replyTo.author?.name}
              <button type="button" onClick={() => setReplyTo(null)}>
                Отмена
              </button>
            </p>
          ) : null}
          <textarea
            value={text}
            onChange={(event) => setText(event.target.value)}
            placeholder="Написать комментарий"
            rows={3}
            maxLength={2000}
          />
          <div className="blog-comments__submit">
            <button type="submit" className="btn btn-primary" disabled={busy || text.trim().length < 2}>
              Отправить
            </button>
          </div>
          {error ? <p className="blog-form-error">{error}</p> : null}
        </form>
      ) : (
        <div className="blog-comments__gate">
          <p>Войдите или зарегистрируйтесь, чтобы писать комментарии, задавать вопросы и участвовать в обсуждении.</p>
          <div className="blog-comments__gate-actions">
            <Link href={`/auth?next=${encodeURIComponent(nextPath)}`} className="btn btn-primary">
              Войти
            </Link>
            <Link href={`/auth?mode=register&next=${encodeURIComponent(nextPath)}`} className="btn btn-secondary">
              Зарегистрироваться
            </Link>
          </div>
        </div>
      )}
      <div className="blog-comments__list">
        {(comments || []).map((comment) => (
          <CommentItem key={comment.id} comment={comment} onReply={setReplyTo} onChanged={onChanged} />
        ))}
      </div>
    </section>
  );
}

function countComments(comments) {
  return (comments || []).reduce((sum, comment) => sum + 1 + (comment.replies || []).length, 0);
}
