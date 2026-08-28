import Link from "next/link";
import { useRouter } from "next/router";
import { useCallback, useEffect, useRef, useState } from "react";

import {
  clearToken,
  ensureFreshAccessToken,
  getStoredToken,
  tryRefreshAccessToken,
} from "../lib/auth";
import {
  CHAT_ENTRY_COLLAPSED_SUB,
  CHAT_ENTRY_COLLAPSED_TITLE,
  CHAT_ENTRY_SUB_AUTH,
  CHAT_ENTRY_SUB_GUEST,
  CHAT_ENTRY_SUGGESTIONS,
  CHAT_ENTRY_TITLE_GUEST,
  CHAT_ENTRY_WELCOME_AUTH,
  CHAT_ENTRY_WELCOME_GUEST,
  chatEntryPathHidden,
  chatEntryRoleHidden,
} from "../lib/chatEntryWidget";
import { getGuestChatToken, guestNeedsAiReply, setGuestChatToken } from "../lib/guestChat";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";
const MOBILE_MQ = "(max-width: 768px)";

function ConsultantAvatar({ small = false }) {
  return (
    <span
      className={`chat-entry__avatar${small ? " chat-entry__avatar--sm" : ""}`}
      aria-hidden
    >
      AV
      <span className="chat-entry__avatar-online" />
    </span>
  );
}

function ExpandChatButton() {
  return (
    <span className="chat-entry__expand-btn" aria-hidden>
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
        <path
          d="M8 4l8 8-8 8"
          stroke="currentColor"
          strokeWidth="2.4"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </span>
  );
}

function formatMsgTime(iso) {
  if (!iso) return "";
  try {
    const d = new Date(iso);
    const now = new Date();
    const sameDay =
      d.getDate() === now.getDate() &&
      d.getMonth() === now.getMonth() &&
      d.getFullYear() === now.getFullYear();
    if (sameDay) {
      return d.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" });
    }
    return d.toLocaleString("ru-RU", {
      day: "numeric",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

export default function ChatEntryWidget() {
  const router = useRouter();
  const [isMobile, setIsMobile] = useState(false);
  const [phase, setPhase] = useState("collapsed");
  const [token, setToken] = useState("");
  const [me, setMe] = useState(null);
  const [platformChatId, setPlatformChatId] = useState(null);
  const [guestToken, setGuestTokenState] = useState("");
  const [messages, setMessages] = useState([]);
  const [draft, setDraft] = useState("");
  const [sendErr, setSendErr] = useState("");
  const [loadingThread, setLoadingThread] = useState(false);
  const [guestAwaitingAi, setGuestAwaitingAi] = useState(false);
  const [sending, setSending] = useState(false);
  const threadEndRef = useRef(null);

  const isGuest = !token;
  const hiddenByPath = chatEntryPathHidden(router.pathname);
  const hiddenByRole = chatEntryRoleHidden(me?.role);
  const hidden = hiddenByPath || hiddenByRole;
  const onCarDetail = router.pathname.startsWith("/cars/");
  const hasThread = messages.length > 0;

  const title = isGuest ? CHAT_ENTRY_TITLE_GUEST : "Чат с Avtovozom";
  const subtitle = isGuest ? CHAT_ENTRY_SUB_GUEST : CHAT_ENTRY_SUB_AUTH;
  const welcome = isGuest ? CHAT_ENTRY_WELCOME_GUEST : CHAT_ENTRY_WELCOME_AUTH;

  const scrollThreadToEnd = useCallback(() => {
    requestAnimationFrame(() => {
      const end = threadEndRef.current;
      const wrap = end?.closest?.(".chat-entry__messages");
      if (wrap) wrap.scrollTop = wrap.scrollHeight;
    });
  }, []);

  const persistGuestToken = useCallback((value) => {
    setGuestChatToken(value);
    setGuestTokenState(value || "");
  }, []);

  const loadGuestMessages = useCallback(
    async (gt, opts = {}) => {
      const quiet = Boolean(opts.quiet);
      const trimmed = (gt || "").trim();
      if (!trimmed) {
        setMessages([]);
        return;
      }
      if (!quiet) setLoadingThread(true);
      try {
        const res = await fetch(
          `${API_URL}/public/guest-chats/${encodeURIComponent(trimmed)}/messages?limit=80&offset=0`
        );
        if (res.status === 404) {
          persistGuestToken("");
          setMessages([]);
          return;
        }
        if (res.ok) {
          const list = (await res.json()) || [];
          setMessages(list);
          setGuestAwaitingAi(guestNeedsAiReply(list));
          if (!quiet) scrollThreadToEnd();
        }
      } finally {
        if (!quiet) setLoadingThread(false);
      }
    },
    [persistGuestToken, scrollThreadToEnd]
  );

  const loadAuthMessages = useCallback(
    async (chatId, tok, opts = {}) => {
      const quiet = Boolean(opts.quiet);
      const access = tok || token;
      if (!access || !chatId) return;
      if (!quiet) setLoadingThread(true);
      try {
        const res = await fetch(`${API_URL}/chats/${chatId}/messages?limit=80&offset=0`, {
          headers: { Authorization: `Bearer ${access}` },
        });
        if (res.ok) {
          setMessages((await res.json()) || []);
          if (!quiet) scrollThreadToEnd();
        }
      } finally {
        if (!quiet) setLoadingThread(false);
      }
    },
    [token, scrollThreadToEnd]
  );

  const resolvePlatformChat = useCallback(async (access) => {
    const res = await fetch(`${API_URL}/chats/my`, {
      headers: { Authorization: `Bearer ${access}` },
    });
    if (!res.ok) return null;
    const chats = (await res.json()) || [];
    const platform = chats.find((c) => c.chat_type === "platform") || chats[0];
    return platform?.id ?? null;
  }, []);

  const bootstrapAuth = useCallback(async () => {
    await ensureFreshAccessToken().catch(() => null);
    let access = getStoredToken() || "";
    if (!access) {
      setToken("");
      setMe(null);
      setPlatformChatId(null);
      return;
    }
    let res = await fetch(`${API_URL}/auth/me`, { headers: { Authorization: `Bearer ${access}` } });
    if (res.status === 401) {
      if (await tryRefreshAccessToken()) {
        access = getStoredToken();
        res = await fetch(`${API_URL}/auth/me`, { headers: { Authorization: `Bearer ${access}` } });
      }
    }
    if (!res.ok) {
      clearToken({ logout: false });
      setToken("");
      setMe(null);
      setPlatformChatId(null);
      return;
    }
    const user = await res.json();
    setToken(access);
    setMe(user);
    const chatId = await resolvePlatformChat(access);
    setPlatformChatId(chatId);
  }, [resolvePlatformChat]);

  const reloadThread = useCallback(
    async (opts = {}) => {
      if (isGuest) {
        await loadGuestMessages(guestToken || getGuestChatToken(), opts);
        return;
      }
      const chatId = platformChatId || (token ? await resolvePlatformChat(token) : null);
      if (chatId) {
        if (chatId !== platformChatId) setPlatformChatId(chatId);
        await loadAuthMessages(chatId, token, opts);
      }
    },
    [isGuest, guestToken, platformChatId, token, loadGuestMessages, loadAuthMessages, resolvePlatformChat]
  );

  useEffect(() => {
    const mq = typeof window !== "undefined" ? window.matchMedia(MOBILE_MQ) : null;
    if (!mq) return undefined;
    const sync = () => setIsMobile(mq.matches);
    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, []);

  useEffect(() => {
    if (hidden) return undefined;
    const onTok = () => bootstrapAuth();
    window.addEventListener("avt-token-changed", onTok);
    (async () => {
      const access = getStoredToken();
      if (access) {
        await bootstrapAuth();
      } else {
        setToken("");
        setMe(null);
        setPlatformChatId(null);
        persistGuestToken(getGuestChatToken());
      }
    })();
    return () => window.removeEventListener("avt-token-changed", onTok);
  }, [hidden, bootstrapAuth, persistGuestToken]);

  useEffect(() => {
    if (hidden || phase !== "open" || isMobile) return undefined;
    reloadThread();
    const ms = isGuest && guestAwaitingAi ? 2500 : 26000;
    const id = setInterval(() => reloadThread({ quiet: true }), ms);
    return () => clearInterval(id);
  }, [hidden, phase, isMobile, isGuest, guestAwaitingAi, reloadThread]);

  useEffect(() => {
    if (phase === "open") scrollThreadToEnd();
  }, [messages, phase, scrollThreadToEnd]);

  useEffect(() => {
    if (typeof document === "undefined" || hidden) return undefined;
    document.body.classList.toggle("chat-entry-open", phase !== "collapsed");
    document.body.classList.toggle("chat-entry-expanded", phase === "open");
    return () => {
      document.body.classList.remove("chat-entry-open", "chat-entry-expanded");
    };
  }, [phase, hidden]);

  /**
   * Mobile: при фокусе в поле чата тапбар остаётся под клавиатурой (как у поиска
   * в каталоге) — не поднимаем dock и убираем зазор под tabbar у виджета.
   */
  useEffect(() => {
    if (typeof window === "undefined" || hidden || !isMobile) return undefined;
    let focusTimer = 0;

    const inputFocused = () => {
      const ae = document.activeElement;
      return Boolean(ae?.classList?.contains("chat-entry__input"));
    };

    const sync = () => {
      document.body.classList.toggle("chat-entry-kb-open", inputFocused());
    };

    const scheduleSync = (...delays) => {
      window.clearTimeout(focusTimer);
      const run = (i) => {
        if (i >= delays.length) return;
        focusTimer = window.setTimeout(() => {
          sync();
          run(i + 1);
        }, delays[i]);
      };
      run(0);
    };

    const onFocusIn = (e) => {
      if (!(e.target instanceof HTMLElement)) return;
      if (!e.target.classList.contains("chat-entry__input")) return;
      sync();
      scheduleSync(50, 150, 320);
    };

    const onFocusOut = () => scheduleSync(180);

    sync();
    window.visualViewport?.addEventListener("resize", sync);
    document.addEventListener("focusin", onFocusIn);
    document.addEventListener("focusout", onFocusOut);

    return () => {
      window.clearTimeout(focusTimer);
      window.visualViewport?.removeEventListener("resize", sync);
      document.removeEventListener("focusin", onFocusIn);
      document.removeEventListener("focusout", onFocusOut);
      document.body.classList.remove("chat-entry-kb-open");
    };
  }, [hidden, isMobile]);

  const openPanel = async () => {
    setPhase("open");
    setSendErr("");
    if (!isMobile) {
      await reloadThread();
    }
  };

  const closeWidget = () => setPhase("collapsed");

  const navigateToMessages = useCallback(
    (query = {}) => {
      setPhase("collapsed");
      router.push({ pathname: "/messages", query });
    },
    [router]
  );

  const sendGuestText = async (text) => {
    const res = await fetch(`${API_URL}/public/guest-chats/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ guest_token: guestToken || getGuestChatToken() || null, text }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(typeof body.detail === "string" ? body.detail : "Не удалось отправить");
    }
    persistGuestToken(body.guest_token);
    setGuestAwaitingAi(true);
    return body;
  };

  const sendAuthText = async (text) => {
    let chatId = platformChatId;
    const access = token || getStoredToken();
    if (!chatId) {
      chatId = await resolvePlatformChat(access);
      setPlatformChatId(chatId);
    }
    if (!chatId || !access) {
      throw new Error("Не удалось открыть чат");
    }
    const fd = new FormData();
    fd.append("text", text);
    const res = await fetch(`${API_URL}/chats/${chatId}/messages`, {
      method: "POST",
      headers: { Authorization: `Bearer ${access}` },
      body: fd,
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(typeof body.detail === "string" ? body.detail : "Не удалось отправить");
    }
    return { chat_id: chatId };
  };

  const handleSend = async (rawText) => {
    const text = String(rawText || draft || "").trim();
    if (!text || sending) return;
    setSending(true);
    setSendErr("");
    try {
      if (isMobile) {
        if (isGuest) {
          await sendGuestText(text);
          navigateToMessages({});
        } else {
          await sendAuthText(text);
          const chatId = platformChatId || (await resolvePlatformChat(token));
          navigateToMessages(chatId ? { chat: String(chatId) } : {});
        }
        setDraft("");
        return;
      }

      if (isGuest) {
        await sendGuestText(text);
      } else {
        await sendAuthText(text);
      }
      setDraft("");
      await reloadThread();
    } catch (err) {
      setSendErr(err?.message || "Не удалось отправить");
    } finally {
      setSending(false);
    }
  };

  if (hidden) return null;

  const showPanel = phase === "open";
  const showInviteBody = !hasThread && !loadingThread;
  const messagesHref =
    !isGuest && platformChatId ? `/messages?chat=${encodeURIComponent(String(platformChatId))}` : "/messages";

  return (
    <div
      className={`chat-entry${isMobile ? " chat-entry--mobile" : " chat-entry--desktop"}${onCarDetail ? " chat-entry--car-detail" : ""} chat-entry--${phase}`}
      aria-live="polite"
    >
      {phase === "collapsed" ? (
        <button type="button" className="chat-entry__collapsed" onClick={openPanel}>
          <ConsultantAvatar small />
          <span className="chat-entry__collapsed-main">
            <span className="chat-entry__collapsed-title">{CHAT_ENTRY_COLLAPSED_TITLE}</span>
            <span className="chat-entry__collapsed-sub">{CHAT_ENTRY_COLLAPSED_SUB}</span>
          </span>
          <ExpandChatButton />
        </button>
      ) : null}

      {showPanel ? (
        <section
          className={`chat-entry__panel${!isMobile ? " chat-entry__panel--chat" : ""}`}
          aria-label={hasThread ? "Чат" : "Приглашение в чат"}
        >
          <header className="chat-entry__head">
            <Link
              href={messagesHref}
              className="chat-entry__head-main chat-entry__head-link"
              onClick={closeWidget}
            >
              <ConsultantAvatar />
              <div>
                <h2 className="chat-entry__title">
                  {hasThread || !isGuest ? title : CHAT_ENTRY_COLLAPSED_TITLE}
                </h2>
                <p className="chat-entry__sub">
                  {hasThread || !isGuest ? subtitle : CHAT_ENTRY_COLLAPSED_SUB}
                </p>
              </div>
            </Link>
            <button type="button" className="chat-entry__close" onClick={closeWidget} aria-label="Свернуть">
              ✕
            </button>
          </header>

          <div className="chat-entry__messages" role="log">
            {loadingThread && !hasThread ? <p className="muted">Загрузка…</p> : null}

            {showInviteBody ? (
              <>
                <div className="chat-entry__welcome">
                  <div className="chat-entry__bubble chat-entry__bubble--peer">
                    <p>{welcome}</p>
                  </div>
                </div>
                <div className="chat-entry__suggestions">
                  {CHAT_ENTRY_SUGGESTIONS.map((item) => (
                    <button
                      key={item}
                      type="button"
                      className="chat-entry__suggestion"
                      disabled={sending}
                      onClick={() => handleSend(item)}
                    >
                      {item}
                    </button>
                  ))}
                </div>
              </>
            ) : null}

            {messages.map((m) => {
              if (m.message_type === "system") {
                return (
                  <div key={m.id} className="chat-entry__system">
                    <p>{m.text}</p>
                    <time dateTime={m.created_at}>{formatMsgTime(m.created_at)}</time>
                  </div>
                );
              }
              const mine = isGuest
                ? m.sender_user_id == null && m.message_type !== "assistant"
                : Boolean(me && m.sender_user_id === me.id);
              return (
                <div
                  key={m.id}
                  className={`chat-entry__bubble-row${mine ? " chat-entry__bubble-row--mine" : ""}`}
                >
                  <div className={`chat-entry__bubble${mine ? " chat-entry__bubble--mine" : ""}`}>
                    {m.text ? <p>{m.text}</p> : null}
                    <time dateTime={m.created_at}>{formatMsgTime(m.created_at)}</time>
                  </div>
                </div>
              );
            })}
            <div ref={threadEndRef} />
          </div>

          <form
            className="chat-entry__composer"
            onSubmit={(e) => {
              e.preventDefault();
              handleSend();
            }}
          >
            {sendErr ? <p className="chat-entry__err">{sendErr}</p> : null}
            {isGuest && guestAwaitingAi && hasThread ? (
              <p className="chat-entry__hint muted" aria-live="polite">
                Консультант печатает…
              </p>
            ) : null}
            <label className="chat-entry__composer-row">
              <span className="visually-hidden">{hasThread ? "Сообщение" : "Свой вопрос"}</span>
              <input
                className="chat-entry__input"
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                placeholder={hasThread ? "Сообщение…" : "Свой вопрос…"}
                disabled={sending}
              />
              <button type="submit" className="chat-entry__send" disabled={sending || !draft.trim()}>
                {sending ? "…" : "→"}
              </button>
            </label>
            {!hasThread ? (
              <p className="chat-entry__hint muted">
                {isGuest ? "Без регистрации · ответ за минуту" : "Диалог с Avtovozom по вашей сделке"}
              </p>
            ) : null}
          </form>
        </section>
      ) : null}
    </div>
  );
}
