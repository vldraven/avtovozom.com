import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import { mediaSrc } from "../lib/media";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";
const PREVIEW_LIMIT = 3;

function formatDate(iso) {
  try {
    return new Date(iso).toLocaleString("ru-RU", {
      day: "numeric",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

/**
 * Компактный виджет заявок для staff в профиле → полная работа на /staff/admin-requests.
 */
export default function AdminRequestsWidget({ token }) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    if (!token) return;
    setError("");
    const res = await fetch(`${API_URL}/admin/calculation-requests`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) {
      setError("Не удалось загрузить заявки");
      setRows([]);
      setLoading(false);
      return;
    }
    setRows(await res.json());
    setLoading(false);
  }, [token]);

  useEffect(() => {
    if (!token) {
      setRows([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    load();
  }, [token, load]);

  const preview = rows.slice(0, PREVIEW_LIMIT);
  const openWithoutOffers = rows.filter((r) => !(r.offers && r.offers.length)).length;

  return (
    <section className="panel">
      <h2 className="section-title panel-heading-sm">Заявки на расчёт</h2>
      <p className="muted section-title--flush-top">
        {loading
          ? "Загрузка…"
          : rows.length === 0
            ? "Заявок пока нет."
            : `Всего ${rows.length}${openWithoutOffers ? ` · без ответов дилеров: ${openWithoutOffers}` : ""}.`}
      </p>
      {error ? <div className="alert alert--danger">{error}</div> : null}
      {!loading && preview.length > 0 ? (
        <ul className="profile-request-list admin-requests-widget__list">
          {preview.map((r) => (
            <li key={r.id} className="profile-request-card" style={{ listStyle: "none" }}>
              <Link
                href={`/staff/admin-requests/${r.id}`}
                className="profile-request-card__header"
                style={{ textDecoration: "none", color: "inherit" }}
              >
                {r.car_thumb_url ? (
                  <img
                    className="profile-request-card__thumb-img"
                    src={mediaSrc(r.car_thumb_url)}
                    alt=""
                    width={72}
                    height={54}
                  />
                ) : (
                  <div className="profile-request-card__thumb-ph" aria-hidden />
                )}
                <div className="profile-request-card__body">
                  <div className="profile-request-card__title-line">
                    <span className="profile-request-card__title-text">
                      #{r.id} · {r.car_brand} {r.car_model}
                      {r.car_year != null ? ` · ${r.car_year}` : ""}
                    </span>
                  </div>
                  <div className="muted profile-request-card__meta-loose">
                    {formatDate(r.created_at)}
                    {(r.offers?.length ?? 0) > 0 ? ` · ответов: ${r.offers.length}` : " · без ответов"}
                  </div>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      ) : null}
      <div className="admin-requests-widget__actions">
        <Link href="/staff/admin-requests" className="btn btn-primary btn-inline">
          Открыть все заявки
        </Link>
      </div>
    </section>
  );
}
