/**
 * Обычный <img> для /media/* и media-proxy.
 * next/image не используем: оптимизатор на сервере не достучится до localhost:8000 в Docker.
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
  if (!src) return null;

  const resolvedLoading = priority ? "eager" : loading || "lazy";

  if (fill) {
    return (
      <img
        src={src}
        alt={alt}
        className={className}
        loading={resolvedLoading}
        decoding="async"
        draggable={false}
        style={{ width: "100%", height: "100%", objectFit: "cover", ...style }}
        {...rest}
      />
    );
  }

  return (
    <img
      src={src}
      alt={alt}
      className={className}
      width={width}
      height={height}
      loading={resolvedLoading}
      decoding="async"
      draggable={false}
      style={style}
      {...rest}
    />
  );
}
