import dynamic from "next/dynamic";
import { useState } from "react";

import BlogBody from "./BlogBody";
import { mediaSrc } from "../../lib/media";

const BlogRichText = dynamic(() => import("./BlogRichText"), {
  ssr: false,
  loading: () => <p className="muted">Загрузка редактора текста…</p>,
});

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

function emptyParagraph() {
  return { type: "paragraph", inlines: [{ text: "" }] };
}

export function blocksFromPost(body) {
  const blocks = Array.isArray(body) && body.length ? body : [emptyParagraph()];
  return blocks.map((block) => ({ ...block, inlines: block.inlines ? block.inlines.map((item) => ({ ...item })) : undefined, rows: block.rows ? block.rows.map((row) => [...row]) : undefined }));
}

export default function BlogEditor({
  post,
  sections,
  brands,
  models,
  editorKey,
  onBrand,
  onError,
  token,
  staff,
  busy,
  error,
  notice,
  onChange,
  onSave,
  onSubmit,
  onPublish,
  onPreview,
  preview,
}) {
  const [tagDraft, setTagDraft] = useState("");

  function patch(partial) {
    onChange({ ...post, ...partial });
  }

  async function uploadFile(file, assign) {
    const form = new FormData();
    form.append("file", file);
    const res = await fetch(`${API_URL}/blog/uploads`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
      body: form,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.detail || "Не удалось загрузить изображение.");
    assign(data.url);
  }

  function addTag() {
    const name = tagDraft.trim();
    if (!name) return;
    const tags = Array.isArray(post.tags) ? post.tags : [];
    if (tags.some((tag) => tag.toLowerCase() === name.toLowerCase())) {
      setTagDraft("");
      return;
    }
    patch({ tags: [...tags, name].slice(0, 8) });
    setTagDraft("");
  }

  return (
    <div className="blog-editor">
      <div className="blog-editor__bar panel">
        <p className={`blog-status blog-status--${post.status || "draft"}`}>{notice || "Черновик"}</p>
        <div className="blog-editor__bar-actions">
          <button type="button" className="btn btn-secondary btn-sm" onClick={onSave} disabled={busy}>
            Сохранить черновик
          </button>
          <button type="button" className="btn btn-ghost btn-sm" onClick={onPreview}>
            {preview ? "К редактору" : "Превью"}
          </button>
          <button
            type="button"
            className={`btn btn-sm ${staff ? "btn-secondary" : "btn-primary"}`}
            onClick={onSubmit}
            disabled={busy}
          >
            На проверку
          </button>
          {staff ? (
            <button type="button" className="btn btn-primary btn-sm" onClick={onPublish} disabled={busy}>
              Опубликовать
            </button>
          ) : null}
        </div>
      </div>
      {error ? <p className="blog-form-error">{error}</p> : null}
      {preview ? (
        <article className="blog-article">
          {post.cover_url ? <img className="blog-article__cover" src={mediaSrc(post.cover_url, 960)} alt="" /> : null}
          <h1>{post.title || "Без заголовка"}</h1>
          <BlogBody blocks={post.body} />
        </article>
      ) : (
        <div className="blog-editor__grid">
          <div className="blog-editor__main">
            <label className="blog-cover-drop">
              {post.cover_url ? <img src={mediaSrc(post.cover_url, 960)} alt="" /> : <span>Перетащите обложку или выберите файл. JPG или PNG, лучше от 1200×630.</span>}
              <input
                type="file"
                accept="image/jpeg,image/png,image/webp,image/gif"
                onChange={async (event) => {
                  const file = event.target.files?.[0];
                  event.target.value = "";
                  if (!file) return;
                  try {
                    await uploadFile(file, (url) => patch({ cover_url: url }));
                  } catch (err) {
                    onError?.(err.message);
                  }
                }}
              />
            </label>
            <input
              className="input blog-editor__title"
              value={post.title === "Черновик" ? "" : post.title || ""}
              placeholder="Заголовок"
              maxLength={180}
              onChange={(event) => patch({ title: event.target.value })}
            />
            <textarea
              className="input"
              value={post.excerpt || ""}
              placeholder="Короткий анонс для ленты"
              maxLength={400}
              rows={3}
              onChange={(event) => patch({ excerpt: event.target.value })}
            />
            <BlogRichText
              key={editorKey || "draft"}
              initialBlocks={post.body}
              token={token}
              onError={onError}
              onChange={(body) => patch({ body })}
            />
          </div>
          <aside className="blog-editor__side">
            <section className="panel">
              <h2 className="section-title panel-heading-sm">Публикация</h2>
              <label className="form-label">
                Раздел
                <select
                  className="input"
                  value={post.section_id || ""}
                  onChange={(event) => patch({ section_id: event.target.value ? Number(event.target.value) : null })}
                >
                  <option value="">Не выбран</option>
                  {sections.map((section) => (
                    <option key={section.id} value={section.id}>
                      {section.title}
                    </option>
                  ))}
                </select>
              </label>
              <label className="form-label">
                Адрес страницы
                {staff ? (
                  <input className="input" value={post.slug || ""} onChange={(event) => patch({ slug: event.target.value })} />
                ) : (
                  <>
                    <input className="input" value={post.slug || ""} readOnly disabled />
                    <span className="muted">Собирается из заголовка при сохранении</span>
                  </>
                )}
              </label>
            </section>
            <section className="panel">
              <h2 className="section-title panel-heading-sm">Теги</h2>
              <div className="blog-tags">
                {(post.tags || []).map((tag) => (
                  <button
                    key={tag}
                    type="button"
                    className="btn btn-ghost btn-sm"
                    onClick={() => patch({ tags: post.tags.filter((item) => item !== tag) })}
                  >
                    #{tag} ×
                  </button>
                ))}
              </div>
              <div className="blog-tag-add">
                <input
                  className="input"
                  value={tagDraft}
                  placeholder="Новый тег"
                  onChange={(event) => setTagDraft(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.preventDefault();
                      addTag();
                    }
                  }}
                />
                <button type="button" className="btn btn-secondary btn-sm" onClick={addTag}>
                  Добавить
                </button>
              </div>
            </section>
            <section className="panel">
              <h2 className="section-title panel-heading-sm">Поиск</h2>
              <label className="form-label">
                Описание для поиска
                <textarea
                  className="input"
                  maxLength={160}
                  rows={4}
                  value={post.seo_description || ""}
                  onChange={(event) => patch({ seo_description: event.target.value })}
                />
                <span className="muted">{(post.seo_description || "").length} из 160 символов</span>
              </label>
            </section>
            <section className="panel">
              <h2 className="section-title panel-heading-sm">На карточке авто</h2>
              <label className="form-label">
                Марка
                <select
                  className="input"
                  value={post.brand_id || ""}
                  onChange={(event) => {
                    const brandId = event.target.value ? Number(event.target.value) : null;
                    patch({ brand_id: brandId, model_id: null });
                    onBrand(brandId);
                  }}
                >
                  <option value="">Не привязана</option>
                  {brands.map((brand) => (
                    <option key={brand.id} value={brand.id}>
                      {brand.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="form-label">
                Модель
                <select
                  className="input"
                  value={post.model_id || ""}
                  onChange={(event) => patch({ model_id: event.target.value ? Number(event.target.value) : null })}
                >
                  <option value="">Не привязана</option>
                  {models.map((model) => (
                    <option key={model.id} value={model.id}>
                      {model.name}
                    </option>
                  ))}
                </select>
              </label>
              {staff ? (
                <label className="checkbox-inline">
                  <input
                    type="checkbox"
                    checked={Boolean(post.as_editorial)}
                    onChange={(event) => patch({ as_editorial: event.target.checked })}
                  />
                  От имени редакции Avtovozom
                </label>
              ) : (
                <p className="muted">Публикация выйдет в ленту после проверки. Правка уже опубликованного текста снова отправит его на проверку.</p>
              )}
            </section>
          </aside>
        </div>
      )}
    </div>
  );
}
