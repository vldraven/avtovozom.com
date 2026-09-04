import { useEffect, useState } from "react";

import { ensureMediaImageCached, peekMediaImageCache } from "../lib/mediaImageCache";

/**
 * Обычный <img> для /media/* и media-proxy.
 * next/image не используем: оптимизатор на сервере не достучится до localhost:8000 в Docker.
 *
 * При первом показе — сетевой URL + фоновый прогрев blob-кэша;
 * при remount («назад» в каталог) — сразу blob URL из памяти, без повторной загрузки.
 */
export default function MediaImage({
  src,
  alt = "",
  className,
  fill,
  width,
  height,
  priority,
  loading,
  style,
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
    ensureMediaImageCached(src);
    return undefined;
  }, [src]);

  if (!src) return null;

  const resolvedLoading = priority || fromCache ? "eager" : loading || "lazy";

  if (fill) {
    return (
      <img
        src={displaySrc || src}
        alt={alt}
        className={className}
        loading={resolvedLoading}
        decoding={fromCache ? "sync" : "async"}
        draggable={false}
        style={{ width: "100%", height: "100%", objectFit: "cover", ...style }}
        {...rest}
      />
    );
  }

  return (
    <img
      src={displaySrc || src}
      alt={alt}
      className={className}
      width={width}
      height={height}
      loading={resolvedLoading}
      decoding={fromCache ? "sync" : "async"}
      draggable={false}
      style={style}
      {...rest}
    />
  );
}
