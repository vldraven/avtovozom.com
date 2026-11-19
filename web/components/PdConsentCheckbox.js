import Link from "next/link";

import { COMPANY } from "../lib/companyInfo";
import { forgetGuestPdConsent, rememberGuestPdConsent } from "../lib/pdConsent";

function operatorName() {
  const name = COMPANY.legalName || COMPANY.brandName;
  return COMPANY.inn ? `${name} (ИНН ${COMPANY.inn})` : name;
}

export function PdProcessingConsent({ checked, onChange, id = "pd-consent", guest = false }) {
  return (
    <label className="pd-consent" htmlFor={id}>
      <input
        id={id}
        type="checkbox"
        checked={checked}
        onChange={(e) => {
          const next = e.target.checked;
          if (guest) {
            if (next) rememberGuestPdConsent();
            else forgetGuestPdConsent();
          }
          onChange(next);
        }}
      />
      <span>
        {guest ? (
          <>
            Я даю согласие {operatorName()} на обработку текста сообщения и контактов, которые сам
            укажу, чтобы ответить в этом чате. Сообщение видят сотрудники оператора; уведомление
            может уйти в Telegram, а текст — в сервис автоматического ответа.{" "}
          </>
        ) : (
          <>
            Я даю согласие {operatorName()} на обработку моего имени, телефона, адреса электронной
            почты и текста обращения, чтобы ответить на заявку и связаться со мной. Срок — до отзыва
            либо 3 года после последнего обращения.{" "}
          </>
        )}
        <Link href="/consent" target="_blank" rel="noopener noreferrer">
          Текст согласия
        </Link>
        .
      </span>
    </label>
  );
}

export function PdTermsConsent({ checked, onChange, id = "terms-consent" }) {
  return (
    <label className="pd-consent" htmlFor={id}>
      <input id={id} type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span>
        Я принимаю{" "}
        <Link href="/terms" target="_blank" rel="noopener noreferrer">
          пользовательское соглашение
        </Link>
        . Это отдельное подтверждение и оно не заменяет согласие на обработку персональных данных.
      </span>
    </label>
  );
}

export function PdDistributionConsent({ checked, onChange, id = "distribution-consent" }) {
  return (
    <label className="pd-consent" htmlFor={id}>
      <input id={id} type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span>
        Я согласен на распространение моего имени и этого текста на сайте avtovozom.com.{" "}
        <Link href="/consent" target="_blank" rel="noopener noreferrer">
          Условия распространения
        </Link>
        .
      </span>
    </label>
  );
}

export default function PdConsentFields({
  pdConsent,
  onPdConsent,
  termsAccepted,
  onTermsAccepted,
  idPrefix = "pd",
}) {
  return (
    <div className="pd-consent-stack">
      <PdProcessingConsent checked={pdConsent} onChange={onPdConsent} id={`${idPrefix}-pd-consent`} />
      <PdTermsConsent checked={termsAccepted} onChange={onTermsAccepted} id={`${idPrefix}-terms-consent`} />
    </div>
  );
}
