import Link from "next/link";
import { Fragment, useCallback, useEffect, useMemo, useState } from "react";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

function formatDateTime(iso) {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString("ru-RU", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return String(iso);
  }
}

function formatDurationMs(ms) {
  if (ms == null || Number.isNaN(ms) || ms < 0) return "—";
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s} с`;
  const m = Math.floor(s / 60);
  const rs = s % 60;
  if (m < 60) return `${m} мин ${rs} с`;
  const h = Math.floor(m / 60);
  const rm = m % 60;
  return `${h} ч ${rm} мин`;
}

function jobTypeLabel(type) {
  if (type === "import_one") return "Импорт одного объявления (che168)";
  if (type === "manual") return "Ручной запуск каталога";
  if (type === "daily") return "Авто / плановый обход";
  return type || "—";
}

function statusMeta(status) {
  const s = String(status || "").toLowerCase();
  if (s === "success")
    return { label: "Успех", className: "admin-parser-badge admin-parser-badge--success" };
  if (s === "failed")
    return { label: "Ошибка", className: "admin-parser-badge admin-parser-badge--danger" };
  if (s === "running")
    return { label: "Выполняется", className: "admin-parser-badge admin-parser-badge--running" };
  if (s === "queued")
    return { label: "В очереди", className: "admin-parser-badge admin-parser-badge--queued" };
  return { label: status || "—", className: "admin-parser-badge" };
}

function truncateUrl(u, max = 56) {
  if (!u) return "";
  if (u.length <= max) return u;
  return `${u.slice(0, max - 1)}…`;
}

/**
 * Панель мониторинга парсера che168 для админов/модераторов: запуск, сводка, история джобов.
 */
export default function AdminParserPanel({ token, jobs, onReload }) {
  const [runBusy, setRunBusy] = useState(false);
  const [runMessage, setRunMessage] = useState("");
  const [expandedId, setExpandedId] = useState(null);

  const reload = useCallback(async () => {
    if (onReload) await onReload();
  }, [onReload]);

  const hasActiveJob = useMemo(
    () => jobs.some((j) => j.status === "queued" || j.status === "running"),
    [jobs]
  );

  useEffect(() => {
    if (!hasActiveJob) return undefined;
    const id = setInterval(() => {
      reload();
    }, 5000);
    return () => clearInterval(id);
  }, [hasActiveJob, reload]);

  const latest = jobs[0] ?? null;
  const summary = useMemo(() => {
    const lastFailed = jobs.find((j) => j.status === "failed");
    return { lastFailed };
  }, [jobs]);

  async function runCatalogParser() {
    if (!token) return;
    setRunMessage("");
    setRunBusy(true);
    try {
      const res = await fetch(`${API_URL}/admin/parser/run`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        setRunMessage("Не удалось поставить задачу. Проверьте права и доступность API.");
        return;
      }
      setRunMessage("Задача поставлена в очередь. Статус обновится автоматически.");
      await reload();
    } catch {
      setRunMessage("Сбой сети. Проверьте, что backend доступен.");
    } finally {
      setRunBusy(false);
    }
  }

  return (
    <section className="panel admin-parser-panel-profile">
      <div className="admin-parser-panel-profile__head">
        <div>
          <h2 className="section-title panel-heading-sm admin-parser-panel-profile__title">Парсер каталога (che168)</h2>
          <p className="muted admin-parser-panel-profile__lead">
            Фоновые задачи подтягивают объявления с che168 в каталог сайта. Импорт одной карточки по ссылке доступен на{" "}
            <Link href="/">главной странице</Link> (блок для staff после входа).
          </p>
        </div>
        <div className="admin-parser-panel-profile__actions">
          <button
            type="button"
            className="btn btn-primary btn-sm"
            disabled={runBusy || hasActiveJob}
            onClick={runCatalogParser}
            title={
              hasActiveJob
                ? "Дождитесь завершения текущей задачи"
                : "Поставить в очередь полный обход whitelist-моделей"
            }
          >
            {runBusy ? "Запуск…" : "Обновить каталог сейчас"}
          </button>
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => reload()} disabled={!token}>
            Обновить список
          </button>
        </div>
      </div>

      {runMessage ? <p className="admin-parser-panel-profile__inline-msg">{runMessage}</p> : null}

      {latest ? (
        <div className="admin-parser-summary-strip">
          <div className="admin-parser-summary-strip__item">
            <span className="admin-parser-summary-strip__k">Последняя задача</span>
            <span className="admin-parser-summary-strip__v">
              #{latest.id}{" "}
              <span className={statusMeta(latest.status).className}>{statusMeta(latest.status).label}</span>
            </span>
          </div>
          <div className="admin-parser-summary-strip__item">
            <span className="admin-parser-summary-strip__k">Тип</span>
            <span className="admin-parser-summary-strip__v">{jobTypeLabel(latest.type)}</span>
          </div>
          <div className="admin-parser-summary-strip__item">
            <span className="admin-parser-summary-strip__k">Завершена</span>
            <span className="admin-parser-summary-strip__v">
              {latest.status === "running" || latest.status === "queued"
                ? "— (ещё выполняется)"
                : formatDateTime(latest.finished_at)}
            </span>
          </div>
          {summary.lastFailed && summary.lastFailed.id !== latest.id ? (
            <div className="admin-parser-summary-strip__item admin-parser-summary-strip__item--warn">
              <span className="admin-parser-summary-strip__k">Последняя ошибка</span>
              <span className="admin-parser-summary-strip__v">
                #{summary.lastFailed.id} · {formatDateTime(summary.lastFailed.finished_at)}
              </span>
            </div>
          ) : null}
        </div>
      ) : null}

      {hasActiveJob ? (
        <p className="admin-parser-panel-profile__poll-hint muted">
          Идёт выполнение — список обновляется каждые 5 секунд.
        </p>
      ) : null}

      {jobs.length === 0 ? (
        <p className="muted admin-parser-panel-profile__empty">Записей о запусках парсера пока нет.</p>
      ) : (
        <div className="admin-parser-job-table-wrap">
          <table className="admin-parser-job-table">
            <thead>
              <tr>
                <th>ID</th>
                <th>Статус</th>
                <th>Тип</th>
                <th>Старт</th>
                <th>Финиш</th>
                <th>Длит.</th>
                <th>Обработано</th>
                <th>Созд. / обнов.</th>
                <th>Ошибки</th>
              </tr>
            </thead>
            <tbody>
              {jobs.map((j) => {
                const sm = statusMeta(j.status);
                const start = j.started_at ? new Date(j.started_at).getTime() : null;
                const end = j.finished_at ? new Date(j.finished_at).getTime() : null;
                const dur =
                  start != null && end != null ? formatDurationMs(end - start) : j.status === "running" ? "…" : "—";
                const expanded = expandedId === j.id;
                const hasExtra =
                  (j.message && String(j.message).trim()) ||
                  (j.import_detail_url && String(j.import_detail_url).trim());
                return (
                  <Fragment key={j.id}>
                    <tr className={j.status === "failed" ? "admin-parser-job-table__row--failed" : ""}>
                      <td className="admin-parser-job-table__mono">#{j.id}</td>
                      <td>
                        <span className={sm.className}>{sm.label}</span>
                      </td>
                      <td>{jobTypeLabel(j.type)}</td>
                      <td className="admin-parser-job-table__muted">{formatDateTime(j.started_at)}</td>
                      <td className="admin-parser-job-table__muted">{formatDateTime(j.finished_at)}</td>
                      <td className="admin-parser-job-table__mono">{dur}</td>
                      <td className="admin-parser-job-table__mono">{j.total_processed ?? 0}</td>
                      <td className="admin-parser-job-table__mono">
                        {(j.total_created ?? 0)}/{(j.total_updated ?? 0)}
                      </td>
                      <td className="admin-parser-job-table__mono">
                        {(j.total_errors ?? 0) > 0 ? (
                          <span className="admin-parser-job-table__err-count">{j.total_errors}</span>
                        ) : (
                          "0"
                        )}
                      </td>
                    </tr>
                    {hasExtra ? (
                      <tr className="admin-parser-job-table__detail-row">
                        <td colSpan={9}>
                          <button
                            type="button"
                            className="admin-parser-job-table__toggle-msg"
                            onClick={() => setExpandedId(expanded ? null : j.id)}
                          >
                            {expanded ? "Свернуть детали" : "Подробности / сообщение"}
                          </button>
                          {expanded ? (
                            <div className="admin-parser-job-table__detail-body">
                              {j.import_detail_url ? (
                                <p className="admin-parser-job-table__import-url">
                                  <span className="muted">Источник: </span>
                                  <a href={j.import_detail_url} target="_blank" rel="noopener noreferrer">
                                    {truncateUrl(j.import_detail_url, 72)}
                                  </a>
                                  {j.import_model_id != null ? (
                                    <span className="muted"> · model_id {j.import_model_id}</span>
                                  ) : null}
                                </p>
                              ) : null}
                              {j.message ? (
                                <pre className="admin-parser-job-table__message">{j.message}</pre>
                              ) : null}
                            </div>
                          ) : null}
                        </td>
                      </tr>
                    ) : null}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
