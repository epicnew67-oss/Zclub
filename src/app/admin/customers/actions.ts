"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import {
  setUserBan,
  softDeleteUser,
  walletAdjust,
} from "@/lib/admin";

async function getActor() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return { supabase, user };
}

function asString(v: FormDataEntryValue | null): string {
  return typeof v === "string" ? v : "";
}

export async function banUserAction(formData: FormData) {
  const { user } = await getActor();
  if (!user) redirect("/auth/sign-in?next=/admin/customers");
  const userId = asString(formData.get("userId"));
  await setUserBan(userId, true, "Banned via admin customers table.");
  revalidatePath("/admin/customers");
}

export async function unbanUserAction(formData: FormData) {
  const { user } = await getActor();
  if (!user) redirect("/auth/sign-in?next=/admin/customers");
  const userId = asString(formData.get("userId"));
  await setUserBan(userId, false, null);
  revalidatePath("/admin/customers");
}

export async function softDeleteUserAction(formData: FormData) {
  const { user } = await getActor();
  if (!user) redirect("/auth/sign-in?next=/admin/customers");
  const userId = asString(formData.get("userId"));
  await softDeleteUser(userId);
  revalidatePath("/admin/customers");
}

export async function adjustWalletAction(formData: FormData) {
  const { user } = await getActor();
  if (!user) redirect("/auth/sign-in?next=/admin/customers");
  const userId = asString(formData.get("userId"));
  const amount = parseInt(asString(formData.get("amount")) || "0", 10);
  const reason = asString(formData.get("reason"));
  await walletAdjust(userId, amount, reason);
  revalidatePath("/admin/customers");
}

// Bind-style action exports used by inline form `action` props.
export async function banUserButton(formData: FormData) {
  return banUserAction(formData);
}

export async function unbanUserButton(formData: FormData) {
  return unbanUserAction(formData);
}

export async function softDeleteUserButton(formData: FormData) {
  return softDeleteUserAction(formData);
}

export async function adjustWalletButton(formData: FormData) {
  return adjustWalletAction(formData);
}