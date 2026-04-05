import { mediaSrc } from "../lib/media";

/**
 * Подтверждение заявки на расчёт для авторизованного пользователя: авто + комментарий.
 */
export default function RequestConfirmModal({
  open,
  onClose,
  onConfirm,
  busy,
  car,
  comment,
  onCommentChange,
}) {
  if (!open || !car) return null;

  const photos = car.photos?.length
    ? [...car.photos].sort((a, b) => a.sort_order - b.sort_order)
    : [];
  const thumb = photos[0]?.storage_url;

  return (
    <div
      className="modal-overlay"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !busy) onClose();
      }}
    >
      <div
        className="modal-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="request-modal-title"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <h2 id="request-modal-title" className="section-title" style={{ fontSize: "1.2rem", marginTop: 0 }}>
          Подтвердите заявку
        </h2>
        <div style={{ display: "flex", gap: 12, marginBottom: 16, alignItems: "flex-start" }}>
          {thumb ? (
            <img
              src={mediaSrc(thumb)}
              alt=""
              width={96}
              height={72}
              style={{ objectFit: "cover", borderRadius: 8, flexShrink: 0 }}
            />
          ) : null}
          <div style={{ minWidth: 0 }}>
            <div style={{ fontWeight: 700 }}>{car.title}</div>
            <div className="muted" style={{ fontSize: "0.95rem" }}>
              {car.brand} {car.model} · {car.year}
            </div>
          </div>
        </div>
        <label className="muted" style={{ display: "grid", gap: 6 }}>
          Комментарий к заявке
          <textarea
            className="input"
            rows={4}
            value={comment}
            onChange={(e) => onCommentChange(e.target.value)}
          />
        </label>
        <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", marginTop: 18, flexWrap: "wrap" }}>
          <button type="button" className="btn btn-ghost" disabled={busy} onClick={onClose}>
            Отмена
          </button>
          <button type="button" className="btn btn-primary" disabled={busy} onClick={onConfirm}>
            {busy ? "Отправка…" : "Отправить заявку"}
          </button>
        </div>
      </div>
    </div>
  );
}
