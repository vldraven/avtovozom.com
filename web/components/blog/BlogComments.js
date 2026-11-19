import Link from "next/link";
import { useEffect, useState } from "react";

import { getStoredToken } from "../../lib/auth";
import { formatBlogRelative } from "../../lib/blogFormat";
import { PdDistributionConsent } from "../PdConsentCheckbox";
import { PD_CONSENT_VERSION } from "../../lib/pdConsent";
import { useSiteMode } from "../../lib/siteMode";

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
  const [distributionConsent, setDistributionConsent] = useState(false);
  const [distributionGranted, setDistributionGranted] = useState(false);
  const { reviewMode } = useSiteMode();

  useEffect(() => {
    const auth = getStoredToken();
    setToken(auth);
    if (!auth) return undefined;
    let cancelled = false;
    (async () => {
      const res = await fetch(`${API_URL}/public/pd-consents/status`, {
        headers: { Authorization: `Bearer ${auth}` },
      });
      if (!res.ok || cancelled) return;
      const data = await res.json().catch(() => ({}));
      if (!cancelled) setDistributionGranted(Boolean(data.blog_distribution));
    })();
    return () => {
      cancelled = true;
    };
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
    if (!distributionGranted && !distributionConsent) {
      setError("Отметьте согласие на публикацию имени и текста комментария.");
      setBusy(false);
      return;
    }
    try {
      const res = await fetch(`${API_URL}/blog/posts/${slug}/comments`, {
        method: "POST",
        headers: { Authorization: `Bearer ${auth}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          body: text,
          parent_id: replyTo?.id || null,
          distribution_consent: distributionGranted || distributionConsent,
          consent_version: PD_CONSENT_VERSION,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.detail || "Не удалось отправить комментарий.");
        return;
      }
      setText("");
      setReplyTo(null);
      setDistributionGranted(true);
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
      {reviewMode ? null : token ? (
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
            className="ym-disable-keys"
            value={text}
            onChange={(event) => setText(event.target.value)}
            placeholder="Написать комментарий"
            rows={3}
            maxLength={2000}
          />
          {distributionGranted ? null : (
            <PdDistributionConsent
              checked={distributionConsent}
              onChange={setDistributionConsent}
              id="blog-distribution-consent"
            />
          )}
          <div className="blog-comments__submit">
            <button
              type="submit"
              className="btn btn-primary"
              disabled={busy || text.trim().length < 2 || (!distributionGranted && !distributionConsent)}
            >
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
