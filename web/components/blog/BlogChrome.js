import Link from "next/link";
import { useEffect, useState } from "react";

import HeaderFavoritesLink from "../HeaderFavoritesLink";
import HeaderMessagesLink from "../HeaderMessagesLink";
import HeaderProfileLink from "../HeaderProfileLink";
import SiteHeader from "../SiteHeader";
import SiteHeaderDesktopNav from "../SiteHeaderDesktopNav";
import { getStoredToken } from "../../lib/auth";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

export default function BlogChrome({ children }) {
  const [token, setToken] = useState("");
  const [me, setMe] = useState(null);

  useEffect(() => {
    const next = getStoredToken();
    setToken(next);
    if (!next) {
      setMe(null);
      return undefined;
    }
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`${API_URL}/auth/me`, {
          headers: { Authorization: `Bearer ${next}` },
        });
        if (!cancelled) setMe(res.ok ? await res.json() : null);
      } catch {
        if (!cancelled) setMe(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="layout">
      <SiteHeader className="home-only-mobile" tagline="Блог">
        <Link href="/catalog" className="btn btn-ghost btn-sm">
          Каталог
        </Link>
        {token ? (
          <>
            <HeaderMessagesLink token={token} />
            <HeaderProfileLink token={token} me={me} />
            <HeaderFavoritesLink token={token} />
          </>
        ) : (
          <Link href="/auth?next=/blog" className="btn btn-primary btn-sm">
            Войти
          </Link>
        )}
      </SiteHeader>
      <SiteHeaderDesktopNav active="blog" token={token} me={me} />
      <main className="site-main site-main--blog">
        <div className="container">{children}</div>
      </main>
    </div>
  );
}
