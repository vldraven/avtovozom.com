import { COMPANY, phoneHref } from "../lib/companyInfo";

/** Телефон компании в шапке — только на desktop (см. .site-header-phone в CSS). */
export default function SiteHeaderPhoneLink({ className = "" }) {
  if (!COMPANY.phone) return null;
  const tel = phoneHref();
  return (
    <a
      href={`tel:${tel}`}
      className={`site-header-phone${className ? ` ${className}` : ""}`}
    >
      {COMPANY.phone}
    </a>
  );
}
