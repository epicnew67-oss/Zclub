/** Resolve navigation targets without allowing browser-normalized off-site URLs. */
export function safeRedirectPath(value: unknown, fallback = "/account", siteOrigin?: string): string {
  if (typeof value !== "string" || !value || /[\\\u0000-\u0020\u007f]/.test(value)) return fallback;
  if (!value.startsWith("/") && !siteOrigin) return fallback;
  try {
    const origin = new URL(siteOrigin ?? "http://localhost:3000").origin;
    const url = new URL(value, origin);
    if (url.origin !== origin || url.username || url.password) return fallback;
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return fallback;
  }
}
