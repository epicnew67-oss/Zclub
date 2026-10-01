"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { setSellerActive, setSellerVerified, softDeleteSeller } from "@/lib/admin";

type SellerAppResult = { ok: boolean; error?: string };

async function callAdminSellerRpc<T>(
  fnName: string,
  args: Record<string, unknown>
): Promise<SellerAppResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect(`/auth/sign-in?next=/admin/sellers`);

  const { data, error } = await supabase.rpc(fnName, args);
  if (error) return { ok: false, error: error.message };
  const payload = (data ?? {}) as { ok?: boolean; code?: string; message?: string };
  if (payload.ok) return { ok: true };
  return { ok: false, error: payload.code ?? payload.message ?? "error" };
}

export async function setSellerVerifiedAction(userId: string, verified: boolean) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/auth/sign-in?next=/admin/sellers");
  const r = await setSellerVerified(userId, verified);
  if (r.ok) revalidatePath("/admin/sellers");
  return r;
}

export async function setSellerActiveAction(
  userId: string,
  active: boolean,
  refundStrategy: "finish" | "refund_in_progress"
) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/auth/sign-in?next=/admin/sellers");
  const r = await setSellerActive(userId, active, refundStrategy);
  if (r.ok) revalidatePath("/admin/sellers");
  return r;
}

export async function softDeleteSellerAction(userId: string) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/auth/sign-in?next=/admin/sellers");
  const r = await softDeleteSeller(userId);
  if (r.ok) revalidatePath("/admin/sellers");
  return r;
}

export async function approveSellerApplicationAction(
  applicationId: string,
  note: string | null
): Promise<SellerAppResult> {
  const result = await callAdminSellerRpc("approve_seller_application", {
    _application_id: applicationId,
    _note: note,
  });
  if (result.ok) revalidatePath("/admin/sellers");
  return result;
}

export async function rejectSellerApplicationAction(
  applicationId: string,
  reason: string
): Promise<SellerAppResult> {
  const result = await callAdminSellerRpc("reject_seller_application", {
    _application_id: applicationId,
    _reason: reason,
  });
  if (result.ok) revalidatePath("/admin/sellers");
  return result;
}