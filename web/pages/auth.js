import { useRouter } from "next/router";
import { useEffect, useState } from "react";

import AuthFlow from "../components/AuthFlow";
import SiteHeader from "../components/SiteHeader";

/**
 * Страница `/auth` для deep-link, staff-редиректов и восстановления пароля.
 * Не имитирует попап: обычная страница с карточкой формы.
 * Попап поверх текущего экрана — через AuthPromptModal.
 */
export default function AuthPage() {
  const router = useRouter();
  const nextUrl = typeof router.query.next === "string" ? router.query.next : "/";
  const [initialMode, setInitialMode] = useState("login");

  useEffect(() => {
    if (!router.isReady) return;
    if (router.query.mode === "register") setInitialMode("register");
    else if (router.query.mode === "forgot") setInitialMode("forgot");
    else setInitialMode("login");
  }, [router.isReady, router.query.mode]);

  return (
    <div className="layout layout--no-mobile-dock auth-layout">
      <SiteHeader />
      <main className="site-main auth-layout__main auth-layout__main--page">
        <div className="auth-page">
          <AuthFlow
            variant="page"
            initialMode={initialMode}
            nextUrl={nextUrl}
            syncQuery
            onClose={() => router.push(nextUrl || "/")}
            onComplete={(url) => router.push(url || nextUrl || "/")}
          />
        </div>
      </main>
    </div>
  );
}
