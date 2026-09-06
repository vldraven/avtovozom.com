import { useEffect, useState } from "react";

import { ensureMediaImageCached, peekMediaImageCache } from "../lib/mediaImageCache";

/**
 * Обычный <img> для /media/* и media-proxy.
 * next/image не используем: оптимизатор на сервере не достучится до localhost:8000 в Docker.
 *
 * Первый показ — сетевой URL (и srcSet), без параллельного fetch.
 * Blob-кэш прогревается после onLoad (обычно из HTTP-кэша) — «назад» в каталог без мигания.
 */
export default function MediaImage({
  src,
  srcSet,
  sizes,
  alt = "",
  className,
  fill,
  width,
  height,
  priority,
  loading,
  fetchPriority,
  style,
  onLoad,
  ...rest
}) {
  const initialCached = typeof window !== "undefined" ? peekMediaImageCache(src) : null;
  const [displaySrc, setDisplaySrc] = useState(initialCached || src);
  const [fromCache, setFromCache] = useState(Boolean(initialCached));

  useEffect(() => {
    if (!src) {
      setDisplaySrc("");
      setFromCache(false);
      return undefined;
    }
    const hit = peekMediaImageCache(src);
    if (hit) {
      setDisplaySrc(hit);
      setFromCache(true);
      return undefined;
    }
    setDisplaySrc(src);
    setFromCache(false);
    return undefined;
  }, [src]);

  if (!src) return null;

  const resolvedLoading = priority || fromCache ? "eager" : loading || "lazy";
  const resolvedFetchPriority =
    fetchPriority || (priority ? "high" : undefined);
  // Blob URL не совместим с srcSet — отдаём только src из кэша.
  const resolvedSrcSet = fromCache ? undefined : srcSet;
  const resolvedSizes = resolvedSrcSet ? sizes : undefined;

  function handleLoad(e) {
    if (!fromCache && src) {
      // После отрисовки — прогрев памяти из HTTP-кэша, без конкуренции с первым paint.
      const schedule =
        typeof requestIdleCallback === "function"
          ? (cb) => requestIdleCallback(cb, { timeout: 2500 })
          : (cb) => setTimeout(cb, 0);
      schedule(() => {
        ensureMediaImageCached(src);
      });
    }
    onLoad?.(e);
  }

  const common = {
    alt,
    className,
    loading: resolvedLoading,
    decoding: fromCache ? "sync" : "async",
    draggable: false,
    onLoad: handleLoad,
    ...(resolvedFetchPriority ? { fetchPriority: resolvedFetchPriority } : {}),
    ...(resolvedSrcSet ? { srcSet: resolvedSrcSet, sizes: resolvedSizes } : {}),
    ...rest,
  };

  if (fill) {
    return (
      <img
        src={displaySrc || src}
        {...common}
        style={{ width: "100%", height: "100%", objectFit: "cover", ...style }}
      />
    );
  }

  return (
    <img
      src={displaySrc || src}
      width={width}
      height={height}
      {...common}
      style={style}
    />
  );
}
