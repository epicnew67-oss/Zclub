"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import {
  createAnnouncement,
  createBanner,
  deleteAnnouncement,
  deleteBanner,
  listAuditLog,
  updateAnnouncement,
  updateBanner,
  updateCategory,
  updatePaymentDetails,
  updateSetting,
  setTokenPackActive,
  setTokenPackPrice,
} from "@/lib/admin";

async function getActor(next: string) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect(`/auth/sign-in?next=${encodeURIComponent(next)}`);
  return user;
}

// Generic catch-all admin RPC caller (we re-validate after each).
export async function callAdminAction<T>(action: () => Promise<T>): Promise<T> {
  await getActor("/admin/settings");
  const res = await action();
  revalidatePath("/admin/settings");
  return res;
}

// --- Settings ---
export async function setSettingAction(key: string, value: Record<string, unknown>) {
  await getActor("/admin/settings");
  const r = await updateSetting(key, value);
  if (r.ok) revalidatePath("/admin/settings");
  return r;
}

// --- Categories ---
export async function updateCategoryNameAction(id: string, name: string) {
  await getActor("/admin/settings");
  const r = await updateCategory(id, { name });
  if (r.ok) revalidatePath("/admin/settings");
  return r;
}

export async function setCategoryActiveAction(id: string, isActive: boolean) {
  await getActor("/admin/settings");
  const r = await updateCategory(id, { is_active: isActive });
  if (r.ok) revalidatePath("/admin/settings");
  return r;
}

// --- Banners ---
export async function createBannerAction(input: {
  label: string;
  body: string;
  link: string | null;
  starts_at: string;
  ends_at: string;
}) {
  await getActor("/admin/settings");
  const r = await createBanner(input);
  if (r.ok) revalidatePath("/admin/settings");
  return r;
}

export async function updateBannerAction(
  id: string,
  patch: Partial<{ label: string; body: string; link: string | null; is_active: boolean }>
) {
  await getActor("/admin/settings");
  const r = await updateBanner(id, patch);
  if (r.ok) revalidatePath("/admin/settings");
  return r;
}

export async function toggleBannerAction(id: string, isActive: boolean) {
  await getActor("/admin/settings");
  const r = await updateBanner(id, { is_active: isActive });
  if (r.ok) revalidatePath("/admin/settings");
  return r;
}

export async function deleteBannerAction(id: string) {
  await getActor("/admin/settings");
  const r = await deleteBanner(id);
  if (r.ok) revalidatePath("/admin/settings");
  return r;
}

// --- Announcements ---
export async function createAnnouncementAction(input: {
  title: string;
  body: string;
  is_active: boolean;
}) {
  await getActor("/admin/settings");
  const r = await createAnnouncement(input);
  if (r.ok) revalidatePath("/admin/settings");
  return r;
}

export async function updateAnnouncementAction(
  id: string,
  patch: Partial<{ title: string; body: string; is_active: boolean }>
) {
  await getActor("/admin/settings");
  const r = await updateAnnouncement(id, patch);
  if (r.ok) revalidatePath("/admin/settings");
  return r;
}

export async function toggleAnnouncementAction(id: string, isActive: boolean) {
  await getActor("/admin/settings");
  const r = await updateAnnouncement(id, { is_active: isActive });
  if (r.ok) revalidatePath("/admin/settings");
  return r;
}

export async function deleteAnnouncementAction(id: string) {
  await getActor("/admin/settings");
  const r = await deleteAnnouncement(id);
  if (r.ok) revalidatePath("/admin/settings");
  return r;
}

// --- Token packs ---
export async function setTokenPackActiveAction(id: string, active: boolean) {
  await getActor("/admin/settings");
  const r = await setTokenPackActive(id, active);
  if (r.ok) revalidatePath("/admin/settings");
  return r;
}

export async function setTokenPackPriceAction(id: string, pricePkr: number) {
  await getActor("/admin/settings");
  const r = await setTokenPackPrice(id, pricePkr);
  if (r.ok) revalidatePath("/admin/settings");
  return r;
}

// --- Payment details ---
export async function updatePaymentDetailsAction(input: {
  provider: "jazzcash" | "easypaisa";
  account_name: string;
  account_number: string;
  instructions: string;
  qr_data_url: string;
}) {
  await getActor("/admin/settings");
  const r = await updatePaymentDetails({
    provider: input.provider,
    account_name: input.account_name,
    account_number: input.account_number,
    instructions: input.instructions,
    qr_data_url: input.qr_data_url,
  });
  if (r.ok) revalidatePath("/admin/settings");
  return r;
}

// Re-export for grep / debugging.
export async function debugListAuditAction() {
  await getActor("/admin/audit");
  return listAuditLog({ limit: 5 });
}