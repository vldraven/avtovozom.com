import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  CARD_SIZES,
  CARD_SRCSET_WIDTHS,
  MEDIA_WIDTH,
  mediaSrc,
  mediaSrcSet,
} from "../lib/media";
import { warmMediaImageSources } from "../lib/mediaImageCache";
import MediaImage from "./MediaImage";

function indexFromRatio(ratio, n) {
  if (n <= 1) return 0;
  const r = Math.max(0, Math.min(1, ratio));
  return Math.min(n - 1, Math.floor(r * n));
}

function preloadImageSources(sources) {
  warmMediaImageSources(sources);
}

/**
 * Фото в карточке каталога: при движении курсора/пальца по горизонтали меняется кадр (как на auto.ru).
 * Клик без жеста ведёт в карточку (родительский Link).
 * Остальные кадры подгружаются только при явном взаимодействии (hover/touch),
 * чтобы не перегружать сеть на длинных списках.
 *
 * Bleed-слой — лёгкий thumb (160px), основной кадр — srcset 320/480/640.
 */
export default function CatalogCardImageScrub({ photos, priority = false }) {
  const urls = useMemo(() => {
    const sorted = [...(photos || [])].sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));
    return sorted.map((p) => p.storage_url).filter(Boolean);
  }, [photos]);

  const allSrcs = useMemo(
    () => urls.map((u) => mediaSrc(u, MEDIA_WIDTH.card)),
    [urls]
  );
  const n = urls.length;
  const wrapRef = useRef(null);
  const allSrcsRef = useRef(allSrcs);
  const warmedRef = useRef(false);
  allSrcsRef.current = allSrcs;

  const [active, setActive] = useState(0);
  const movedRef = useRef(false);
  const pointerDownRef = useRef(false);
  const startRef = useRef({ x: 0, y: 0 });

  useEffect(() => {
    warmedRef.current = false;
  }, [allSrcs]);

  const warmOnHover = useCallback(() => {
    if (n <= 1 || warmedRef.current) return;
    const srcs = allSrcsRef.current;
    // Прогреваем только пару следующих кадров вместо всей галереи.
    preloadImageSources(srcs.slice(1, 3));
    warmedRef.current = true;
  }, [n]);

  const updateFromClientX = useCallback(
    (clientX) => {
      const el = wrapRef.current;
      if (!el || n <= 1) return;
      const rect = el.getBoundingClientRect();
      const ratio = rect.width > 0 ? (clientX - rect.left) / rect.width : 0;
      setActive(indexFromRatio(ratio, n));
    },
    [n]
  );

  function onPointerDown(e) {
    if (n <= 1) return;
    pointerDownRef.current = true;
    movedRef.current = false;
    startRef.current = { x: e.clientX, y: e.clientY };
  }

  function onPointerMove(e) {
    if (n <= 1) return;
    updateFromClientX(e.clientX);
    if (pointerDownRef.current) {
      const dx = Math.abs(e.clientX - startRef.current.x);
      const dy = Math.abs(e.clientY - startRef.current.y);
      if (dx > 10 || dy > 10) movedRef.current = true;
    }
  }

  function onPointerUp() {
    pointerDownRef.current = false;
  }

  function onMouseLeave() {
    pointerDownRef.current = false;
    if (n > 1) setActive(0);
  }

  function onClickCapture(e) {
    if (movedRef.current) {
      e.preventDefault();
      e.stopPropagation();
      movedRef.current = false;
    }
  }

  const show = n > 0 ? urls[Math.min(active, n - 1)] : null;
  const fitSrc = show ? mediaSrc(show, MEDIA_WIDTH.card) : "";
  const fitSrcSet = show ? mediaSrcSet(show, CARD_SRCSET_WIDTHS) : undefined;
  const bleedSrc = show ? mediaSrc(show, MEDIA_WIDTH.thumb) : "";

  return (
    <div
      ref={wrapRef}
      className={`catalog-card__image-wrap${n > 1 ? " catalog-card__image-wrap--scrub" : ""}`}
      onPointerEnter={n > 1 ? warmOnHover : undefined}
      onPointerDown={onPointerDown}
      onTouchStart={n > 1 ? warmOnHover : undefined}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerLeave={onPointerUp}
      onPointerCancel={onPointerUp}
      onMouseLeave={onMouseLeave}
      onClickCapture={onClickCapture}
    >
      {show ? (
        <>
          {/* Лёгкий blur-фон (160px), не дублируем тяжёлый 640px decode. */}
          <MediaImage
            className="catalog-card__image catalog-card__image--bleed"
            src={bleedSrc}
            alt=""
            fill
            loading={priority ? "eager" : "lazy"}
            priority={false}
            draggable={false}
            aria-hidden
            style={{ objectFit: "cover" }}
          />
          <MediaImage
            className="catalog-card__image catalog-card__image--fit"
            src={fitSrc}
            srcSet={fitSrcSet}
            sizes={CARD_SIZES}
            alt=""
            fill
            priority={priority}
            loading={priority ? "eager" : "lazy"}
            draggable={false}
            style={{ objectFit: "contain" }}
          />
        </>
      ) : (
        <div className="catalog-card__placeholder">Нет фото</div>
      )}
      {n > 1 ? (
        <>
          <div className="catalog-card__scrub-segments" aria-hidden>
            {urls.map((_, i) => (
              <span
                key={i}
                className={`catalog-card__scrub-seg${i === active ? " catalog-card__scrub-seg--on" : ""}`}
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  setActive(i);
                }}
              />
            ))}
          </div>
          <span className="catalog-card__scrub-hint" aria-hidden>
            {active + 1}/{n}
          </span>
        </>
      ) : null}
    </div>
  );
}
