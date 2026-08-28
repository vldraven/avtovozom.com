import Link from "next/link";
import { useRouter } from "next/router";
import { useCallback, useEffect, useRef, useState } from "react";

import HeaderProfileLink from "../components/HeaderProfileLink";
import {
  clearToken,
  ensureFreshAccessToken,
  getStoredToken,
  resolveAuthSessionFailure,
  tryRefreshAccessToken,
} from "../lib/auth";
import { getGuestChatToken, GUEST_QUICK_PROMPTS, setGuestChatToken } from "../lib/guestChat";
import { mediaSrc } from "../lib/media";
import { isStaffRole } from "../lib/roles";
import SiteHeader from "../components/SiteHeader";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";
const GUEST_CHAT_PLACEHOLDER_ID = "guest";
const GUEST_CHAT_TITLE = "Консультант Avtovozom";
const GUEST_CHAT_SUB = "Отвечает сразу · ИИ-помощник";

function GuestConsultantIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden>
      <rect x="4" y="7" width="16" height="12" rx="3" stroke="#38bdf8" strokeWidth="1.7" />
      <path d="M12 4v3" stroke="#38bdf8" strokeWidth="1.7" strokeLinecap="round" />
      <path d="M9 12h.01M15 12h.01" stroke="#38bdf8" strokeWidth="2.2" strokeLinecap="round" />
      <path d="M9.5 15.5h5" stroke="#38bdf8" strokeWidth="1.7" strokeLinecap="round" />
    </svg>
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

function attachmentIsImage(name) {
  return /\.(jpe?g|png|webp|gif|heic)$/i.test(name || "");
}

const MESSAGE_URL_RE = /(https?:\/\/[^\s<]+)/g;

function splitTrailingUrlPunctuation(url) {
  let core = url;
  let trailing = "";
  while (core && /[.,;:!?)\]]$/.test(core)) {
    trailing = core.slice(-1) + trailing;
    core = core.slice(0, -1);
  }
  return { core, trailing };
}

function renderMessageText(text) {
  if (!text) return null;
  const nodes = [];
  let lastIndex = 0;
  let match;
  const re = new RegExp(MESSAGE_URL_RE.source, "g");
  while ((match = re.exec(text)) !== null) {
    if (match.index > lastIndex) {
      nodes.push(text.slice(lastIndex, match.index));
    }
    const { core, trailing } = splitTrailingUrlPunctuation(match[1]);
    if (core) {
      nodes.push(
        <a
          key={`u-${match.index}`}
          href={core}
          target="_blank"
          rel="noopener noreferrer"
          className="messenger__bubble-link"
        >
          {core}
        </a>
      );
    }
    if (trailing) nodes.push(trailing);
    lastIndex = match.index + match[0].length;
  }
  if (lastIndex < text.length) nodes.push(text.slice(lastIndex));
  return nodes.length ? nodes : text;
}

function formatListTime(iso) {
  if (!iso) return "";
  try {
    const d = new Date(iso);
    const now = new Date();
    const diff = now - d;
    if (diff < 86400000 && d.getDate() === now.getDate()) {
      return d.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" });
    }
    if (diff < 604800000) {
      return d.toLocaleDateString("ru-RU", { weekday: "short" });
    }
    return d.toLocaleDateString("ru-RU", { day: "numeric", month: "short" });
  } catch {
    return "";
  }
}

export default function MessagesPage() {
  const router = useRouter();
  const [token, setToken] = useState("");
  const [guestMode, setGuestMode] = useState(false);
  const [guestToken, setGuestTokenState] = useState("");
  const [me, setMe] = useState(null);
  const [chats, setChats] = useState([]);
  const [activeId, setActiveId] = useState(null);
  const [messages, setMessages] = useState([]);
  const [draft, setDraft] = useState("");
  const [attachFile, setAttachFile] = useState(null);
  const [sendErr, setSendErr] = useState("");
  const [loadingList, setLoadingList] = useState(true);
  const [loadingThread, setLoadingThread] = useState(false);
  const [narrow, setNarrow] = useState(false);
  const [listVisible, setListVisible] = useState(true);
  const [chatQuery, setChatQuery] = useState("");
  const [deletingChatId, setDeletingChatId] = useState(null);
  const [guestAwaitingAi, setGuestAwaitingAi] = useState(false);
  const guestAwaitTimerRef = useRef(null);
  const threadEndRef = useRef(null);
  const draftFromQueryAppliedRef = useRef(false);
  const composerInputRef = useRef(null);
  const skipAutoOpenChatRef = useRef(false);
  const landedWithChatQueryRef = useRef(null);

  const scrollThreadToEnd = () => {
    requestAnimationFrame(() => {
      // Never use scrollIntoView — on iOS Chrome it pans the visual viewport and
      // the composer jumps out of sight when the keyboard is open.
      const end = threadEndRef.current;
      const wrap =
        end?.closest?.(".messenger__bubble-wrap") ||
        document.querySelector(".messenger__bubble-wrap");
      if (wrap) {
        wrap.scrollTop = wrap.scrollHeight;
      }
    });
  };

  const persistGuestToken = useCallback((value) => {
    setGuestChatToken(value);
    setGuestTokenState(value || "");
  }, []);

  const loadGuestThread = useCallback(async (gToken, opts = {}) => {
    const quiet = Boolean(opts.quiet);
    const gt = (gToken || "").trim();
    if (!gt) {
      setChats([
        {
          id: GUEST_CHAT_PLACEHOLDER_ID,
          chat_type: "guest",
          title: GUEST_CHAT_TITLE,
          peer_display: "Avtovozom",
          peer_role: "platform",
          last_message_text: null,
          last_message_at: null,
          unread_count: 0,
          status: "open",
          created_at: new Date().toISOString(),
        },
      ]);
      setActiveId(GUEST_CHAT_PLACEHOLDER_ID);
      setMessages([]);
      setLoadingList(false);
      setListVisible(false);
      return;
    }
    if (!quiet) setLoadingThread(true);
    setSendErr("");
    try {
      const [metaRes, msgRes] = await Promise.all([
        fetch(`${API_URL}/public/guest-chats/${encodeURIComponent(gt)}`),
        fetch(`${API_URL}/public/guest-chats/${encodeURIComponent(gt)}/messages?limit=80&offset=0`),
      ]);
      if (metaRes.status === 404) {
        persistGuestToken("");
        setChats([
          {
            id: GUEST_CHAT_PLACEHOLDER_ID,
            chat_type: "guest",
            title: GUEST_CHAT_TITLE,
            peer_display: "Avtovozom",
            peer_role: "platform",
            last_message_text: null,
            last_message_at: null,
            unread_count: 0,
            status: "open",
            created_at: new Date().toISOString(),
          },
        ]);
        setActiveId(GUEST_CHAT_PLACEHOLDER_ID);
        setMessages([]);
        setListVisible(false);
        setGuestAwaitingAi(false);
        return;
      }
      if (metaRes.ok) {
        const meta = await metaRes.json();
        setChats([meta]);
        setActiveId(meta.id);
      }
      if (msgRes.ok) {
        const list = (await msgRes.json()) || [];
        setMessages((prev) => {
          const prevLen = prev?.length || 0;
          if (quiet && list.length > prevLen) {
            requestAnimationFrame(() => {
              scrollThreadToEnd();
            });
          }
          return list;
        });
        setGuestAwaitingAi((waiting) => {
          if (!waiting) return false;
          for (let i = list.length - 1; i >= 0; i -= 1) {
            const m = list[i];
            if (m.message_type === "system") continue;
            // Peer reply arrived (AI or staff)
            return !(m.message_type === "assistant" || m.sender_user_id != null);
          }
          return true;
        });
        if (!quiet) scrollThreadToEnd();
      }
      setListVisible(false);
    } finally {
      if (!quiet) setLoadingThread(false);
      setLoadingList(false);
    }
  }, [persistGuestToken]);

  const loadChats = useCallback(async (t) => {
    const tok = t || token;
    if (!tok) return;
    const res = await fetch(`${API_URL}/chats/my`, { headers: { Authorization: `Bearer ${tok}` } });
    if (!res.ok) return;
    setChats(await res.json());
  }, [token]);

  const loadThread = useCallback(
    async (chatId, t) => {
      const tok = t || token;
      if (!tok || !chatId) return;
      setLoadingThread(true);
      setSendErr("");
      try {
        const res = await fetch(`${API_URL}/chats/${chatId}/messages?limit=80&offset=0`, {
          headers: { Authorization: `Bearer ${tok}` },
        });
        if (!res.ok) return;
        const data = await res.json();
        setMessages(data || []);
        scrollThreadToEnd();
        await loadChats(tok);
      } finally {
        setLoadingThread(false);
      }
    },
    [token, loadChats]
  );

  useEffect(() => {
    const mq = typeof window !== "undefined" ? window.matchMedia("(max-width: 768px)") : null;
    if (!mq) return undefined;
    const fn = () => setNarrow(mq.matches);
    fn();
    mq.addEventListener("change", fn);
    return () => mq.removeEventListener("change", fn);
  }, []);

  const bootstrapMessagesRef = useRef(null);

  async function bootstrapMessages(tok) {
    await ensureFreshAccessToken().catch(() => null);
    let access = getStoredToken() || tok || "";
    if (!access) return;
    let res = await fetch(`${API_URL}/auth/me`, { headers: { Authorization: `Bearer ${access}` } });
    if (res.status === 401) {
      if (await tryRefreshAccessToken()) {
        access = getStoredToken();
        res = await fetch(`${API_URL}/auth/me`, { headers: { Authorization: `Bearer ${access}` } });
      }
    }
    if (!res.ok) {
      const kind = await resolveAuthSessionFailure();
      if (kind === "pin-lock") {
        setToken(getStoredToken());
        return;
      }
      router.replace("/auth?next=/messages");
      return;
    }
    const u = await res.json();
    setMe(u);
    setLoadingList(true);
    const cr = await fetch(`${API_URL}/chats/my`, { headers: { Authorization: `Bearer ${access}` } });
    if (cr.ok) setChats(await cr.json());
    setLoadingList(false);
  }

  bootstrapMessagesRef.current = bootstrapMessages;

  useEffect(() => {
    let cancelled = false;
    const onTok = () => {
      const t2 = getStoredToken();
      setToken(t2 || "");
      if (t2) {
        setGuestMode(false);
        bootstrapMessagesRef.current(t2);
      }
    };
    window.addEventListener("avt-token-changed", onTok);

    (async () => {
      const t = getStoredToken();
      if (!t) {
        if (cancelled) return;
        setGuestMode(true);
        setToken("");
        setMe(null);
        const gt = getGuestChatToken();
        persistGuestToken(gt);
        await loadGuestThread(gt);
        return;
      }
      if (cancelled) return;
      setGuestMode(false);
      setToken(t);
      await bootstrapMessagesRef.current(t);
    })();

    return () => {
      cancelled = true;
      window.removeEventListener("avt-token-changed", onTok);
    };
  }, [router, loadGuestThread, persistGuestToken]);

  /** Подстановка черновика сообщения (напр. «Задать вопрос» с карточки авто в каталоге) — один раз. */
  useEffect(() => {
    if (!router.isReady || draftFromQueryAppliedRef.current) return;
    const raw = router.query.draft;
    const value = Array.isArray(raw) ? raw[0] : raw;
    if (value) {
      setDraft(String(value));
      draftFromQueryAppliedRef.current = true;
    }
  }, [router.isReady, router.query.draft]);



  useEffect(() => {
    if (!router.isReady || landedWithChatQueryRef.current != null) return;
    const raw = router.query.chat;
    landedWithChatQueryRef.current = raw != null && raw !== "";
  }, [router.isReady, router.query.chat]);

  useEffect(() => {
    if (!router.isReady || guestMode || !token) return;
    const raw = router.query.chat;
    if (raw == null || raw === "") return;
    const id = Number(Array.isArray(raw) ? raw[0] : raw);
    if (!Number.isFinite(id)) return;
    setActiveId(id);
    if (narrow) setListVisible(false);
    loadThread(id, token);
  }, [router.isReady, router.query.chat, token, narrow, loadThread, guestMode]);

  useEffect(() => {
    if (!router.isReady || guestMode || !token || loadingList || chats.length === 0) return;
    const raw = router.query.chat;
    if (raw != null && raw !== "") return;
    if (skipAutoOpenChatRef.current) return;
    if (chats.length === 1) {
      const only = chats[0];
      setActiveId(only.id);
      if (narrow) setListVisible(false);
      router.replace({ pathname: "/messages", query: { chat: only.id } }, undefined, { shallow: true });
      loadThread(only.id, token);
    }
  }, [router.isReady, router.query.chat, token, chats, loadingList, narrow, loadThread, guestMode, router]);

  useEffect(() => {
    if (guestMode) {
      if (!guestToken) return undefined;
      const ms = guestAwaitingAi ? 2500 : 26000;
      const id = setInterval(() => loadGuestThread(guestToken, { quiet: true }), ms);
      return () => clearInterval(id);
    }
    if (!token) return undefined;
    const id = setInterval(() => loadChats(token), 26000);
    return () => clearInterval(id);
  }, [token, loadChats, guestMode, guestToken, loadGuestThread, guestAwaitingAi]);

  useEffect(() => {
    if (!guestAwaitingAi) {
      if (guestAwaitTimerRef.current) {
        clearTimeout(guestAwaitTimerRef.current);
        guestAwaitTimerRef.current = null;
      }
      return undefined;
    }
    guestAwaitTimerRef.current = setTimeout(() => setGuestAwaitingAi(false), 90000);
    return () => {
      if (guestAwaitTimerRef.current) {
        clearTimeout(guestAwaitTimerRef.current);
        guestAwaitTimerRef.current = null;
      }
    };
  }, [guestAwaitingAi]);

  useEffect(() => {
    scrollThreadToEnd();
  }, [messages, activeId]);

  // Гость всегда в треде; авторизованный — только когда открыт конкретный чат (не список).
  const threadOpenOnMobile =
    narrow && (guestMode || (Boolean(activeId) && !listVisible));

  useEffect(() => {
    if (typeof document === "undefined") return undefined;
    document.documentElement.classList.add("page-messages");
    document.body.classList.toggle("messages-thread-open", threadOpenOnMobile);
    return () => {
      document.documentElement.classList.remove("page-messages");
      document.documentElement.classList.remove("messages-kb-open");
      document.body.classList.remove("messages-thread-open");
      document.documentElement.style.removeProperty("--msg-h");
      document.documentElement.style.removeProperty("--msg-y");
      document.documentElement.style.removeProperty("--msg-bottom-inset");
      document.documentElement.style.removeProperty("--msg-composer-pad");
    };
  }, [threadOpenOnMobile]);

  /**
   * Pin the chat shell to the *visual* viewport on iOS Chrome/Safari.
   * Using layout innerHeight + padding-bottom fails on Chrome iOS: keyboard
   * shrinks visualViewport only, so the composer (at the bottom of a tall
   * fixed shell) sits below the keyboard / pans out of view.
   *
   * Pattern (Chrome docs): top:0; height:vv.height; transform:translateY(vv.offsetTop).
   * Extra chrome pad only when the keyboard is closed. Never scrollIntoView the window.
   *
   * Список чатов (dock виден): в PWA берём innerHeight, иначе shell = vv.height
   * оставляет белую полосу под тапбаром (home indicator вне visualViewport).
   */
  useEffect(() => {
    if (typeof window === "undefined") return undefined;
    const root = document.documentElement;
    let focusTimer = 0;

    const isStandalone = () =>
      Boolean(
        window.matchMedia?.("(display-mode: standalone)")?.matches ||
          window.navigator.standalone
      );

    const composerFocused = () => {
      const ae = document.activeElement;
      return Boolean(ae && ae.classList?.contains("messenger__composer-input"));
    };

    const sync = () => {
      const vv = window.visualViewport;
      const listWithDock = !threadOpenOnMobile;
      const standalone = isStandalone();

      if (!vv) {
        root.style.setProperty("--msg-h", `${window.innerHeight}px`);
        root.style.setProperty("--msg-y", "0px");
        root.style.setProperty(
          "--msg-bottom-inset",
          standalone ? "0px" : "56px"
        );
        root.style.setProperty("--msg-composer-pad", "max(8px, env(safe-area-inset-bottom, 0px))");
        root.classList.remove("messages-kb-open");
        return;
      }

      // Список + PWA: полный экран, dock прибит к низу. Тред: visualViewport под клавиатуру.
      if (listWithDock && standalone) {
        root.style.setProperty("--msg-h", `${Math.round(window.innerHeight)}px`);
        root.style.setProperty("--msg-y", "0px");
        root.style.setProperty("--msg-bottom-inset", "0px");
        root.style.setProperty(
          "--msg-composer-pad",
          "max(8px, env(safe-area-inset-bottom, 0px))"
        );
        root.classList.remove("messages-kb-open");
        return;
      }

      const y = Math.max(0, Math.round(vv.offsetTop));
      const h = Math.max(0, Math.round(vv.height));
      root.style.setProperty("--msg-h", `${h}px`);
      root.style.setProperty("--msg-y", `${y}px`);

      const focused = composerFocused();
      if (focused) {
        root.classList.add("messages-kb-open");
        // Shell already matches the visible area above the keyboard.
        root.style.setProperty("--msg-bottom-inset", "0px");
        root.style.setProperty("--msg-composer-pad", "8px");
        return;
      }

      root.classList.remove("messages-kb-open");
      // Floating Safari/Chrome toolbars overlay the visual viewport.
      const chromePad = standalone ? 0 : 56;
      root.style.setProperty("--msg-bottom-inset", `${chromePad}px`);
      root.style.setProperty(
        "--msg-composer-pad",
        "max(8px, env(safe-area-inset-bottom, 0px))"
      );
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
      const t = e.target;
      if (!(t instanceof HTMLElement)) return;
      if (!t.classList?.contains("messenger__composer-input")) return;
      sync();
      scheduleSync(50, 150, 320);
    };

    const onFocusOut = () => {
      scheduleSync(180);
    };

    sync();
    window.visualViewport?.addEventListener("resize", sync);
    window.visualViewport?.addEventListener("scroll", sync);
    window.addEventListener("resize", sync);
    window.addEventListener("orientationchange", sync);
    document.addEventListener("focusin", onFocusIn);
    document.addEventListener("focusout", onFocusOut);
    return () => {
      window.clearTimeout(focusTimer);
      window.visualViewport?.removeEventListener("resize", sync);
      window.visualViewport?.removeEventListener("scroll", sync);
      window.removeEventListener("resize", sync);
      window.removeEventListener("orientationchange", sync);
      document.removeEventListener("focusin", onFocusIn);
      document.removeEventListener("focusout", onFocusOut);
      root.classList.remove("messages-kb-open");
      root.style.removeProperty("--msg-h");
      root.style.removeProperty("--msg-y");
      root.style.removeProperty("--msg-bottom-inset");
      root.style.removeProperty("--msg-composer-pad");
    };
  }, [threadOpenOnMobile]);

  useEffect(() => {
    const el = composerInputRef.current;
    if (!el) return;
    el.style.height = "auto";
    const styles = window.getComputedStyle(el);
    const lineHeight = Number.parseFloat(styles.lineHeight) || 22;
    const padY =
      (Number.parseFloat(styles.paddingTop) || 0) + (Number.parseFloat(styles.paddingBottom) || 0);
    const maxHeight = Math.ceil(lineHeight * 10 + padY);
    const next = Math.min(el.scrollHeight, maxHeight);
    el.style.height = `${next}px`;
    el.style.overflowY = el.scrollHeight > maxHeight + 1 ? "auto" : "hidden";
  }, [draft]);

  function logout() {
    clearToken({ logout: true });
    setToken("");
    setMe(null);
    router.push("/");
  }

  function pickChat(c) {
    skipAutoOpenChatRef.current = false;
    setActiveId(c.id);
    setSendErr("");
    if (narrow) setListVisible(false);
    if (!guestMode) {
      router.replace({ pathname: "/messages", query: { chat: c.id } }, undefined, { shallow: true });
      loadThread(c.id);
    }
  }

  function backToList() {
    skipAutoOpenChatRef.current = true;
    if (
      landedWithChatQueryRef.current &&
      typeof window !== "undefined" &&
      window.history.length > 1
    ) {
      router.back();
      return;
    }
    setListVisible(true);
    if (!guestMode) {
      router.replace("/messages", undefined, { shallow: true });
    }
  }

  function backFromGuestChat() {
    if (typeof window !== "undefined" && window.history.length > 1) {
      router.back();
      return;
    }
    router.push("/catalog");
  }

  async function applyGuestQuickPrompt(text) {
    setDraft(text);
    setSendErr("");
    if (!text.trim()) return;
    const res = await fetch(`${API_URL}/public/guest-chats/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ guest_token: guestToken || null, text: text.trim() }),
    });
    const errBody = await res.json().catch(() => ({}));
    if (!res.ok) {
      setSendErr(typeof errBody.detail === "string" ? errBody.detail : "Не удалось отправить");
      return;
    }
    persistGuestToken(errBody.guest_token);
    setDraft("");
    setAttachFile(null);
    setActiveId(errBody.chat_id);
    setGuestAwaitingAi(true);
    await loadGuestThread(errBody.guest_token);
  }

  async function deleteGuestChat(chat) {
    if (!token || !chat?.id || chat.chat_type !== "guest" || !isStaffRole(me?.role)) return;
    const label = chat.title || `чат #${chat.id}`;
    if (!window.confirm(`Удалить «${label}» и всю переписку? Это нельзя отменить.`)) {
      return;
    }
    setDeletingChatId(chat.id);
    setSendErr("");
    try {
      const res = await fetch(`${API_URL}/chats/${chat.id}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setSendErr(typeof body.detail === "string" ? body.detail : "Не удалось удалить чат");
        return;
      }
      setChats((prev) => prev.filter((c) => c.id !== chat.id));
      if (activeId === chat.id) {
        setActiveId(null);
        setMessages([]);
        setListVisible(true);
        router.replace("/messages", undefined, { shallow: true });
      }
    } catch {
      setSendErr("Сбой связи с API при удалении чата");
    } finally {
      setDeletingChatId(null);
    }
  }

  async function sendMessage(e) {
    e?.preventDefault();
    setSendErr("");
    const text = draft.trim();
    if (guestMode) {
      if (!text) return;
      const res = await fetch(`${API_URL}/public/guest-chats/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ guest_token: guestToken || null, text }),
      });
      const errBody = await res.json().catch(() => ({}));
      if (!res.ok) {
        setSendErr(typeof errBody.detail === "string" ? errBody.detail : "Не удалось отправить");
        return;
      }
      persistGuestToken(errBody.guest_token);
      setDraft("");
      setAttachFile(null);
      setActiveId(errBody.chat_id);
      setGuestAwaitingAi(true);
      await loadGuestThread(errBody.guest_token);
      return;
    }
    if ((!text && !attachFile) || !activeId || !token) return;
    const fd = new FormData();
    fd.append("text", draft);
    if (attachFile) fd.append("file", attachFile);
    const res = await fetch(`${API_URL}/chats/${activeId}/messages`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
      body: fd,
    });
    const errBody = await res.json().catch(() => ({}));
    if (!res.ok) {
      setSendErr(typeof errBody.detail === "string" ? errBody.detail : "Не удалось отправить");
      return;
    }
    setDraft("");
    setAttachFile(null);
    await loadThread(activeId);
  }

  const activeChat = chats.find((c) => c.id === activeId);
  const staffCanDeleteGuest = isStaffRole(me?.role);
  const filteredChats = chats.filter((c) => {
    const q = chatQuery.trim().toLowerCase();
    if (!q) return true;
    const hay = `${c.title || ""} ${c.peer_display || ""} ${c.last_message_text || ""} ${c.request_id || ""}`.toLowerCase();
    return hay.includes(q);
  });

  const showSidebar = guestMode ? false : !narrow || listVisible;
  const showThread = guestMode ? true : !narrow || !listVisible;

  return (
    <div
      className={`layout layout--messages${threadOpenOnMobile ? " layout--no-mobile-dock" : ""}`}
    >
      <SiteHeader tagline={guestMode ? "" : "Чаты"}>
          <Link href="/catalog" className="btn btn-ghost btn-sm">
            Каталог
          </Link>
          {guestMode ? null : (
            <>
              <HeaderProfileLink token={token} me={me} />
              <button type="button" className="btn btn-ghost btn-sm" onClick={logout}>
                Выйти
              </button>
            </>
          )}
        </SiteHeader>

      <main className="site-main site-main--messenger">
        <div className={`messenger${!showSidebar ? " messenger--no-sidebar" : ""}`}>
          {showSidebar && (
            <aside className="messenger__sidebar panel">
              <h1 className="messenger__sidebar-title">Чаты</h1>
              <p className="messenger__sidebar-lead muted">
                Переписка, документы и договорённости по сделке сохраняются здесь.
              </p>
              {chats.length > 0 ? (
                <label className="messenger__search">
                  <span className="visually-hidden">Поиск по чатам</span>
                  <input
                    className="input"
                    type="search"
                    placeholder="Поиск по чатам"
                    value={chatQuery}
                    onChange={(e) => setChatQuery(e.target.value)}
                  />
                </label>
              ) : null}
              {loadingList ? (
                <p className="muted">Загрузка…</p>
              ) : filteredChats.length === 0 ? (
                <div className="messenger__empty-state">
                  <p className="messenger__empty-title">Диалогов ещё нет</p>
                  <p className="muted messenger__empty">
                    Задайте вопрос по любому авто или оставьте заявку — чат откроется автоматически.
                  </p>
                  <div className="messenger__empty-actions">
                    <Link href="/catalog" className="btn btn-primary btn-sm">
                      В каталог
                    </Link>
                    <Link href="/request-quote" className="btn btn-secondary btn-sm">
                      Заявка
                    </Link>
                  </div>
                </div>
              ) : (
                <ul className="messenger__list">
                  {filteredChats.map((c) => (
                    <li key={c.id}>
                      <button
                        type="button"
                        className={`messenger__list-item${c.id === activeId ? " messenger__list-item--active" : ""}`}
                        onClick={() => pickChat(c)}
                      >
                        <div className="messenger__list-item-top">
                          <span className="messenger__list-title">{c.title}</span>
                          <span className="messenger__list-item-meta">
                            {staffCanDeleteGuest && c.chat_type === "guest" ? (
                              <span
                                role="button"
                                tabIndex={0}
                                className="messenger__list-delete"
                                title="Удалить гостевой чат"
                                aria-label={`Удалить ${c.title || "гостевой чат"}`}
                                aria-disabled={deletingChatId === c.id}
                                onClick={(e) => {
                                  e.preventDefault();
                                  e.stopPropagation();
                                  if (deletingChatId === c.id) return;
                                  deleteGuestChat(c);
                                }}
                                onKeyDown={(e) => {
                                  if (e.key === "Enter" || e.key === " ") {
                                    e.preventDefault();
                                    e.stopPropagation();
                                    if (deletingChatId !== c.id) deleteGuestChat(c);
                                  }
                                }}
                              >
                                {deletingChatId === c.id ? "…" : "×"}
                              </span>
                            ) : null}
                            <span className="messenger__list-time muted">
                              {formatListTime(c.last_message_at)}
                            </span>
                          </span>
                        </div>
                        <div className="messenger__list-peer muted">
                          {c.chat_type === "guest"
                            ? "Гость · без аккаунта"
                            : c.chat_type === "platform"
                              ? isStaffRole(me?.role)
                                ? c.peer_display || "Клиент"
                                : "Avtovozom · сделка"
                              : c.peer_display}
                          {c.request_id != null ? ` · заявка №${c.request_id}` : ""}
                        </div>
                        <div className="messenger__list-preview">
                          <span className="messenger__list-preview-text">
                            {c.last_message_text || "Нет сообщений"}
                          </span>
                          {c.unread_count > 0 ? (
                            <span className="messenger__unread-pill">{c.unread_count > 99 ? "99+" : c.unread_count}</span>
                          ) : null}
                        </div>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </aside>
          )}

          {showThread && (
            <section className="messenger__thread panel">
              {!activeId ? (
                <div className="messenger__thread-placeholder muted">Выберите диалог слева</div>
              ) : (
                <>
                  <div className={`messenger__thread-head${guestMode ? " messenger__thread-head--guest" : ""}`}>
                    {guestMode ? (
                      <>
                        <button
                          type="button"
                          className="messenger__back-icon"
                          onClick={backFromGuestChat}
                          aria-label="Назад"
                        >
                          ←
                        </button>
                        <div className="messenger__guest-avatar" aria-hidden>
                          <GuestConsultantIcon />
                        </div>
                        <div className="messenger__thread-head-text">
                          <h2 className="messenger__thread-title">{GUEST_CHAT_TITLE}</h2>
                          <p className="messenger__thread-sub messenger__thread-sub--online">
                            {GUEST_CHAT_SUB}
                          </p>
                        </div>
                        <Link href="/auth?next=/messages" className="messenger__guest-login">
                          Войти
                        </Link>
                      </>
                    ) : (
                      <>
                        {narrow ? (
                          <button
                            type="button"
                            className="btn btn-ghost btn-sm messenger__back"
                            onClick={backToList}
                          >
                            ← Чаты
                          </button>
                        ) : null}
                        <div className="messenger__thread-head-text">
                          <h2 className="messenger__thread-title">
                            {activeChat?.title || `Чат №${activeId}`}
                          </h2>
                          <p className="messenger__thread-sub muted">
                            {activeChat?.chat_type === "guest"
                              ? "Гость · без аккаунта"
                              : activeChat?.chat_type === "platform"
                                ? isStaffRole(me?.role)
                                  ? activeChat?.peer_display || "Клиент"
                                  : "Avtovozom · сделка"
                                : activeChat?.peer_display}
                            {activeChat?.request_id != null
                              ? ` · заявка №${activeChat.request_id}`
                              : ""}
                          </p>
                        </div>
                        {staffCanDeleteGuest && activeChat?.chat_type === "guest" ? (
                          <button
                            type="button"
                            className="btn btn-ghost btn-sm messenger__thread-delete"
                            disabled={deletingChatId === activeChat.id}
                            onClick={() => deleteGuestChat(activeChat)}
                          >
                            {deletingChatId === activeChat.id ? "Удаление…" : "Удалить"}
                          </button>
                        ) : null}
                      </>
                    )}
                  </div>

                  <div className="messenger__bubble-wrap">
                    {loadingThread ? (
                      <p className="muted">Загрузка сообщений…</p>
                    ) : (
                      <div className="messenger__bubbles" role="log" aria-live="polite">
                        {guestMode ? (
                          <div className="messenger__guest-notice" role="note">
                            Без регистрации · история не сохраняется
                          </div>
                        ) : null}
                        {guestMode && messages.length === 0 && !draft.trim() ? (
                          <div className="messenger__guest-prompts">
                            {GUEST_QUICK_PROMPTS.map((prompt) => (
                              <button
                                key={prompt}
                                type="button"
                                className="messenger__guest-prompt"
                                onClick={() => applyGuestQuickPrompt(prompt)}
                              >
                                <span>{prompt}</span>
                                <span className="messenger__guest-prompt-chev" aria-hidden>
                                  ›
                                </span>
                              </button>
                            ))}
                          </div>
                        ) : null}
                        {messages.map((m) => {
                          if (m.message_type === "system") {
                            return (
                              <div key={m.id} className="messenger__system-msg">
                                <p>{m.text}</p>
                                <time className="messenger__system-time" dateTime={m.created_at}>
                                  {formatMsgTime(m.created_at)}
                                </time>
                              </div>
                            );
                          }
                          const mine = guestMode
                            ? m.sender_user_id == null && m.message_type !== "assistant"
                            : Boolean(
                                me &&
                                  (m.sender_user_id === me.id ||
                                    (activeChat?.chat_type === "guest" && m.message_type === "assistant"))
                              );
                          const att = m.attachment_url;
                          const attName = m.attachment_original_name || "файл";
                          const showImg = att && attachmentIsImage(attName);
                          return (
                            <div
                              key={m.id}
                              className={`messenger__bubble-row${mine ? " messenger__bubble-row--mine" : ""}`}
                            >
                              <div className={`messenger__bubble${mine ? " messenger__bubble--mine" : ""}`}>
                                {m.text ? <p className="messenger__bubble-text">{renderMessageText(m.text)}</p> : null}
                                {att ? (
                                  <div className="messenger__attachment">
                                    {showImg ? (
                                      <a href={mediaSrc(att)} target="_blank" rel="noopener noreferrer">
                                        <img
                                          className="messenger__attachment-img"
                                          src={mediaSrc(att)}
                                          alt={attName}
                                        />
                                      </a>
                                    ) : (
                                      <a
                                        className="messenger__attachment-link"
                                        href={mediaSrc(att)}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                      >
                                        📎 {attName}
                                      </a>
                                    )}
                                  </div>
                                ) : null}
                                <time className="messenger__bubble-time" dateTime={m.created_at}>
                                  {formatMsgTime(m.created_at)}
                                </time>
                              </div>
                            </div>
                          );
                        })}
                        <div ref={threadEndRef} />
                      </div>
                    )}
                  </div>

                  <form className="messenger__composer" onSubmit={sendMessage}>
                    {sendErr ? <p className="messenger__composer-err">{sendErr}</p> : null}
                    {guestMode && guestAwaitingAi ? (
                      <p className="messenger__composer-hint muted" aria-live="polite">
                        Консультант печатает…
                      </p>
                    ) : null}
                    {attachFile && !guestMode ? (
                      <p className="messenger__attach-picked muted">
                        Вложение: <strong>{attachFile.name}</strong>{" "}
                        <button type="button" className="btn btn-ghost btn-sm" onClick={() => setAttachFile(null)}>
                          Убрать
                        </button>
                      </p>
                    ) : null}
                    <div className="messenger__composer-row">
                      <div className="messenger__composer-field">
                        {!guestMode ? (
                        <label className="messenger__clip-btn" title="Прикрепить файл" aria-label="Прикрепить файл">
                          <svg
                            className="messenger__clip-icon"
                            width="22"
                            height="22"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            aria-hidden
                          >
                            <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" />
                          </svg>
                          <input
                            type="file"
                            className="messenger__file-input"
                            accept=".pdf,.png,.jpg,.jpeg,.webp,.gif,.doc,.docx,.xls,.xlsx,.txt,.zip,.heic"
                            onChange={(e) => {
                              const f = e.target.files?.[0];
                              setAttachFile(f || null);
                              e.target.value = "";
                            }}
                          />
                        </label>
                        ) : null}
                        <textarea
                          ref={composerInputRef}
                          className="messenger__composer-input"
                          rows={1}
                          placeholder={guestMode ? "Напишите сообщение…" : "Сообщение…"}
                          enterKeyHint="send"
                          autoComplete="off"
                          value={draft}
                          onChange={(e) => setDraft(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter" && !e.shiftKey) {
                              e.preventDefault();
                              sendMessage();
                            }
                          }}
                        />
                      </div>
                      <button
                        type="submit"
                        className="messenger__send-fab"
                        disabled={!draft.trim() && !(attachFile && !guestMode)}
                        aria-label="Отправить"
                      >
                        <svg
                          className="messenger__send-fab-icon"
                          width="20"
                          height="20"
                          viewBox="0 0 24 24"
                          fill="currentColor"
                          aria-hidden
                        >
                          <path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z" />
                        </svg>
                      </button>
                    </div>
                  </form>
                </>
              )}
            </section>
          )}
        </div>
      </main>
    </div>
  );
}
