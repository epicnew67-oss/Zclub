/** Only sign stored raster images. Older uploads may include active SVG. */
export function isSafeImagePath(path: string | null | undefined): path is string {
  return typeof path === "string" && /^[^?#]+\.(?:jpe?g|png|webp)$/i.test(path);
}
