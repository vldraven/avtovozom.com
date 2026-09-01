import Link from "next/link";
import { useRouter } from "next/router";
import { useCallback, useEffect, useMemo, useState } from "react";

import HeaderProfileLink from "../../../components/HeaderProfileLink";
import { clearToken, getStoredToken } from "../../../lib/auth";
import { mediaSrc } from "../../../lib/media";
import { isAdminRole } from "../../../lib/roles";
import SiteHeader from "../../../components/SiteHeader";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";
const MAX_PHOTOS = 10;
const DEFAULT_SELECTION = 5;
const DEFAULT_AI_STYLE_HINT =
  "Ты консультант по продаже авто. Сгенерируй короткое яркое продающее объявление для паблика в телеграм канале по доставке автомобилей из Китая, используй конечную цену в рублях, используй эмоджи для того, чтобы расставить акценты в тексте. Укажи, что указанная цена включает все расходы, доставку до города Москва и таможенное оформление, для расчета стоимости доставки в ваш город можно оставить заявку на расчет на сайте.\n" +
  "Не используй фото в тексте.\n" +
  "Добавь абзац с описанием и sales-поинтами модели, тезисы найди в интернете.\n" +
  "Добавь тезис про попадание машины под льготный утилизационный сбор.\n" +
  'В конце добавь: "🔎 Подробности по комплектации, заказ отчета и расчет доставки до вашего города можно уточнить на сайте:" [Ссылка]\n' +
  "Или тут 👉: @avtovozombot";

function escapeHtml(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function previewHtml(text) {
  const escaped = escapeHtml(text);
  const withBreaks = escaped.replace(/\r\n/g, "\n").split("\n");
  return withBreaks
    .map((line) =>
      line.replace(/(https?:\/\/[^\s<]+)/gi, (url) => {
        const safe = escapeHtml(url);
        return `<a href="${safe}" target="_blank" rel="noopener noreferrer">${safe}</a>`;
      })
    )
    .join("<br />");
}

export default function PublishSocialPage() {
  const router = useRouter();
  const rawId = router.query.id;
  const carId = rawId == null ? "" : String(Array.isArray(rawId) ? rawId[0] : rawId).trim();

  const [token, setToken] = useState("");
  const [me, setMe] = useState(null);
  const [data, setData] = useState(null);
  const [vkMeta, setVkMeta] = useState(null);
  const [maxMeta, setMaxMeta] = useState(null);
  const [vkTokenStatus, setVkTokenStatus] = useState(null);
  const [loadError, setLoadError] = useState("");
  const [selected, setSelected] = useState(() => new Set());
  const [postText, setPostText] = useState("");
  const [styleHint, setStyleHint] = useState(DEFAULT_AI_STYLE_HINT);
  const [channelTg, setChannelTg] = useState(true);
  const [channelVk, setChannelVk] = useState(true);
  const [channelMax, setChannelMax] = useState(true);
  const [vkTokenInput, setVkTokenInput] = useState("");
  const [aiBusy, setAiBusy] = useState(false);
  const [publishBusy, setPublishBusy] = useState(false);
  const [tokenBusy, setTokenBusy] = useState(false);
  const [oauthBusy, setOauthBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const logout = () => {
    clearToken({ logout: true });
    router.push("/");
  };

  const loadVkTokenStatus = useCallback(async (authToken) => {
    const res = await fetch(`${API_URL}/admin/integrations/vk`, {
      headers: { Authorization: `Bearer ${authToken}` },
    });
    if (!res.ok) return null;
    return res.json();
  }, []);

  const loadCompose = useCallback(async () => {
    if (!token || !carId) return;
    setLoadError("");
    const [tgRes, vkRes, maxRes, tok] = await Promise.all([
      fetch(`${API_URL}/admin/cars/${encodeURIComponent(carId)}/telegram-compose`, {
        headers: { Authorization: `Bearer ${token}` },
      }),
      fetch(`${API_URL}/admin/cars/${encodeURIComponent(carId)}/vk-compose`, {
        headers: { Authorization: `Bearer ${token}` },
      }),
      fetch(`${API_URL}/admin/cars/${encodeURIComponent(carId)}/max-compose`, {
        headers: { Authorization: `Bearer ${token}` },
      }),
      loadVkTokenStatus(token),
    ]);
    if (!tgRes.ok) {
      const body = await tgRes.json().catch(() => ({}));
      const d = body.detail;
      setLoadError(typeof d === "string" ? d : "Не удалось загрузить объявление");
      setData(null);
      return;
    }
    const j = await tgRes.json();
    setData(j);
    const ids = (j.photos || []).map((p) => p.id);
    const first = ids.slice(0, Math.min(DEFAULT_SELECTION, ids.length, MAX_PHOTOS));
    setSelected(new Set(first));
    if (vkRes.ok) {
      const vk = await vkRes.json();
      setVkMeta(vk);
      setPostText((prev) => prev || vk.default_text || "");
    } else {
      setVkMeta(null);
    }
    if (maxRes.ok) {
      const max = await maxRes.json();
      setMaxMeta(max);
      setPostText((prev) => prev || max.default_text || "");
    } else {
      setMaxMeta(null);
    }
    if (tok) setVkTokenStatus(tok);
  }, [token, carId, loadVkTokenStatus]);

  useEffect(() => {
    if (!router.isReady) return;
    const t = getStoredToken();
    if (!t) {
      router.push(`/auth?next=${encodeURIComponent(`/staff/publish-social/${carId}`)}`);
      return;
    }
    setToken(t);
    (async () => {
      const res = await fetch(`${API_URL}/auth/me`, { headers: { Authorization: `Bearer ${t}` } });
      if (!res.ok) {
        clearToken();
        router.push(`/auth?next=${encodeURIComponent(`/staff/publish-social/${carId}`)}`);
        return;
      }
      const u = await res.json();
      setMe(u);
      if (!isAdminRole(u.role)) {
        router.replace("/");
      }
    })();
  }, [router, carId]);

  useEffect(() => {
    if (!router.isReady || !token || !carId || !me || !isAdminRole(me.role)) return;
    loadCompose();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- load once per car/auth
  }, [token, carId, me]);

  useEffect(() => {
    if (!router.isReady) return;
    const flag = router.query.vk_oauth;
    if (!flag) return;
    const detail = router.query.detail;
    if (flag === "ok") {
      setMessage("Токен VK получен через сервер (тот же IP, что у API). Можно публиковать с фото.");
      if (token) loadVkTokenStatus(token).then((tok) => tok && setVkTokenStatus(tok));
    } else if (flag === "error") {
      setError(
        typeof detail === "string" && detail
          ? `VK OAuth: ${detail}`
          : "VK OAuth не удался"
      );
    }
    const nextQuery = { ...router.query };
    delete nextQuery.vk_oauth;
    delete nextQuery.detail;
    router.replace({ pathname: router.pathname, query: nextQuery }, undefined, { shallow: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- one-shot query flag
  }, [router.isReady, router.query.vk_oauth]);

  const photosSorted = useMemo(
    () => (data?.photos ? [...data.photos].sort((a, b) => a.sort_order - b.sort_order || a.id - b.id) : []),
    [data]
  );

  function togglePhoto(id) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else if (next.size < MAX_PHOTOS) next.add(id);
      else setMessage(`Не более ${MAX_PHOTOS} фото в одном посте`);
      return next;
    });
  }

  async function runAiDraft() {
    setError("");
    setMessage("");
    if (!token || !carId) return;
    setAiBusy(true);
    try {
      const res = await fetch(`${API_URL}/admin/cars/${encodeURIComponent(carId)}/telegram/ai-draft`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          style_hint: styleHint.trim() || null,
          selected_photo_ids: [...selected],
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok || !body.ok) {
        setError(body.detail || "Не удалось сгенерировать текст");
        return;
      }
      setPostText(body.text || "");
      setMessage("Текст сгенерирован — при необходимости отредактируйте перед публикацией.");
    } catch {
      setError("Сбой сети или таймаут");
    } finally {
      setAiBusy(false);
    }
  }

  async function startVkOauth() {
    setError("");
    setMessage("");
    if (!token) return;
    setOauthBusy(true);
    try {
      const res = await fetch(`${API_URL}/admin/integrations/vk/oauth/start`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          return_to: carId ? `/staff/publish-social/${carId}` : "/staff/publish-social",
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(body.detail || "Не удалось начать VK OAuth");
        return;
      }
      if (!body.authorize_url) {
        setError("Сервер не вернул authorize_url");
        return;
      }
      window.location.href = body.authorize_url;
    } catch {
      setError("Сбой сети при старте VK OAuth");
    } finally {
      setOauthBusy(false);
    }
  }

  async function saveVkToken() {
    setError("");
    setMessage("");
    if (!token) return;
    setTokenBusy(true);
    try {
      const res = await fetch(`${API_URL}/admin/integrations/vk/user-token`, {
        method: "PUT",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ token: vkTokenInput.trim(), expires_in: 86400 }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(body.detail || "Не удалось сохранить токен VK");
        return;
      }
      setVkTokenStatus(body.status || null);
      setVkTokenInput("");
      setMessage("Токен VK для фото сохранён в админке (~24 ч).");
    } catch {
      setError("Сбой сети при сохранении токена");
    } finally {
      setTokenBusy(false);
    }
  }

  async function publish() {
    setError("");
    setMessage("");
    const text = postText.trim();
    if (!text) {
      setError("Введите текст поста");
      return;
    }
    if (!channelTg && !channelVk && !channelMax) {
      setError("Выберите хотя бы один канал");
      return;
    }
    if (!token || !carId) return;
    setPublishBusy(true);
    const photo_ids = photosSorted.filter((p) => selected.has(p.id)).map((p) => p.id);
    const parts = [];
    try {
      if (channelTg) {
        const res = await fetch(`${API_URL}/admin/cars/${encodeURIComponent(carId)}/telegram/publish`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ text, photo_ids }),
        });
        const body = await res.json().catch(() => ({}));
        if (!res.ok || !body.ok) {
          parts.push(`Telegram: ${body.detail || "ошибка"}`);
        } else {
          parts.push("Telegram: ок");
        }
      }
      if (channelVk) {
        const res = await fetch(`${API_URL}/admin/cars/${encodeURIComponent(carId)}/vk/publish`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ text, photo_ids, attach_listing_link: true }),
        });
        const body = await res.json().catch(() => ({}));
        if (!res.ok || !body.ok) {
          parts.push(`VK: ${body.detail || "ошибка"}`);
        } else {
          parts.push(body.vk_url ? `VK: ок (${body.vk_url})` : "VK: ок");
        }
      }
      if (channelMax) {
        const res = await fetch(`${API_URL}/admin/cars/${encodeURIComponent(carId)}/max/publish`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ text, photo_ids, attach_listing_link: true }),
        });
        const body = await res.json().catch(() => ({}));
        if (!res.ok || !body.ok) {
          parts.push(`MAX: ${body.detail || "ошибка"}`);
        } else {
          parts.push(body.max_url ? `MAX: ок (${body.max_url})` : "MAX: ок");
        }
      }
      const failed = parts.some((p) => !p.includes(": ок"));
      if (failed) setError(parts.join(" · "));
      else setMessage(parts.join(" · "));
      if (channelVk) {
        const tok = await loadVkTokenStatus(token);
        if (tok) setVkTokenStatus(tok);
      }
      if (channelMax) {
        const maxRes = await fetch(`${API_URL}/admin/cars/${encodeURIComponent(carId)}/max-compose`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (maxRes.ok) setMaxMeta(await maxRes.json());
      }
    } catch {
      setError("Сбой сети или таймаут");
    } finally {
      setPublishBusy(false);
    }
  }

  if (!router.isReady || !carId) {
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

  const vkTokenHint = vkTokenStatus
    ? vkTokenStatus.configured
      ? `Токен фото: ${vkTokenStatus.preview}${
          vkTokenStatus.expires_at
            ? ` · до ${new Date(vkTokenStatus.expires_at).toLocaleString("ru-RU")}`
            : ""
        }${vkTokenStatus.expired ? " · истёк" : ""}${
          vkTokenStatus.source ? ` · ${vkTokenStatus.source}` : ""
        }`
      : "Токен фото не задан — пост в VK уйдёт без карусели (только текст)."
    : "";

  return (
    <div className="layout">
      <SiteHeader authBarStyle={{ display: "flex", gap: 12, alignItems: "center" }}>
        <HeaderProfileLink token={token} userRole={me?.role} variant="ghost" />
        <button type="button" className="btn btn-ghost btn-sm" onClick={logout}>
          Выйти
        </button>
      </SiteHeader>

      <main className="site-main">
        <div className="container" style={{ maxWidth: 840 }}>
          <p style={{ marginBottom: "0.5rem" }}>
            <Link href="/">&larr; На главную</Link>
          </p>
          <h1 className="section-title">Пост в соцсети</h1>
          <p className="muted" style={{ marginTop: "-0.5rem", marginBottom: "1.25rem" }}>
            Один текст и фото → Telegram, VK и/или MAX. Генерация текста — как для Telegram (n8n).
          </p>

          {!me ? (
            <p className="muted">Проверка доступа…</p>
          ) : loadError ? (
            <div className="alert alert--danger">{loadError}</div>
          ) : !data ? (
            <p className="muted">Загрузка объявления…</p>
          ) : (
            <>
              <div className="panel" style={{ marginBottom: "1rem" }}>
                <h2 className="panel-heading-sm">Объявление</h2>
                <p style={{ margin: "0.25rem 0", fontWeight: 600 }}>{data.title}</p>
                <p className="muted" style={{ margin: "0 0 0.5rem", fontSize: "0.9rem" }}>
                  {data.brand} {data.model}
                  {data.generation ? ` · ${data.generation}` : ""} · {data.year}
                  {data.mileage_km != null
                    ? ` · ${Number(data.mileage_km).toLocaleString("ru-RU")} км`
                    : ""}
                  {data.location_city ? ` · ${data.location_city}` : ""}
                </p>
                <p style={{ margin: "0.5rem 0 0" }}>
                  <a href={data.canonical_web_url} target="_blank" rel="noopener noreferrer">
                    Карточка на сайте
                  </a>
                </p>
              </div>

              <div className="panel" style={{ marginBottom: "1rem" }}>
                <h2 className="panel-heading-sm">Каналы</h2>
                <label style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 8 }}>
                  <input type="checkbox" checked={channelTg} onChange={(e) => setChannelTg(e.target.checked)} />
                  Telegram-канал
                </label>
                <label style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 8 }}>
                  <input type="checkbox" checked={channelVk} onChange={(e) => setChannelVk(e.target.checked)} />
                  VK-группа
                  {vkMeta?.vk_configured === false ? (
                    <span className="muted" style={{ fontSize: "0.85rem" }}>
                      (VK_GROUP_* не настроен на сервере)
                    </span>
                  ) : null}
                </label>
                <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
                  <input type="checkbox" checked={channelMax} onChange={(e) => setChannelMax(e.target.checked)} />
                  MAX-канал
                  {maxMeta?.max_configured === false ? (
                    <span className="muted" style={{ fontSize: "0.85rem" }}>
                      (MAX_BOT_TOKEN / MAX_CHANNEL_CHAT_ID не настроены)
                    </span>
                  ) : null}
                </label>
                {vkMeta?.publication?.vk_url ? (
                  <p className="muted" style={{ marginTop: 8, fontSize: "0.85rem" }}>
                    Уже в VK:{" "}
                    <a href={vkMeta.publication.vk_url} target="_blank" rel="noopener noreferrer">
                      {vkMeta.publication.vk_url}
                    </a>
                  </p>
                ) : null}
                {maxMeta?.publication?.max_url ? (
                  <p className="muted" style={{ marginTop: 8, fontSize: "0.85rem" }}>
                    Уже в MAX:{" "}
                    <a href={maxMeta.publication.max_url} target="_blank" rel="noopener noreferrer">
                      {maxMeta.publication.max_url}
                    </a>
                  </p>
                ) : null}
              </div>

              <div className="panel" style={{ marginBottom: "1rem" }}>
                <h2 className="panel-heading-sm">Токен VK для фотокарусели</h2>
                <p className="muted" style={{ fontSize: "0.85rem", marginTop: 0 }}>
                  {vkTokenHint || "Статус токена…"} Implicit-токен из браузера привязан к IP устройства —
                  API ходит с IP сервера и получает ошибку. Нужен OAuth через сервер.
                </p>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 12 }}>
                  <button
                    type="button"
                    className="btn btn-secondary"
                    disabled={oauthBusy}
                    onClick={startVkOauth}
                  >
                    {oauthBusy ? "Открываю VK…" : "Подключить через сервер"}
                  </button>
                </div>
                {vkTokenStatus?.oauth_redirect_uri ? (
                  <p className="muted" style={{ fontSize: "0.8rem", marginTop: 0 }}>
                    В настройках приложения VK: Authorized redirect URI ={" "}
                    <code style={{ wordBreak: "break-all" }}>{vkTokenStatus.oauth_redirect_uri}</code>
                    {" · "}нужен <code>VK_OAUTH_CLIENT_SECRET</code> в .env сервера
                    {vkTokenStatus.oauth_mode ? ` · mode=${vkTokenStatus.oauth_mode}` : ""}
                  </p>
                ) : null}
                <details style={{ marginTop: 8 }}>
                  <summary className="muted" style={{ cursor: "pointer", fontSize: "0.85rem" }}>
                    Вручную (не рекомендуется — IP браузера)
                  </summary>
                  <p style={{ margin: "0.5rem 0" }}>
                    {vkTokenStatus?.oauth_url ? (
                      <a href={vkTokenStatus.oauth_url} target="_blank" rel="noopener noreferrer">
                        Получить Implicit-токен в VK
                      </a>
                    ) : null}
                  </p>
                  <textarea
                    className="input"
                    rows={3}
                    value={vkTokenInput}
                    onChange={(e) => setVkTokenInput(e.target.value)}
                    placeholder="access_token или URL после oauth.vk.com/blank.html#…"
                  />
                  <div style={{ marginTop: 8 }}>
                    <button
                      type="button"
                      className="btn btn-secondary"
                      disabled={tokenBusy || !vkTokenInput.trim()}
                      onClick={saveVkToken}
                    >
                      {tokenBusy ? "Сохранение…" : "Сохранить токен вручную"}
                    </button>
                  </div>
                </details>
              </div>

              <div className="panel" style={{ marginBottom: "1rem" }}>
                <h2 className="panel-heading-sm">Фото в пост (до {MAX_PHOTOS})</h2>
                <p className="muted" style={{ fontSize: "0.85rem", marginTop: 0 }}>
                  Отмечено: {selected.size}
                </p>
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "repeat(auto-fill, minmax(120px, 1fr))",
                    gap: 10,
                  }}
                >
                  {photosSorted.map((p) => (
                    <label
                      key={p.id}
                      style={{
                        cursor: "pointer",
                        border: selected.has(p.id)
                          ? "2px solid var(--color-primary, #1976d2)"
                          : "1px solid var(--color-border, #e2e8f0)",
                        borderRadius: 8,
                        overflow: "hidden",
                        display: "block",
                      }}
                    >
                      <input
                        type="checkbox"
                        checked={selected.has(p.id)}
                        onChange={() => togglePhoto(p.id)}
                        style={{ position: "absolute", opacity: 0, width: 0 }}
                      />
                      <img
                        src={mediaSrc(p.storage_url)}
                        alt=""
                        style={{ width: "100%", aspectRatio: "4/3", objectFit: "cover", display: "block" }}
                      />
                    </label>
                  ))}
                </div>
              </div>

              <div className="panel" style={{ marginBottom: "1rem" }}>
                <h2 className="panel-heading-sm">Пожелания для ИИ (необязательно)</h2>
                <textarea
                  className="input"
                  rows={8}
                  value={styleHint}
                  onChange={(e) => setStyleHint(e.target.value)}
                  placeholder="Пожелания к стилю и содержанию поста"
                />
              </div>

              <div className="panel" style={{ marginBottom: "1rem" }}>
                <h2 className="panel-heading-sm">Текст поста</h2>
                <textarea
                  className="input"
                  rows={12}
                  value={postText}
                  onChange={(e) => setPostText(e.target.value)}
                  placeholder="Текст для публикации…"
                />
                <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 10 }}>
                  <button type="button" className="btn btn-secondary" disabled={aiBusy} onClick={runAiDraft}>
                    {aiBusy ? "Генерация…" : "Сгенерировать текст (ИИ)"}
                  </button>
                  <button type="button" className="btn btn-primary" disabled={publishBusy} onClick={publish}>
                    {publishBusy ? "Публикация…" : "Опубликовать"}
                  </button>
                </div>
              </div>

              <div className="panel" style={{ marginBottom: "2rem" }}>
                <h2 className="panel-heading-sm">Предпросмотр</h2>
                <div
                  style={{
                    whiteSpace: "pre-wrap",
                    wordBreak: "break-word",
                    padding: "0.75rem 1rem",
                    background: "#f8fafc",
                    borderRadius: 8,
                    fontSize: "0.95rem",
                    lineHeight: 1.5,
                  }}
                  dangerouslySetInnerHTML={{
                    __html: previewHtml(postText) || "<span class='muted'>(пусто)</span>",
                  }}
                />
              </div>

              {message ? <div className="alert alert--success">{message}</div> : null}
              {error ? <div className="alert alert--danger">{error}</div> : null}
            </>
          )}
        </div>
      </main>
    </div>
  );
}
