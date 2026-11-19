import { COMPANY, phoneHref } from "../lib/companyInfo";

export default function ReviewModeNotice({ compact = false }) {
  const tel = phoneHref();
  return (
    <div className={`review-mode-notice${compact ? " review-mode-notice--compact" : ""}`} role="status">
      <p>
        Сейчас можно смотреть каталог, карточки и статьи. Заявки, чат и регистрация временно не
        принимаются.
      </p>
      {COMPANY.phone ? (
        <p>
          Связаться: <a href={`tel:${tel}`}>{COMPANY.phone}</a>
        </p>
      ) : null}
    </div>
  );
}
