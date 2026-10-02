"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

export async function saveTimeZoneAction(timeZone: string): Promise<{ ok: true } | { ok: false; error: string }> {
  try { new Intl.DateTimeFormat("en-US", { timeZone }); }
  catch { return { ok: false, error: "Choose a valid region and time zone." }; }
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Sign in required." };
  const { error } = await supabase.from("profiles").update({ time_zone: timeZone }).eq("id", user.id);
  if (error) return { ok: false, error: error.message };
  revalidatePath("/", "layout");
  revalidatePath("/account");
  return { ok: true };
}
