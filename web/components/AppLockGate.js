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
import { humanizeWebAuthnError } from "../lib/webauthnErrors";
import PinPad from "./PinPad";

/** Пути, где без разблокировки по ПИН нельзя продолжить. */
function isPinGatePath(pathname) {
  const path = pathname || "";
  return (
    path === "/auth" ||
    /^(?:\/profile|\/favorites)(?:\/|$)/.test(path) ||
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

  async function unlockWithPinSubmit(arg) {
    // PinPad auto-submit passes the completed code as a string; the desktop
    // form passes a submit event and relies on React state.
    if (arg && typeof arg === "object" && typeof arg.preventDefault === "function") {
      arg.preventDefault();
    }
    const code = typeof arg === "string" ? arg : pin;
    if (busy || !/^\d{4}$/.test(code)) return;
    setBusy(true);
    setError("");
    setPin(code);
    try {
      await rotatePinnedSession(code);
      markAppUnlocked();
      setLocked(false);
      setPin("");
      if (router.pathname === "/auth") {
        const next = typeof router.query.next === "string" ? router.query.next : "/";
        router.replace(next);
      }
    } catch (err) {
      const msg = String(err?.message || "");
      if (msg.includes("Сессия устарела")) {
        setError("Серверная сессия истекла. Войдите по паролю заново.");
      } else {
        setError("ПИН-код не подошел или серверная сессия истекла. Войдите по паролю заново.");
      }
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
      setError(humanizeWebAuthnError(err, "Биометрический вход не сработал"));
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
        <div className="app-lock__brand" aria-hidden>
          <img src="/logo-avtovozom-white.png" alt="" className="app-lock__brand-mark" width={22} height={26} />
          <span className="app-lock__brand-text">avtovozom</span>
        </div>
        <div className="pin-panel__hero">
          <div className="pin-panel__app-icon" aria-hidden>
            A
          </div>
          <h1>Здравствуйте</h1>
          <p>Введите PIN-код</p>
        </div>
        {error ? <div className="alert alert--danger">{error}</div> : null}
        <form className="app-lock__desktop-form" onSubmit={unlockWithPinSubmit}>
          <input
            className="input"
            inputMode="numeric"
            autoComplete="current-password"
            autoFocus
            type="password"
            maxLength={4}
            placeholder="PIN-код"
            value={pin}
            onChange={(e) => setPin(e.target.value.replace(/\D/g, "").slice(0, 4))}
          />
          <button type="submit" className="btn btn-primary" disabled={busy || pin.length !== 4}>
            {busy ? "Проверяем..." : "Войти"}
          </button>
        </form>
        <PinPad
          className="app-lock__mobile-pad"
          value={pin}
          onChange={setPin}
          onSubmit={unlockWithPinSubmit}
          showSubmit={false}
          minLength={4}
          maxLength={4}
          disabled={busy}
          bottomLeft={
            canUseWebAuthn() ? (
              <button
                type="button"
                className="pin-keypad__key pin-keypad__key--bio"
                onClick={unlockWithBio}
                disabled={busy}
                aria-label="Войти по биометрии"
              >
                ⌽
              </button>
            ) : (
              <span aria-hidden />
            )
          }
        />
        {canUseWebAuthn() ? (
          <button type="button" className="btn btn-secondary app-lock__bio-desktop" onClick={unlockWithBio} disabled={busy}>
            Войти по биометрии
          </button>
        ) : null}
        <button type="button" className="app-lock__password" onClick={passwordLogin}>
          Войти по паролю
        </button>
      </div>
    </div>
  );
}
