import { useRouter } from "next/router";
import { useEffect, useMemo, useState } from "react";

import {
  APP_LOCK_TIMEOUT_MS,
  canUseWebAuthn,
  clearToken,
  hasPinLock,
  hasValidAccessToken,
  isAppUnlocked,
  loginWithPasskey,
  lockApp,
  markAppHidden,
  markAppUnlocked,
  rotatePinnedSession,
  shouldLockAfterHidden,
} from "../lib/auth";
import PinPad from "./PinPad";

/** Пути, где без разблокировки по ПИН нельзя продолжить. */
function isPinGatePath(pathname) {
  const path = pathname || "";
  return (
    path === "/auth" ||
    /^(?:\/profile|\/messages|\/favorites)(?:\/|$)/.test(path) ||
    path.startsWith("/staff/")
  );
}

export default function AppLockGate({ children }) {
  const router = useRouter();
  const gatePath = useMemo(() => isPinGatePath(router.pathname), [router.pathname]);
  const [ready, setReady] = useState(false);
  const [locked, setLocked] = useState(false);
  const [pin, setPin] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const hasLock = await hasPinLock().catch(() => false);
      if (cancelled) return;
      const needsTimeoutLock = shouldLockAfterHidden();
      const sessionOk = hasValidAccessToken();
      const unlocked = isAppUnlocked();

      // Валидный access + нет таймаута скрытия → считаем разблокированным
      // (даже если sessionStorage-маркер пропал при восстановлении вкладки).
      if (hasLock && sessionOk && !needsTimeoutLock && !unlocked) {
        markAppUnlocked();
      }

      // Истёкший/отсутствующий access при наличии ПИН → блокировка.
      // Раньше смотрели только на наличие строки JWT, и протухший токен
      // «разблокировал» приложение без ПИН.
      if (hasLock && (needsTimeoutLock || !sessionOk)) {
        lockApp();
      }

      const nowUnlocked = isAppUnlocked();
      setLocked(Boolean(gatePath && hasLock && !nowUnlocked && !hasValidAccessToken()));
      setReady(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [gatePath, router.asPath]);

  useEffect(() => {
    if (typeof window === "undefined") return undefined;
    let hiddenAt = 0;
    const onVisibility = () => {
      if (document.visibilityState === "hidden") {
        hiddenAt = Date.now();
        markAppHidden();
        return;
      }
      if ((hiddenAt && Date.now() - hiddenAt > APP_LOCK_TIMEOUT_MS) || shouldLockAfterHidden()) {
        lockApp();
        if (gatePath) setLocked(true);
      }
    };
    const onLock = () => {
      if (gatePath) setLocked(true);
    };
    const onToken = () => {
      if (hasValidAccessToken() && isAppUnlocked()) setLocked(false);
    };
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("avt-app-lock-changed", onLock);
    window.addEventListener("avt-token-changed", onToken);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("avt-app-lock-changed", onLock);
      window.removeEventListener("avt-token-changed", onToken);
    };
  }, [gatePath]);

  if (!ready || !locked) return children;

  async function unlockWithPinSubmit(e) {
    e?.preventDefault?.();
    setBusy(true);
    setError("");
    try {
      await rotatePinnedSession(pin);
      markAppUnlocked();
      setLocked(false);
      setPin("");
      if (router.pathname === "/auth") {
        const next = typeof router.query.next === "string" ? router.query.next : "/";
        router.replace(next);
      }
    } catch {
      setError("ПИН-код не подошел или серверная сессия истекла. Войдите по паролю заново.");
    } finally {
      setBusy(false);
    }
  }

  async function unlockWithBio() {
    setBusy(true);
    setError("");
    try {
      await loginWithPasskey();
      markAppUnlocked();
      setLocked(false);
      setPin("");
      if (router.pathname === "/auth") {
        const next = typeof router.query.next === "string" ? router.query.next : "/";
        router.replace(next);
      }
    } catch (err) {
      setError(err?.message || "Биометрический вход не сработал");
    } finally {
      setBusy(false);
    }
  }

  function passwordLogin() {
    // Явный отказ от ПИН на этом устройстве
    clearToken({ logout: true });
    setLocked(false);
    if (router.pathname !== "/auth") {
      router.replace(`/auth?next=${encodeURIComponent(router.asPath || "/")}`);
    }
  }

  return (
    <div className="app-lock">
      <div className="app-lock__card">
        <div className="pin-panel__hero">
          <div className="pin-panel__app-icon">A</div>
          <h1>Введите ПИН-код</h1>
          <p>Разблокируйте avtovozom на этом устройстве.</p>
        </div>
        {error ? <div className="alert alert--danger">{error}</div> : null}
        <form className="app-lock__desktop-form" onSubmit={unlockWithPinSubmit}>
          <input
            className="input"
            inputMode="numeric"
            autoComplete="current-password"
            autoFocus
            type="password"
            maxLength={6}
            placeholder="ПИН-код"
            value={pin}
            onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))}
          />
          <button type="submit" className="btn btn-primary" disabled={busy || pin.length < 4}>
            {busy ? "Проверяем..." : "Войти"}
          </button>
        </form>
        <PinPad
          className="app-lock__mobile-pad"
          value={pin}
          onChange={setPin}
          onSubmit={unlockWithPinSubmit}
          submitLabel={busy ? "Проверяем..." : "Войти"}
          disabled={busy}
        />
        {canUseWebAuthn() ? (
          <button type="button" className="btn btn-secondary" onClick={unlockWithBio} disabled={busy}>
            Войти по биометрии
          </button>
        ) : null}
        <button type="button" className="btn btn-ghost" onClick={passwordLogin}>
          Войти по паролю
        </button>
      </div>
    </div>
  );
}
