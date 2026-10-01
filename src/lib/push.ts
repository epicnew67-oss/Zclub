/**
 * Web Push (VAPID) helpers.
 *
 * - Persists / removes a user's push subscription in `push_subscriptions`
 *   via the per-request user client (RLS keeps it owner-only).
 * - Fans a payload out to every subscription held by users with a
 *   given role (admin / finance / owner) — used on top-up requests,
 *   dispute openings, and seller applications.
 *
 * VAPID keys live in env (generate via `npx web-push generate-vapid-keys`):
 *   - VAPID_PUBLIC_KEY  → shipped to the client so it can subscribe.
 *   - VAPID_PRIVATE_KEY → used here to sign the push request.
 *   - VAPID_SUBJECT     → mailto: or https: contact, default domain.
 *
 * If VAPID is unconfigured the helpers no-op rather than throwing —
 * the in-app bell still works, only the OS-level push is skipped.
 */

import "server-only";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

export type PushSubscriptionInput = {
  endpoint: string;
  keys: { p256dh: string; auth: string };
  userAgent?: string;
};

export type PushPayload = {
  title: string;
  body: string;
  link?: string;
  tag?: string;
};

export type PushFanoutResult = {
  attempted: number;
  delivered: number;
  removed: number;
  skipped: number;
  errors: Array<{ endpoint: string; code: string }>;
};

let cachedWebpush: typeof import("web-push") | null = null;

async function getWebpush() {
  if (cachedWebpush) return cachedWebpush;
  const pub = process.env.VAPID_PUBLIC_KEY;
  const priv = process.env.VAPID_PRIVATE_KEY;
  if (!pub || !priv) return null;
  const mod = await import("web-push");
  mod.setVapidDetails(
    process.env.VAPID_SUBJECT ?? `mailto:no-reply@${"stripclubonline.com"}`,
    pub,
    priv
  );
  cachedWebpush = mod;
  return mod;
}

export async function getVapidPublicKey(): Promise<string | null> {
  return process.env.VAPID_PUBLIC_KEY ?? null;
}

/** Persist a push subscription for the current user (upsert by endpoint). */
export async function savePushSubscription(input: PushSubscriptionInput): Promise<{ ok: boolean; error?: string }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "not signed in" };

  const { error } = await supabase
    .from("push_subscriptions")
    .upsert(
      {
        user_id: user.id,
        endpoint: input.endpoint,
        p256dh: input.keys.p256dh,
        auth: input.keys.auth,
        user_agent: input.userAgent ?? null,
        last_seen_at: new Date().toISOString(),
      },
      { onConflict: "endpoint" }
    );
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

/** Remove a subscription (e.g. on logout or Notification.permission=default after denial). */
export async function deletePushSubscription(endpoint: string): Promise<{ ok: boolean; error?: string }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "not signed in" };
  const { error } = await supabase.from("push_subscriptions").delete().eq("endpoint", endpoint);
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

/** Returns the count + latest subscriptions for the current user. */
export async function listOwnPushSubscriptions(): Promise<{ count: number }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { count: 0 };
  const { count } = await supabase
    .from("push_subscriptions")
    .select("endpoint", { count: "exact", head: true })
    .eq("user_id", user.id);
  return { count: count ?? 0 };
}

/**
 * Fans `payload` to every subscription held by users with one of
 * `roles`. Uses the service-role client (RLS blocks cross-user reads
 * from the per-request client). Subscriptions whose endpoint returns
 * 404 / 410 are removed from the table so the list stays clean.
 */
export async function fanoutPushToRoles(roles: string[], payload: PushPayload): Promise<PushFanoutResult> {
  const result: PushFanoutResult = { attempted: 0, delivered: 0, removed: 0, skipped: 0, errors: [] };
  const webpush = await getWebpush();
  if (!webpush) {
    result.skipped = 1; // surfaced as "skipped: VAPID not configured" so callers don't silently fail
    return result;
  }
  if (roles.length === 0) return result;

  const admin = createAdminClient();
  const { data: subs, error } = await admin
    .from("push_subscriptions")
    .select("id, endpoint, p256dh, auth")
    .in(
      "user_id",
      // users that hold any of the roles
      (await admin.from("user_roles").select("user_id").in("role", roles)).data?.map((r) => r.user_id) ?? []
    );
  if (error) {
    result.errors.push({ endpoint: "(lookup)", code: error.message });
    return result;
  }
  if (!subs || subs.length === 0) return result;

  const body = JSON.stringify(payload);
  const ttl = 60;
  const promises = subs.map(async (sub) => {
    result.attempted += 1;
    try {
      await webpush.sendNotification(
        { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
        body,
        { TTL: ttl }
      );
      result.delivered += 1;
    } catch (err) {
      const code = (err as { statusCode?: number; message?: string }).statusCode;
      // 404 / 410 — subscription is dead, drop it.
      if (code === 404 || code === 410) {
        await admin.from("push_subscriptions").delete().eq("id", sub.id);
        result.removed += 1;
      } else {
        result.errors.push({ endpoint: sub.endpoint, code: String(code ?? err) });
      }
    }
  });
  await Promise.all(promises);
  return result;
}
