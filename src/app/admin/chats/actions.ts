"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getChatLog } from "@/lib/admin";

export async function getChatLogAction(bookingId: string, reason: string) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/auth/sign-in?next=/admin/chats");
  const res = await getChatLog(bookingId, reason);
  revalidatePath("/admin/chats");
  return res;
}