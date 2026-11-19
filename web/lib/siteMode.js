import { createContext, useContext, useEffect, useState } from "react";

import { clearToken, getStoredToken } from "./auth";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

export const SiteModeContext = createContext({
  reviewMode: false,
  /** null, пока не узнали флаг: Метрику до этого не грузим. */
  reviewKnown: false,
});

export function useSiteMode() {
  return useContext(SiteModeContext);
}

export function SiteModeProvider({ children }) {
  const [reviewMode, setReviewMode] = useState(false);
  const [reviewKnown, setReviewKnown] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      let enabled = false;
      try {
        const res = await fetch(`${API_URL}/public/site-mode`);
        if (res.ok) {
          const data = await res.json();
          enabled = Boolean(data.review_mode);
        }
      } catch {
        enabled = false;
      }
      if (cancelled) return;
      setReviewMode(enabled);
      setReviewKnown(true);
      if (!enabled) return;
      const token = getStoredToken();
      if (!token) return;
      try {
        const meRes = await fetch(`${API_URL}/auth/me`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!meRes.ok) {
          clearToken();
          return;
        }
        const me = await meRes.json();
        if (me.role !== "admin") clearToken();
      } catch {
        /* сеть не должна разлогинивать администратора вслепую */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <SiteModeContext.Provider value={{ reviewMode, reviewKnown }}>
      {children}
    </SiteModeContext.Provider>
  );
}
