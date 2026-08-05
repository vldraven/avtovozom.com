import { useRouter } from "next/router";
import { useEffect, useState } from "react";

import AuthFlow from "./AuthFlow";

/**
 * Модалка входа/регистрации поверх текущей страницы.
 * Deep-link `/auth` остаётся отдельной страницей для staff и прямых ссылок.
 */
export default function AuthPromptModal({
  open,
  onClose,
  title = "Войдите, чтобы продолжить",
  description = "Переписка по сделке, избранное и договорённости хранятся в вашем кабинете.",
  nextPath,
  benefits,
  showQuoteCta = true,
  initialMode = "login",
}) {
  const router = useRouter();
  const [step, setStep] = useState("gate");

  useEffect(() => {
    if (!open) setStep("gate");
  }, [open]);

  if (!open) return null;

  const next =
    nextPath ||
    (typeof router.asPath === "string" && router.asPath ? router.asPath : "/");

  return (
    <div
      className="modal-overlay auth-prompt-overlay"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      {step === "gate" ? (
        <div
          className="modal-dialog auth-prompt-modal"
          role="dialog"
          aria-modal="true"
          aria-labelledby="auth-prompt-title"
          onMouseDown={(e) => e.stopPropagation()}
        >
          <div className="auth-prompt-modal__head">
            <h2 id="auth-prompt-title" className="section-title auth-prompt-modal__title">
              {title}
            </h2>
            <button type="button" className="auth-card__close" aria-label="Закрыть" onClick={onClose}>
              ✕
            </button>
          </div>
          <p className="muted auth-prompt-modal__desc">{description}</p>
          {benefits?.length ? (
            <ul className="auth-prompt-modal__benefits">
              {benefits.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          ) : null}
          <div className="auth-prompt-modal__actions">
            <button type="button" className="btn btn-primary" onClick={() => setStep("auth")}>
              Войти или зарегистрироваться
            </button>
            {showQuoteCta ? (
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => {
                  onClose();
                  router.push("/request-quote");
                }}
              >
                Оставить заявку без входа
              </button>
            ) : null}
            <button type="button" className="btn btn-ghost" onClick={onClose}>
              Закрыть
            </button>
          </div>
        </div>
      ) : (
        <div className="auth-prompt-flow" onMouseDown={(e) => e.stopPropagation()}>
          <AuthFlow
            variant="modal"
            initialMode={initialMode}
            nextUrl={next}
            onClose={onClose}
            onComplete={() => {
              onClose();
            }}
          />
        </div>
      )}
    </div>
  );
}
