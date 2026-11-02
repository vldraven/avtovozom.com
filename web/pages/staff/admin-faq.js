import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/router";

import HeaderProfileLink from "../../components/HeaderProfileLink";
import { clearToken, ensureFreshAccessToken, getStoredToken } from "../../lib/auth";
import {
  FAQ_SECTION_DEFAULT,
  FAQ_SECTION_OPTIONS,
  faqSectionLabel,
  normalizeFaqSection,
} from "../../lib/faqSections";
import { isAdminRole } from "../../lib/roles";
import SiteHeader from "../../components/SiteHeader";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

function emptyDraft() {
  return { question: "", answer: "", section: FAQ_SECTION_DEFAULT, sort_order: "", is_published: true };
}

function draftFromItem(item) {
  return {
    question: item.question || "",
    answer: item.answer || "",
    section: normalizeFaqSection(item.section),
    sort_order: item.sort_order == null ? "" : String(item.sort_order),
    is_published: Boolean(item.is_published),
  };
}

function apiErrorMessage(body, fallback) {
  const detail = body?.detail;
  if (typeof detail === "string" && detail.trim()) return detail;
  if (Array.isArray(detail)) {
    const text = detail
      .map((item) => (typeof item?.msg === "string" ? item.msg : ""))
      .filter(Boolean)
      .join(". ");
    if (/at most 512|max_length/i.test(text)) return "Вопрос не длиннее 512 символов";
    if (text) return text;
  }
  return fallback;
}

export default function AdminFaqPage() {
  const router = useRouter();
  const [token, setToken] = useState("");
  const [me, setMe] = useState(null);
  const [items, setItems] = useState([]);
  const [drafts, setDrafts] = useState({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [createDraft, setCreateDraft] = useState(emptyDraft);
  const [createOpen, setCreateOpen] = useState(false);
  const [adminSection, setAdminSection] = useState("all");
  const [savingId, setSavingId] = useState(null);
  const [cardError, setCardError] = useState({});
  const [cardMessage, setCardMessage] = useState({});
  const loadSeq = useRef(0);
  const routerRef = useRef(router);
  routerRef.current = router;

  const loadItems = useCallback(async (t) => {
    const seq = ++loadSeq.current;
    const res = await fetch(`${API_URL}/admin/faq`, {
      cache: "no-store",
      headers: { Authorization: `Bearer ${t}` },
    });
    if (seq !== loadSeq.current) return;
    if (!res.ok) {
      setError("Не удалось загрузить FAQ");
      return;
    }
    const data = await res.json();
    if (seq !== loadSeq.current) return;
    setItems(data);
    const next = {};
    for (const item of data) {
      next[item.id] = draftFromItem(item);
    }
    setDrafts(next);
  }, []);

  useEffect(() => {
    let cancelled = false;
    const t = getStoredToken();
    if (!t) {
      routerRef.current.push("/auth?next=/staff/admin-faq");
      return undefined;
    }
    setToken(t);
    (async () => {
      const res = await fetch(`${API_URL}/auth/me`, {
        cache: "no-store",
        headers: { Authorization: `Bearer ${t}` },
      });
      if (cancelled) return;
      if (!res.ok) {
        clearToken();
        routerRef.current.push("/auth?next=/staff/admin-faq");
        return;
      }
      const data = await res.json();
      if (cancelled) return;
      setMe(data);
      if (!isAdminRole(data.role)) {
        routerRef.current.replace("/profile");
        return;
      }
      await loadItems(t);
      if (!cancelled) setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [loadItems]);

  function updateDraft(id, field, value) {
    setDrafts((prev) => ({
      ...prev,
      [id]: { ...prev[id], [field]: value },
    }));
    setCardError((prev) => (prev[id] ? { ...prev, [id]: "" } : prev));
    setCardMessage((prev) => (prev[id] ? { ...prev, [id]: "" } : prev));
  }

  function failSave(id, text) {
    setCardError((prev) => ({ ...prev, [id]: text }));
    setError(text);
  }

  async function saveItem(id) {
    setError("");
    setMessage("");
    setCardError((prev) => ({ ...prev, [id]: "" }));
    setCardMessage((prev) => ({ ...prev, [id]: "" }));
    const d = drafts[id];
    if (!d || !String(d.question || "").trim() || !String(d.answer || "").trim()) {
      failSave(id, d ? "Заполните вопрос и ответ" : "Форма ещё не загрузилась. Обновите страницу.");
      return;
    }
    const question = d.question.trim();
    const answer = d.answer.trim();
    if (question.length > 512) {
      failSave(id, "Вопрос не длиннее 512 символов");
      return;
    }
    const sortRaw = String(d.sort_order ?? "").trim();
    const sort_order = sortRaw === "" ? 0 : Number.parseInt(sortRaw, 10);
    if (Number.isNaN(sort_order)) {
      failSave(id, "Порядок — целое число");
      return;
    }
    setSavingId(id);
    try {
      await ensureFreshAccessToken();
      const authToken = getStoredToken();
      if (!authToken) {
        failSave(id, "Сессия истекла. Войдите снова.");
        return;
      }
      const res = await fetch(`${API_URL}/admin/faq/${id}`, {
        method: "PATCH",
        cache: "no-store",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${authToken}` },
        body: JSON.stringify({
          question,
          answer,
          section: normalizeFaqSection(d.section),
          sort_order,
          is_published: Boolean(d.is_published),
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        failSave(id, apiErrorMessage(body, "Ошибка сохранения"));
        return;
      }
      loadSeq.current += 1;
      const saved = draftFromItem(body);
      setItems((prev) => prev.map((item) => (item.id === body.id ? { ...item, ...body } : item)));
      setDrafts((prev) => ({ ...prev, [body.id]: saved }));
      const moved = adminSection !== "all" && saved.section !== adminSection;
      if (moved) {
        setMessage(`Сохранено. Вопрос перенесён в раздел «${faqSectionLabel(saved.section)}».`);
      } else {
        setCardMessage((prev) => ({ ...prev, [id]: "Сохранено" }));
      }
    } catch {
      failSave(id, "Нет связи с сервером. Изменения не сохранены.");
    } finally {
      setSavingId(null);
    }
  }

  async function deleteItem(id) {
    if (!window.confirm("Удалить этот вопрос?")) return;
    setError("");
    setMessage("");
    const res = await fetch(`${API_URL}/admin/faq/${id}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${getStoredToken() || token}` },
    });
    if (!res.ok) {
      setError("Не удалось удалить");
      return;
    }
    setMessage("Удалено");
    await loadItems(getStoredToken() || token);
  }

  async function createItem() {
    setError("");
    setMessage("");
    const question = createDraft.question.trim();
    const answer = createDraft.answer.trim();
    if (!question || !answer) {
      setError("Заполните вопрос и ответ");
      return;
    }
    const sortRaw = createDraft.sort_order.trim();
    const payload = {
      question,
      answer,
      section: normalizeFaqSection(createDraft.section),
      is_published: createDraft.is_published,
    };
    if (sortRaw !== "") {
      const sort_order = Number.parseInt(sortRaw, 10);
      if (Number.isNaN(sort_order)) {
        setError("Порядок — целое число");
        return;
      }
      payload.sort_order = sort_order;
    }
    const res = await fetch(`${API_URL}/admin/faq`, {
      method: "POST",
      cache: "no-store",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${getStoredToken() || token}` },
      body: JSON.stringify(payload),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      setError(typeof body.detail === "string" ? body.detail : "Ошибка создания");
      return;
    }
    setCreateDraft(emptyDraft());
    setCreateOpen(false);
    setMessage("Добавлено");
    await loadItems(getStoredToken() || token);
  }

  const displayItems =
    adminSection === "all"
      ? items
      : items.filter((item) => normalizeFaqSection(item.section) === adminSection);

  if (loading) {
    return (
      <div className="layout">
        <main className="site-main">
          <div className="container">
            <p className="muted">Загрузка…</p>
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className="layout">
      <SiteHeader logoHref="/profile">
          <HeaderProfileLink token={token} me={me} />
        </SiteHeader>

      <main className="site-main">
        <div className="container page-narrow">
          <div className="admin-page-head">
            <h1 className="section-title">FAQ — редактирование</h1>
            <Link href="/faq" className="btn btn-ghost btn-sm">
              Открыть /faq
            </Link>
          </div>

          {error ? <div className="alert alert--danger">{error}</div> : null}
          {message ? <div className="alert alert--success">{message}</div> : null}

          <div className="admin-faq-toolbar">
            <button
              type="button"
              className="btn btn-primary btn-sm"
              onClick={() => {
                setCreateOpen((open) => {
                  const next = !open;
                  if (next && adminSection !== "all") {
                    setCreateDraft({ ...emptyDraft(), section: adminSection });
                  }
                  return next;
                });
              }}
            >
              {createOpen ? "Скрыть форму" : "Добавить вопрос"}
            </button>
          </div>

          <div className="faq-page-tabs admin-faq-section-tabs" role="tablist" aria-label="Разделы FAQ">
            <button
              type="button"
              role="tab"
              aria-selected={adminSection === "all"}
              className={`faq-page-tabs__btn${adminSection === "all" ? " is-active" : ""}`}
              onClick={() => setAdminSection("all")}
            >
              Все
            </button>
            {FAQ_SECTION_OPTIONS.map((s) => (
              <button
                key={s.id}
                type="button"
                role="tab"
                aria-selected={adminSection === s.id}
                className={`faq-page-tabs__btn${adminSection === s.id ? " is-active" : ""}`}
                onClick={() => setAdminSection(s.id)}
              >
                {s.mobileLabel || s.label}
              </button>
            ))}
          </div>

          {createOpen ? (
            <section className="panel admin-faq-editor">
              <h2 className="section-title section-title--flush-top">Новый вопрос</h2>
              <label className="field-label">
                Раздел
                <select
                  className="input"
                  value={createDraft.section}
                  onChange={(e) => setCreateDraft((d) => ({ ...d, section: e.target.value }))}
                >
                  {FAQ_SECTION_OPTIONS.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field-label">
                Вопрос
                <input
                  className="input"
                  value={createDraft.question}
                  onChange={(e) => setCreateDraft((d) => ({ ...d, question: e.target.value }))}
                />
              </label>
              <label className="field-label">
                Ответ
                <textarea
                  className="input"
                  rows={5}
                  value={createDraft.answer}
                  onChange={(e) => setCreateDraft((d) => ({ ...d, answer: e.target.value }))}
                />
              </label>
              <label className="field-label">
                Порядок (необязательно)
                <input
                  className="input"
                  value={createDraft.sort_order}
                  onChange={(e) => setCreateDraft((d) => ({ ...d, sort_order: e.target.value }))}
                />
              </label>
              <label className="checkbox-inline">
                <input
                  type="checkbox"
                  checked={createDraft.is_published}
                  onChange={(e) =>
                    setCreateDraft((d) => ({ ...d, is_published: e.target.checked }))
                  }
                />
                Опубликован
              </label>
              <button type="button" className="btn btn-primary" onClick={createItem}>
                Создать
              </button>
            </section>
          ) : null}

          <div className="admin-faq-list">
            {displayItems.length === 0 ? (
              <p className="muted">В этом разделе пока нет вопросов.</p>
            ) : null}
            {displayItems.map((item) => {
              const d = drafts[item.id] || {};
              return (
                <section key={item.id} className="panel admin-faq-editor">
                  <p className="admin-faq-editor__section-badge muted">
                    Раздел: {faqSectionLabel(normalizeFaqSection(d.section))}
                  </p>
                  <label className="field-label">
                    Раздел
                    <select
                      className="input"
                      value={d.section || FAQ_SECTION_DEFAULT}
                      onChange={(e) => updateDraft(item.id, "section", e.target.value)}
                    >
                      {FAQ_SECTION_OPTIONS.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="field-label">
                    Вопрос
                    <input
                      className="input"
                      value={d.question || ""}
                      onChange={(e) => updateDraft(item.id, "question", e.target.value)}
                    />
                  </label>
                  <label className="field-label">
                    Ответ
                    <textarea
                      className="input"
                      rows={5}
                      value={d.answer || ""}
                      onChange={(e) => updateDraft(item.id, "answer", e.target.value)}
                    />
                  </label>
                  <div className="admin-faq-editor__meta">
                    <label className="field-label">
                      Порядок
                      <input
                        className="input"
                        value={d.sort_order ?? ""}
                        onChange={(e) => updateDraft(item.id, "sort_order", e.target.value)}
                      />
                    </label>
                    <label className="checkbox-inline">
                      <input
                        type="checkbox"
                        checked={Boolean(d.is_published)}
                        onChange={(e) => updateDraft(item.id, "is_published", e.target.checked)}
                      />
                      Опубликован
                    </label>
                  </div>
                  {cardError[item.id] ? <div className="alert alert--danger">{cardError[item.id]}</div> : null}
                  {cardMessage[item.id] ? <div className="alert alert--success">{cardMessage[item.id]}</div> : null}
                  <div className="admin-faq-editor__actions">
                    <button
                      type="button"
                      className="btn btn-primary btn-sm"
                      disabled={savingId === item.id}
                      onClick={() => saveItem(item.id)}
                    >
                      {savingId === item.id ? "Сохранение…" : "Сохранить"}
                    </button>
                    <button
                      type="button"
                      className="btn btn-secondary btn-sm"
                      onClick={() => deleteItem(item.id)}
                    >
                      Удалить
                    </button>
                  </div>
                </section>
              );
            })}
          </div>
        </div>
      </main>
    </div>
  );
}
