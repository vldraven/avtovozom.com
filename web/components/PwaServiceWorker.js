import { useEffect } from "react";

export default function PwaServiceWorker() {
  useEffect(() => {
    if (typeof window === "undefined" || !("serviceWorker" in navigator)) return;
    if (process.env.NODE_ENV !== "production") return;

    navigator.serviceWorker.register("/sw.js").catch(() => {
      // PWA stays usable as a regular site if registration fails.
    });
  }, []);

  return null;
}
