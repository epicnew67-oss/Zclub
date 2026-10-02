/**
 * Seller application helpers — server-side wrappers around the submit /
 * approve / reject RPCs. Status + attachment reads use the admin client
 * (RLS admin policies are not yet broad enough for all states).
 *
 * Avatar object paths stored in `seller_applications.avatar_url` are
 * signed here before being returned, because the `seller-avatars`
 * storage bucket is private.
 */

import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { isSafeImagePath } from "@/lib/safe-image-path";

export const SELLER_AVATAR_BUCKET = "seller-avatars";
const SIGNED_URL_TTL_SECONDS = 600;

export type SellerApplicationStatus = "pending" | "approved" | "rejected";

async function signAvatarPath(
  admin: ReturnType<typeof createAdminClient>,
  path: string | null
): Promise<string | null> {
  if (!isSafeImagePath(path)) return null;
  const { data, error } = await admin.storage
    .from(SELLER_AVATAR_BUCKET)
    .createSignedUrl(path, SIGNED_URL_TTL_SECONDS);
  if (error || !data?.signedUrl) return null;
  return data.signedUrl;
}

export async function getSellerStatus(userId: string): Promise<{
  isSeller: boolean;
  slug: string | null;
  applications: Array<{
    id: string;
    display_name: string | null;
    gender: string | null;
    offering: string | null;
    avatar_url: string | null;
    status: SellerApplicationStatus;
    review_note: string | null;
    attempt_number: number;
    terms_version: string | null;
    created_at: string;
    reviewed_at: string | null;
  }>;
}> {
  const admin = createAdminClient();
  const [
    { data: profile },
    { data: role },
    { data: apps },
  ] = await Promise.all([
    admin.from("seller_profiles").select("slug").eq("user_id", userId).maybeSingle(),
    admin.from("user_roles").select("id").eq("user_id", userId).eq("role", "seller").maybeSingle(),
    admin
      .from("seller_applications")
      .select(
        "id, display_name, gender, offering, avatar_url, status, review_note, attempt_number, terms_version, created_at, reviewed_at"
      )
      .eq("user_id", userId)
      .order("created_at", { ascending: false }),
  ]);

  const rows = (apps ?? []) as Array<{
    id: string;
    display_name: string | null;
    gender: string | null;
    offering: string | null;
    avatar_url: string | null;
    status: SellerApplicationStatus;
    review_note: string | null;
    attempt_number: number;
    terms_version: string | null;
    created_at: string;
    reviewed_at: string | null;
  }>;

  const applications = await Promise.all(
    rows.map(async (row) => ({
      ...row,
      avatar_url: await signAvatarPath(admin, row.avatar_url),
    }))
  );

  return {
    isSeller: Boolean(profile || role),
    slug: profile?.slug ?? null,
    applications,
  };
}

export async function getSellerTermsVersion(): Promise<string> {
  const admin = createAdminClient();
  const { data } = await admin.from("settings").select("value").eq("key", "seller_terms_version").maybeSingle();
  const value = (data?.value ?? {}) as { version?: string };
  return value.version ?? "v1";
}

export type AdminApplicationRow = {
  id: string;
  user_id: string;
  display_name: string | null;
  gender: string | null;
  offering: string | null;
  avatar_url: string | null;
  terms_version: string | null;
  terms_ip: string | null;
  attempt_number: number;
  status: SellerApplicationStatus;
  created_at: string;
  review_note: string | null;
  user_email: string;
  user_registered_at: string;
};

export async function listAdminApplications(
  status: "pending" | "all"
): Promise<AdminApplicationRow[]> {
  const admin = createAdminClient();
  let query = admin
    .from("seller_applications")
    .select(
      "id, user_id, display_name, gender, offering, avatar_url, terms_version, terms_ip, attempt_number, status, created_at, review_note"
    )
    .order("created_at", { ascending: true });
  if (status === "pending") query = query.eq("status", "pending");
  const { data, error } = await query;
  if (error) throw error;

  const rows = (data ?? []) as Array<
    Omit<AdminApplicationRow, "user_email" | "user_registered_at">
  >;

  if (rows.length === 0) return [];

  // Sign avatar paths server-side so the admin queue can render them.
  const signed = await Promise.all(
    rows.map(async (r) => ({
      ...r,
      avatar_url: await signAvatarPath(admin, r.avatar_url ?? null),
    }))
  );

  // Attach auth emails (service-role can read auth.users).
  const userIds = [...new Set(signed.map((r) => r.user_id))];
  const emailByUser = new Map<string, { email: string; created_at: string }>();
  try {
    const users = await Promise.all(
      userIds.map((id) => admin.auth.admin.getUserById(id))
    );
    for (const { data: u } of users) {
      if (u?.user) emailByUser.set(u.user.id, { email: u.user.email ?? "—", created_at: u.user.created_at });
    }
  } catch {
    // fall back to user_id
  }

  return signed.map((r) => ({
    ...r,
    user_email: emailByUser.get(r.user_id)?.email ?? r.user_id,
    user_registered_at: emailByUser.get(r.user_id)?.created_at ?? "",
  }));
}
