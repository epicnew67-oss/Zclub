import "server-only";
import { createClient } from "@/lib/supabase/server";

// ---------------------------------------------------------------- types

export type AdminRoles = "support" | "finance" | "owner";

export type AdminDashboardStats = {
  sales_30d_tokens: number;
  new_users_7d: number;
  active_sellers: number;
  bookings_by_state: Record<string, number>;
  pending_queues: {
    listings: number;
    applications: number;
    payouts: number;
    disputes: number;
  };
};

export type AdminUserSearchRow = {
  id: string;
  display_name: string | null;
  avatar_url: string | null;
  is_banned: boolean | null;
  soft_deleted_at: string | null;
  created_at: string;
  balance: number;
  roles: string[];
  bookings_count: number;
};

export type AdminLedgerRow = {
  id: string;
  amount: number;
  entry_type: string;
  ref_type: string;
  ref_id: string;
  description: string | null;
  created_at: string;
};

export type AdminBookingRow = {
  id: string;
  buyer_id: string;
  seller_id: string;
  price_tokens: number;
  status: string;
  created_at: string;
  released_at: string | null;
};

export type AdminUserDetail = {
  ok: true;
  profile: {
    id: string;
    display_name: string | null;
    avatar_url: string | null;
    is_banned: boolean | null;
    soft_deleted_at: string | null;
    created_at: string;
  };
  roles: string[];
  balance: number;
  in_escrow: number;
  ledger: AdminLedgerRow[];
  bookings: AdminBookingRow[];
};

export type AdminChatLogBookingRow = {
  booking_id: string;
  listing_title: string;
  buyer_name: string;
  seller_name: string;
  booking_status: string;
  live_ended_at: string;
  last_message_at: string;
};

export type AdminChatLogMessage = {
  id: string;
  sender_id: string;
  body: string;
  created_at: string;
};

export type AdminAuditRow = {
  id: number;
  actor_id: string | null;
  action: string;
  target_type: string | null;
  target_id: string | null;
  details: Record<string, unknown> | null;
  created_at: string;
  actor_name: string | null;
};

export type AdminSettingRow = {
  key: string;
  value: Record<string, unknown>;
  updated_by: string | null;
  updated_at: string;
  is_money: boolean;
};

export type AdminBannerRow = {
  id: string;
  label: string;
  body: string;
  link: string | null;
  starts_at: string;
  ends_at: string;
  is_active: boolean;
  created_at: string;
};

export type AdminAnnouncementRow = {
  id: string;
  title: string;
  body: string;
  is_active: boolean;
  posted_at: string;
};

export type AdminCategoryRow = {
  id: string;
  name: string;
  slug: string;
  icon: string | null;
  sort_order: number;
  is_active: boolean;
  created_at: string;
};

export type AdminSellerRow = {
  seller_id: string;
  user_id: string;
  slug: string;
  display_name: string;
  is_verified: boolean;
  is_active: boolean;
  soft_deleted_at: string | null;
  created_at: string;
  is_banned: boolean | null;
  user_soft_deleted_at: string | null;
};

export type AdminTokenPackRow = {
  id: string;
  label: string;
  price_pkr: number;
  tokens: number;
  is_active: boolean;
  sort_order: number;
  created_at: string;
};

export type AdminTopupRow = {
  id: string;
  user_id: string;
  method: string;
  token_pack_id: string | null;
  amount_pkr: number;
  tokens: number;
  status: string;
  reference_code: string | null;
  sender_number: string | null;
  transaction_id: string | null;
  payment_id: string | null;
  expires_at: string | null;
  created_at: string;
  reviewed_by: string | null;
  reviewed_at: string | null;
  review_note: string | null;
};

export type AdminResult<T> =
  | ({ ok: true } & T)
  | { ok: false; code: string; [k: string]: unknown };

export type AdminCharts = {
  window_days: number;
  new_users: { day: string; count: number }[];
  bookings: { day: string; count: number }[];
  revenue_tokens: { day: string; tokens: number }[];
};

export type AdminReports = {
  funnel: Record<string, number>;
  top_sellers_30d: {
    seller_id: string;
    display_name: string;
    slug: string;
    released_count_30d: number;
    released_tokens_30d: number;
  }[];
  dispute_rate_30d: number;
  bookings_total_30d: number;
};

// ---------------------------------------------------------------- public API

export async function getDashboardStats(): Promise<AdminDashboardStats> {
  const admin = await createClient();
  const { data, error } = await admin.rpc("admin_dashboard_stats");
  if (error) throw error;
  return data as AdminDashboardStats;
}

export async function getDashboardCharts(window: "7d" | "30d" | "90d" = "30d"): Promise<AdminCharts> {
  const admin = await createClient();
  const { data, error } = await admin.rpc("admin_dashboard_charts", { _window: window });
  if (error) throw error;
  return data as AdminCharts;
}

export async function getReportsOverview(): Promise<AdminReports> {
  const admin = await createClient();
  const { data, error } = await admin.rpc("admin_reports_overview");
  if (error) throw error;
  return data as AdminReports;
}

export async function searchUsers(query: string, limit = 25, offset = 0): Promise<AdminUserSearchRow[]> {
  const admin = await createClient();
  const { data, error } = await admin.rpc("admin_user_search", {
    _query: query,
    _limit: limit,
    _offset: offset,
  });
  if (error) throw error;
  return ((data as { rows: AdminUserSearchRow[] }).rows ?? []) as AdminUserSearchRow[];
}

export async function getUserDetail(userId: string): Promise<AdminUserDetail | null> {
  const admin = await createClient();
  const { data, error } = await admin.rpc("admin_user_detail", { _user_id: userId });
  if (error) throw error;
  const d = data as (AdminUserDetail & { ok?: boolean }) | { ok: false; code: string };
  if (!d || (d as { ok?: boolean }).ok === false) return null;
  return d as AdminUserDetail;
}

export async function setUserBan(
  userId: string,
  banned: boolean,
  note: string | null
): Promise<AdminResult<{ user_id: string; banned: boolean }>> {
  const admin = await createClient();
  const { data, error } = await admin.rpc("admin_set_user_ban", {
    _user_id: userId,
    _banned: banned,
    _note: note,
  });
  if (error) throw error;
  return (data ?? { ok: false, code: "rpc_returned_null" }) as AdminResult<{ user_id: string; banned: boolean }>;
}

export async function softDeleteUser(userId: string): Promise<AdminResult<{ user_id: string }>> {
  const admin = await createClient();
  const { data, error } = await admin.rpc("admin_soft_delete_user", { _user_id: userId });
  if (error) throw error;
  return (data ?? { ok: false, code: "rpc_returned_null" }) as AdminResult<{ user_id: string }>;
}

export async function walletAdjust(
  userId: string,
  amount: number,
  reason: string
): Promise<AdminResult<{ user_id: string; amount: number; balance: number; reason: string }>> {
  const admin = await createClient();
  const { data, error } = await admin.rpc("admin_wallet_adjust", {
    _user_id: userId,
    _amount: amount,
    _reason: reason,
  });
  if (error) throw error;
  return (data ?? { ok: false, code: "rpc_returned_null" }) as AdminResult<{
    user_id: string;
    amount: number;
    balance: number;
    reason: string;
  }>;
}

export async function setSellerVerified(
  sellerUserId: string,
  verified: boolean
): Promise<AdminResult<{ verified: boolean }>> {
  const admin = await createClient();
  const { data, error } = await admin.rpc("admin_seller_set_verified", {
    _seller_user_id: sellerUserId,
    _verified: verified,
  });
  if (error) throw error;
  return (data ?? { ok: false, code: "rpc_returned_null" }) as AdminResult<{ verified: boolean }>;
}

export async function setSellerActive(
  sellerUserId: string,
  active: boolean,
  refundStrategy: "finish" | "refund_in_progress"
): Promise<AdminResult<{ active: boolean; in_flight_kept: number }>> {
  const admin = await createClient();
  const { data, error } = await admin.rpc("admin_seller_set_active", {
    _seller_user_id: sellerUserId,
    _active: active,
    _refund_strategy: refundStrategy,
  });
  if (error) throw error;
  return (data ?? { ok: false, code: "rpc_returned_null" }) as AdminResult<{
    active: boolean;
    in_flight_kept: number;
  }>;
}

export async function softDeleteSeller(
  sellerUserId: string
): Promise<AdminResult<Record<string, never>>> {
  const admin = await createClient();
  const { data, error } = await admin.rpc("admin_soft_delete_seller", {
    _seller_user_id: sellerUserId,
  });
  if (error) throw error;
  return (data ?? { ok: false, code: "rpc_returned_null" }) as AdminResult<Record<string, never>>;
}

export async function listSellers(): Promise<AdminSellerRow[]> {
  const admin = await createClient();
  const { data, error } = await admin.rpc("admin_sellers_list");
  if (error) throw error;
  return ((data as { rows: AdminSellerRow[] }).rows ?? []) as AdminSellerRow[];
}

export async function listChatLogBookings(): Promise<{
  rows: AdminChatLogBookingRow[];
  retention_days: number;
}> {
  const admin = await createClient();
  const { data, error } = await admin.rpc("admin_list_chat_log_bookings");
  if (error) throw error;
  return data as { rows: AdminChatLogBookingRow[]; retention_days: number };
}

export async function getChatLog(
  bookingId: string,
  reason: string
): Promise<AdminResult<{ booking_id: string; status: string; messages: AdminChatLogMessage[] }>> {
  const admin = await createClient();
  const { data, error } = await admin.rpc("admin_get_chat_log", {
    _booking_id: bookingId,
    _reason: reason,
  });
  if (error) throw error;
  return (data ?? { ok: false, code: "rpc_returned_null" }) as AdminResult<{
    booking_id: string;
    status: string;
    messages: AdminChatLogMessage[];
  }>;
}

export async function listAuditLog(filters?: {
  action?: string;
  targetType?: string;
  limit?: number;
  offset?: number;
}): Promise<AdminAuditRow[]> {
  const admin = await createClient();
  const { data, error } = await admin.rpc("admin_list_audit_log", {
    _action_filter: filters?.action ?? null,
    _target_type: filters?.targetType ?? null,
    _limit: filters?.limit ?? 100,
    _offset: filters?.offset ?? 0,
  });
  if (error) throw error;
  return ((data as { rows: AdminAuditRow[] }).rows ?? []) as AdminAuditRow[];
}

export async function getAllSettings(): Promise<AdminSettingRow[]> {
  const admin = await createClient();
  const { data, error } = await admin.rpc("admin_settings_get_all");
  if (error) throw error;
  return ((data as { rows: AdminSettingRow[] }).rows ?? []) as AdminSettingRow[];
}

export async function updateSetting(
  key: string,
  value: Record<string, unknown>
): Promise<AdminResult<{ key: string; value: Record<string, unknown>; is_money: boolean }>> {
  const admin = await createClient();
  const { data, error } = await admin.rpc("admin_settings_update", {
    _key: key,
    _value: value,
  });
  if (error) throw error;
  return (data ?? { ok: false, code: "rpc_returned_null" }) as AdminResult<{
    key: string;
    value: Record<string, unknown>;
    is_money: boolean;
  }>;
}

export async function listBanners(): Promise<AdminBannerRow[]> {
  const admin = await createClient();
  const { data, error } = await admin.rpc("admin_banners_list");
  if (error) throw error;
  return ((data as { rows: AdminBannerRow[] }).rows ?? []) as AdminBannerRow[];
}

export async function createBanner(input: {
  label: string;
  body: string;
  link: string | null;
  starts_at: string;
  ends_at: string;
}): Promise<AdminResult<{ id: string }>> {
  const admin = await createClient();
  const { data, error } = await admin.rpc("admin_banner_create", {
    _label: input.label,
    _body: input.body,
    _link: input.link,
    _starts_at: input.starts_at,
    _ends_at: input.ends_at,
  });
  if (error) throw error;
  return (data ?? { ok: false, code: "rpc_returned_null" }) as AdminResult<{ id: string }>;
}

export async function updateBanner(
  id: string,
  patch: Partial<{ label: string; body: string; link: string | null; starts_at: string; ends_at: string; is_active: boolean }>
): Promise<AdminResult<Record<string, never>>> {
  const admin = await createClient();
  const { data, error } = await admin.rpc("admin_banner_update", {
    _id: id,
    _label: patch.label ?? null,
    _body: patch.body ?? null,
    _link: patch.link ?? null,
    _starts_at: patch.starts_at ?? null,
    _ends_at: patch.ends_at ?? null,
    _is_active: patch.is_active ?? null,
  });
  if (error) throw error;
  return (data ?? { ok: false, code: "rpc_returned_null" }) as AdminResult<Record<string, never>>;
}

export async function deleteBanner(id: string): Promise<AdminResult<Record<string, never>>> {
  const admin = await createClient();
  const { data, error } = await admin.rpc("admin_banner_delete", { _id: id });
  if (error) throw error;
  return (data ?? { ok: false, code: "rpc_returned_null" }) as AdminResult<Record<string, never>>;
}

export async function listAnnouncements(): Promise<AdminAnnouncementRow[]> {
  const admin = await createClient();
  const { data, error } = await admin.rpc("admin_announcements_list");
  if (error) throw error;
  return ((data as { rows: AdminAnnouncementRow[] }).rows ?? []) as AdminAnnouncementRow[];
}

export async function createAnnouncement(input: {
  title: string;
  body: string;
  is_active: boolean;
}): Promise<AdminResult<{ id: string }>> {
  const admin = await createClient();
  const { data, error } = await admin.rpc("admin_announcement_create", {
    _title: input.title,
    _body: input.body,
    _is_active: input.is_active,
  });
  if (error) throw error;
  return (data ?? { ok: false, code: "rpc_returned_null" }) as AdminResult<{ id: string }>;
}

export async function updateAnnouncement(
  id: string,
  patch: Partial<{ title: string; body: string; is_active: boolean }>
): Promise<AdminResult<Record<string, never>>> {
  const admin = await createClient();
  const { data, error } = await admin.rpc("admin_announcement_update", {
    _id: id,
    _title: patch.title ?? null,
    _body: patch.body ?? null,
    _is_active: patch.is_active ?? null,
  });
  if (error) throw error;
  return (data ?? { ok: false, code: "rpc_returned_null" }) as AdminResult<Record<string, never>>;
}

export async function deleteAnnouncement(id: string): Promise<AdminResult<Record<string, never>>> {
  const admin = await createClient();
  const { data, error } = await admin.rpc("admin_announcement_delete", { _id: id });
  if (error) throw error;
  return (data ?? { ok: false, code: "rpc_returned_null" }) as AdminResult<Record<string, never>>;
}

export async function listCategories(): Promise<AdminCategoryRow[]> {
  const admin = await createClient();
  const { data, error } = await admin.rpc("admin_categories_list");
  if (error) throw error;
  return ((data as { rows: AdminCategoryRow[] }).rows ?? []) as AdminCategoryRow[];
}

export async function updateCategory(
  id: string,
  patch: Partial<{ name: string; icon: string; sort_order: number; is_active: boolean }>
): Promise<AdminResult<Record<string, never>>> {
  const admin = await createClient();
  const { data, error } = await admin.rpc("admin_category_update", {
    _id: id,
    _name: patch.name ?? null,
    _icon: patch.icon ?? null,
    _sort_order: patch.sort_order ?? null,
    _is_active: patch.is_active ?? null,
  });
  if (error) throw error;
  return (data ?? { ok: false, code: "rpc_returned_null" }) as AdminResult<Record<string, never>>;
}

export async function listTokenPacks(): Promise<AdminTokenPackRow[]> {
  const admin = await createClient();
  const { data, error } = await admin.rpc("admin_token_packs_list");
  if (error) throw error;
  return ((data as { rows: AdminTokenPackRow[] }).rows ?? []) as AdminTokenPackRow[];
}

export async function setTokenPackActive(id: string, active: boolean): Promise<AdminResult<Record<string, never>>> {
  const admin = await createClient();
  const { data, error } = await admin.rpc("admin_token_pack_set_active", {
    _id: id,
    _active: active,
  });
  if (error) throw error;
  return (data ?? { ok: false, code: "rpc_returned_null" }) as AdminResult<Record<string, never>>;
}

export async function setTokenPackPrice(
  id: string,
  pricePkr: number
): Promise<AdminResult<{ old: number; new: number }>> {
  const admin = await createClient();
  const { data, error } = await admin.rpc("admin_token_pack_set_price", {
    _id: id,
    _price_pkr: pricePkr,
  });
  if (error) throw error;
  return (data ?? { ok: false, code: "rpc_returned_null" }) as AdminResult<{ old: number; new: number }>;
}

export async function getPaymentDetails(): Promise<{
  jazzcash: Record<string, unknown>;
  easypaisa: Record<string, unknown>;
}> {
  const admin = await createClient();
  const { data, error } = await admin.rpc("admin_payment_details_get");
  if (error) throw error;
  return data as { jazzcash: Record<string, unknown>; easypaisa: Record<string, unknown> };
}

export async function updatePaymentDetails(input: {
  provider: "jazzcash" | "easypaisa";
  account_name?: string | null;
  account_number?: string | null;
  instructions?: string | null;
  qr_data_url?: string | null;
}): Promise<AdminResult<{ provider: string; value: Record<string, unknown> }>> {
  const admin = await createClient();
  const { data, error } = await admin.rpc("admin_payment_details_update", {
    _provider: input.provider,
    _account_name: input.account_name ?? null,
    _account_number: input.account_number ?? null,
    _instructions: input.instructions ?? null,
    _qr_data_url: input.qr_data_url ?? null,
  });
  if (error) throw error;
  return (data ?? { ok: false, code: "rpc_returned_null" }) as AdminResult<{
    provider: string;
    value: Record<string, unknown>;
  }>;
}

export async function listTopups(statuses?: string[]): Promise<AdminTopupRow[]> {
  const admin = await createClient();
  const { data, error } = await admin.rpc("admin_topups_list", { _statuses: statuses ?? null });
  if (error) throw error;
  return ((data as { rows: AdminTopupRow[] }).rows ?? []) as AdminTopupRow[];
}