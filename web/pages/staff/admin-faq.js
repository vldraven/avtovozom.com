import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/router";

import HeaderProfileLink from "../../components/HeaderProfileLink";
import { clearToken, getStoredToken } from "../../lib/auth";
import { isAdminRole } from "../../lib/roles";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

function emptyDraft() {
  return { question: "", answer: "", sort_order: "", is_published: true };
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

  const loadItems = useCallback(async (t) => {
    const res = await fetch(`${API_URL}/admin/faq`, {
      headers: { Authorization: `Bearer ${t}` },
    });
    if (!res.ok) {
      setError("Не удалось загрузить FAQ");
      return;
    }
    const data = await res.json();
    setItems(data);
    const next = {};
    for (const item of data) {
      next[item.id] = {
        question: item.question,
        answer: item.answer,
        sort_order: String(item.sort_order),
        is_published: item.is_published,
      };
    }
    setDrafts(next);
  }, []);

  useEffect(() => {
    const t = getStoredToken();
    if (!t) {
      router.push("/auth?next=/staff/admin-faq");
      return;
    }
    setToken(t);
    (async () => {
      const res = await fetch(`${API_URL}/auth/me`, { headers: { Authorization: `Bearer ${t}` } });
      if (!res.ok) {
        clearToken();
        router.push("/auth?next=/staff/admin-faq");
        return;
      }
      const data = await res.json();
      setMe(data);
      if (!isAdminRole(data.role)) {
        router.replace("/profile");
        return;
      }
      await loadItems(t);
      setLoading(false);
    })();
  }, [router, loadItems]);

  function updateDraft(id, field, value) {
    setDrafts((prev) => ({
      ...prev,
      [id]: { ...prev[id], [field]: value },
    }));
  }

  async function saveItem(id) {
    setError("");
    setMessage("");
    const d = drafts[id];
    if (!d) return;
    const question = (d.question || "").trim();
    const answer = (d.answer || "").trim();
    if (!question || !answer) {
      setError("Заполните вопрос и ответ");
      return;
    }
    const sortRaw = String(d.sort_order ?? "").trim();
    const sort_order = sortRaw === "" ? 0 : Number.parseInt(sortRaw, 10);
    if (Number.isNaN(sort_order)) {
      setError("Порядок — целое число");
      return;
    }
    const res = await fetch(`${API_URL}/admin/faq/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        question,
        answer,
        sort_order,
        is_published: Boolean(d.is_published),
      }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      setError(typeof body.detail === "string" ? body.detail : "Ошибка сохранения");
      return;
    }
    setMessage("Сохранено");
    await loadItems(token);
  }

  async function deleteItem(id) {
    if (!window.confirm("Удалить этот вопрос?")) return;
    setError("");
    setMessage("");
    const res = await fetch(`${API_URL}/admin/faq/${id}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) {
      setError("Не удалось удалить");
      return;
    }
    setMessage("Удалено");
    await loadItems(token);
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
    const payload = { question, answer, is_published: createDraft.is_published };
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
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
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
    await loadItems(token);
  }

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
      <header className="site-header">
        <div className="container site-header__inner">
          <Link href="/profile" className="site-logo">
            avtovozom
          </Link>
          <div className="auth-bar">
            <HeaderProfileLink token={token} userRole={me?.role} />
          </div>
        </div>
      </header>

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
              onClick={() => setCreateOpen((v) => !v)}
            >
              {createOpen ? "Скрыть форму" : "Добавить вопрос"}
            </button>
          </div>

          {createOpen ? (
            <section className="panel admin-faq-editor">
              <h2 className="section-title section-title--flush-top">Новый вопрос</h2>
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
            {items.map((item) => {
              const d = drafts[item.id] || {};
              return (
                <section key={item.id} className="panel admin-faq-editor">
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
                  <div className="admin-faq-editor__actions">
                    <button type="button" className="btn btn-primary btn-sm" onClick={() => saveItem(item.id)}>
                      Сохранить
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
