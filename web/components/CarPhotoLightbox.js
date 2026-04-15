import { useCallback, useEffect, useRef, useState } from "react";

import { mediaSrc } from "../lib/media";

/**
 * Полноэкранный просмотр фото (десктоп и мобильный): стрелки, свайп, Escape, клик по фону — закрыть.
 * onClose(lastIndex) — индекс последнего кадра при закрытии.
 */
export default function CarPhotoLightbox({ open, onClose, urls, title, initialIndex = 0 }) {
  const [idx, setIdx] = useState(initialIndex);
  const n = urls?.length ?? 0;
  const safe = n ? Math.min(Math.max(0, idx), n - 1) : 0;

  const touchStartRef = useRef(null);

  useEffect(() => {
    if (open) setIdx(Math.min(Math.max(0, initialIndex), Math.max(0, n - 1)));
  }, [open, initialIndex, n]);

  const closeWithIndex = useCallback(() => {
    onClose?.(safe);
  }, [onClose, safe]);

  useEffect(() => {
    if (!open) return undefined;
    function onKey(e) {
      if (e.key === "Escape") closeWithIndex();
      if (e.key === "ArrowLeft" && n > 1) {
        e.preventDefault();
        setIdx((i) => Math.max(0, i - 1));
      }
      if (e.key === "ArrowRight" && n > 1) {
        e.preventDefault();
        setIdx((i) => Math.min(n - 1, i + 1));
      }
    }
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener("keydown", onKey);
    };
  }, [open, closeWithIndex, n]);

  const goPrev = useCallback(() => {
    setIdx((i) => Math.max(0, i - 1));
  }, []);

  const goNext = useCallback(() => {
    setIdx((i) => Math.min(n - 1, i + 1));
  }, [n]);

  function onTouchStart(e) {
    if (e.touches.length !== 1) return;
    touchStartRef.current = { x: e.touches[0].clientX, y: e.touches[0].clientY };
  }

  function onTouchEnd(e) {
    const start = touchStartRef.current;
    touchStartRef.current = null;
    if (!start || e.changedTouches.length !== 1) return;
    const dx = e.changedTouches[0].clientX - start.x;
    const dy = e.changedTouches[0].clientY - start.y;
    if (n <= 1) return;
    if (Math.abs(dx) < 48 || Math.abs(dx) < Math.abs(dy)) return;
    if (dx > 0) goPrev();
    else goNext();
  }

  if (!open || n === 0) return null;

  const src = urls[safe];

  return (
    <div
      className="car-lightbox"
      role="dialog"
      aria-modal="true"
      aria-label={title ? `Фото: ${title}` : "Просмотр фотографий"}
    >
      <button type="button" className="car-lightbox__backdrop" aria-label="Закрыть" onClick={closeWithIndex} />
      <div className="car-lightbox__inner">
        <button type="button" className="car-lightbox__close" aria-label="Закрыть" onClick={closeWithIndex}>
          ×
        </button>
        {n > 1 ? (
          <>
            <button
              type="button"
              className="car-lightbox__nav car-lightbox__nav--prev"
              aria-label="Предыдущее фото"
              disabled={safe <= 0}
              onClick={(e) => {
                e.stopPropagation();
                goPrev();
              }}
            >
              ‹
            </button>
            <button
              type="button"
              className="car-lightbox__nav car-lightbox__nav--next"
              aria-label="Следующее фото"
              disabled={safe >= n - 1}
              onClick={(e) => {
                e.stopPropagation();
                goNext();
              }}
            >
              ›
            </button>
          </>
        ) : null}
        <div
          className="car-lightbox__stage"
          onTouchStart={onTouchStart}
          onTouchEnd={onTouchEnd}
          onClick={(e) => e.stopPropagation()}
        >
          <img src={mediaSrc(src)} alt="" className="car-lightbox__img" />
        </div>
        {n > 1 ? (
          <div className="car-lightbox__counter">
            {safe + 1} / {n}
          </div>
        ) : null}
      </div>
    </div>
  );
}
