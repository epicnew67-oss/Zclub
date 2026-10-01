/**
 * Maps Supabase Auth errors to helpful, user-facing messages.
 *
 * The raw "Failed to fetch" / "NetworkError" strings that supabase-js
 * surfaces when the browser cannot reach the auth endpoint (CSP,
 * offline, DNS, local stack down) are replaced with an actionable
 * message. Everything else falls through to Supabase's own wording.
 */
export function friendlyAuthError(message: string | undefined | null): string {
  const raw = (message ?? "").trim();
  if (!raw) return "Something went wrong. Please try again.";

  const lowered = raw.toLowerCase();
  if (
    lowered.includes("failed to fetch") ||
    lowered.includes("networkerror") ||
    lowered.includes("network error") ||
    lowered.includes("fetch failed") ||
    lowered.includes("load failed")
  ) {
    return "Couldn't reach the authentication service. Check your connection and try again.";
  }
  if (lowered.includes("email not confirmed")) {
    return "Email not confirmed yet — open the link we emailed you, then try again.";
  }
  if (lowered.includes("invalid login")) {
    return "Wrong email or password.";
  }
  return raw;
}
