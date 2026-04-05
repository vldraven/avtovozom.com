import Link from "next/link";
import { useRouter } from "next/router";
import { useCallback, useEffect, useRef, useState } from "react";

import HeaderProfileLink from "../components/HeaderProfileLink";
import { clearToken, getStoredToken } from "../lib/auth";
import { mediaSrc } from "../lib/media";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

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
  const threadEndRef = useRef(null);

  const scrollThreadToEnd = () => {
    requestAnimationFrame(() => {
      threadEndRef.current?.scrollIntoView({ behavior: "smooth" });
    });
  };

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

  useEffect(() => {
    let cancelled = false;
    const t = getStoredToken();
    if (!t) {
      router.replace("/auth?next=/messages");
      return undefined;
    }
    setToken(t);
    (async () => {
      const res = await fetch(`${API_URL}/auth/me`, { headers: { Authorization: `Bearer ${t}` } });
      if (!res.ok) {
        clearToken();
        router.replace("/auth?next=/messages");
        return;
      }
      const u = await res.json();
      if (cancelled) return;
      setMe(u);
      setLoadingList(true);
      const cr = await fetch(`${API_URL}/chats/my`, { headers: { Authorization: `Bearer ${t}` } });
      if (!cancelled && cr.ok) setChats(await cr.json());
      if (!cancelled) setLoadingList(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [router]);

  useEffect(() => {
    if (!router.isReady || !token) return;
    const raw = router.query.chat;
    if (raw == null || raw === "") return;
    const id = Number(Array.isArray(raw) ? raw[0] : raw);
    if (!Number.isFinite(id)) return;
    setActiveId(id);
    if (narrow) setListVisible(false);
    loadThread(id, token);
  }, [router.isReady, router.query.chat, token, narrow, loadThread]);

  useEffect(() => {
    if (!token) return undefined;
    const id = setInterval(() => loadChats(token), 26000);
    return () => clearInterval(id);
  }, [token, loadChats]);

  useEffect(() => {
    scrollThreadToEnd();
  }, [messages, activeId]);

  function logout() {
    clearToken();
    setToken("");
    setMe(null);
    router.push("/");
  }

  function pickChat(c) {
    setActiveId(c.id);
    setSendErr("");
    if (narrow) setListVisible(false);
    router.replace({ pathname: "/messages", query: { chat: c.id } }, undefined, { shallow: true });
    loadThread(c.id);
  }

  function backToList() {
    setListVisible(true);
    router.replace("/messages", undefined, { shallow: true });
  }

  async function sendMessage(e) {
    e?.preventDefault();
    setSendErr("");
    const text = draft.trim();
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

  const showSidebar = !narrow || listVisible;
  const showThread = !narrow || !listVisible;

  return (
    <div className="layout layout--messages">
      <header className="site-header">
        <div className="container site-header__inner">
          <div className="site-header__brand">
            <Link href="/" className="site-logo">
              avtovozom
            </Link>
            <span className="site-brand-divider" aria-hidden="true" />
            <span className="site-tagline">Сообщения</span>
          </div>
          <div className="auth-bar">
            <Link href="/" className="btn btn-ghost btn-sm">
              Каталог
            </Link>
            <HeaderProfileLink token={token} userRole={me?.role} />
            <button type="button" className="btn btn-ghost btn-sm" onClick={logout}>
              Выйти
            </button>
          </div>
        </div>
      </header>

      <main className="site-main site-main--messenger">
        <div className="messenger">
          {showSidebar && (
            <aside className="messenger__sidebar panel">
              <h1 className="messenger__sidebar-title">Диалоги</h1>
              {loadingList ? (
                <p className="muted">Загрузка…</p>
              ) : chats.length === 0 ? (
                <p className="muted messenger__empty">
                  Пока нет переписок. Клиенту чат откроется после выбора предложения дилера; дилеру — после
                  отправки расчёта по заявке.
                </p>
              ) : (
                <ul className="messenger__list">
                  {chats.map((c) => (
                    <li key={c.id}>
                      <button
                        type="button"
                        className={`messenger__list-item${c.id === activeId ? " messenger__list-item--active" : ""}`}
                        onClick={() => pickChat(c)}
                      >
                        <div className="messenger__list-item-top">
                          <span className="messenger__list-title">{c.title}</span>
                          <span className="messenger__list-time muted">{formatListTime(c.last_message_at)}</span>
                        </div>
                        <div className="messenger__list-peer muted">{c.peer_display}</div>
                        <div className="messenger__list-preview">
                          {c.last_message_text || "Нет сообщений"}
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
                  <div className="messenger__thread-head">
                    {narrow ? (
                      <button type="button" className="btn btn-ghost btn-sm messenger__back" onClick={backToList}>
                        ← Чаты
                      </button>
                    ) : null}
                    <div className="messenger__thread-head-text">
                      <h2 className="messenger__thread-title">{activeChat?.title || `Чат №${activeId}`}</h2>
                      <p className="messenger__thread-sub muted">{activeChat?.peer_display}</p>
                    </div>
                  </div>

                  <div className="messenger__bubble-wrap">
                    {loadingThread ? (
                      <p className="muted">Загрузка сообщений…</p>
                    ) : (
                      <div className="messenger__bubbles" role="log" aria-live="polite">
                        {messages.map((m) => {
                          const mine = me && m.sender_user_id === me.id;
                          const att = m.attachment_url;
                          const attName = m.attachment_original_name || "файл";
                          const showImg = att && attachmentIsImage(attName);
                          return (
                            <div
                              key={m.id}
                              className={`messenger__bubble-row${mine ? " messenger__bubble-row--mine" : ""}`}
                            >
                              <div className={`messenger__bubble${mine ? " messenger__bubble--mine" : ""}`}>
                                {m.text ? <p className="messenger__bubble-text">{m.text}</p> : null}
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
                    {attachFile ? (
                      <p className="messenger__attach-picked muted">
                        Вложение: <strong>{attachFile.name}</strong>{" "}
                        <button type="button" className="btn btn-ghost btn-sm" onClick={() => setAttachFile(null)}>
                          Убрать
                        </button>
                      </p>
                    ) : null}
                    <div className="messenger__composer-row">
                      <div className="input messenger__input-shell">
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
                        <textarea
                          className="messenger__composer-input messenger__composer-input--inset"
                          rows={2}
                          placeholder="Сообщение…"
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
                        disabled={!draft.trim() && !attachFile}
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
                    <p className="muted messenger__composer-hint" style={{ margin: "8px 0 0", fontSize: 13 }}>
                      До 15 МБ: фото, PDF, документы. Можно отправить текст, вложение или оба сразу.
                    </p>
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
