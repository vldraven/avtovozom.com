import Link from "next/link";
import { useRouter } from "next/router";

/**
 * Предложение войти (избранное, заявки и т.п.).
 */
export default function AuthPromptModal({
  open,
  onClose,
  title = "Войдите в аккаунт",
  description = "Чтобы сохранять объявления в избранное, нужно авторизоваться.",
  nextPath,
}) {
  const router = useRouter();
  if (!open) return null;

  const next =
    nextPath ||
    (typeof router.asPath === "string" && router.asPath ? router.asPath : "/");

  return (
    <div
      className="modal-overlay"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="modal-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="auth-prompt-title"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <h2 id="auth-prompt-title" className="section-title" style={{ fontSize: "1.2rem", marginTop: 0 }}>
          {title}
        </h2>
        <p className="muted" style={{ marginBottom: "1.25rem" }}>
          {description}
        </p>
        <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", flexWrap: "wrap" }}>
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            Отмена
          </button>
          <Link
            href={`/auth?next=${encodeURIComponent(next)}`}
            className="btn btn-primary"
            onClick={onClose}
          >
            Войти
          </Link>
        </div>
      </div>
    </div>
  );
}
