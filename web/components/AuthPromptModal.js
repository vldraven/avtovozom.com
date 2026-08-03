import Link from "next/link";
import { useRouter } from "next/router";

const DEFAULT_BENEFITS = [
  "Безопасный чат с менеджером",
  "Избранное и уведомления о снижении цены",
  "Статус доставки и документы по сделке",
];

/**
 * Гейт входа при действии (избранное, чат и т.п.).
 * Заявка без входа остаётся доступной отдельно.
 */
export default function AuthPromptModal({
  open,
  onClose,
  title = "Войдите, чтобы продолжить",
  description = "Переписка по сделке, избранное и договорённости хранятся в вашем кабинете.",
  nextPath,
  benefits = DEFAULT_BENEFITS,
  showQuoteCta = true,
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
        className="modal-dialog auth-prompt-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="auth-prompt-title"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <h2 id="auth-prompt-title" className="section-title auth-prompt-modal__title">
          {title}
        </h2>
        <p className="muted auth-prompt-modal__desc">{description}</p>
        {benefits?.length ? (
          <ul className="auth-prompt-modal__benefits">
            {benefits.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        ) : null}
        <div className="auth-prompt-modal__actions">
          <Link
            href={`/auth?next=${encodeURIComponent(next)}`}
            className="btn btn-primary"
            onClick={onClose}
          >
            Войти или зарегистрироваться
          </Link>
          {showQuoteCta ? (
            <Link href="/request-quote" className="btn btn-secondary" onClick={onClose}>
              Оставить заявку без входа
            </Link>
          ) : null}
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            Закрыть
          </button>
        </div>
      </div>
    </div>
  );
}
