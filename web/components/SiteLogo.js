import Link from "next/link";

/**
 * Логотип + слово «avtovozom».
 * variant="light" — белая иконка (для тёмного фона).
 */
export default function SiteLogo({
  href = "/",
  variant = "default",
  className = "",
  textClassName = "",
}) {
  const mark =
    variant === "light" ? "/logo-avtovozom-white.png" : "/logo-avtovozom.png";

  return (
    <Link href={href} className={`site-logo${className ? ` ${className}` : ""}`}>
      <img src={mark} alt="" className="site-logo__mark" width={28} height={34} />
      <span className={`site-logo__text${textClassName ? ` ${textClassName}` : ""}`}>
        avtovozom
      </span>
    </Link>
  );
}
