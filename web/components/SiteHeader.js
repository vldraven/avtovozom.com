import Link from "next/link";

import SiteLogo from "./SiteLogo";

/**
 * Общий header consumer + staff.
 * Сложные меню (бургер на главной/каталоге) пока остаются локально — подключаются отдельно.
 */
export default function SiteHeader({
  logoHref = "/",
  tagline = null,
  children = null,
  authBarClassName = "",
  authBarStyle = undefined,
  className = "",
}) {
  const logo = <SiteLogo href={logoHref} />;

  return (
    <header className={`site-header${className ? ` ${className}` : ""}`}>
      <div className="container site-header__inner">
        {tagline ? (
          <div className="site-header__brand">
            {logo}
            <span className="site-tagline">{tagline}</span>
          </div>
        ) : (
          logo
        )}
        {children != null ? (
          <div className={`auth-bar${authBarClassName ? ` ${authBarClassName}` : ""}`} style={authBarStyle}>
            {children}
          </div>
        ) : null}
      </div>
    </header>
  );
}
