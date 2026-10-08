import Link from "next/link";

/**
 * Согласие на обработку ПДн + принятие соглашения.
 * @param {{
 *   checked: boolean,
 *   onChange: (next: boolean) => void,
 *   id?: string,
 *   className?: string,
 * }} props
 */
export default function PdConsentCheckbox({
  checked,
  onChange,
  id = "pd-consent",
  className = "",
}) {
  return (
    <label className={`pd-consent${className ? ` ${className}` : ""}`} htmlFor={id}>
      <input
        id={id}
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span>
        Я соглашаюсь с{" "}
        <Link href="/privacy" target="_blank" rel="noopener noreferrer">
          политикой обработки персональных данных
        </Link>{" "}
        и{" "}
        <Link href="/terms" target="_blank" rel="noopener noreferrer">
          пользовательским соглашением
        </Link>
      </span>
    </label>
  );
}
