"use server";

import { revalidatePath } from "next/cache";
import { markAllRead, markRead } from "@/lib/notifications";

export async function markNotificationReadAction(id: string): Promise<{ ok: boolean; error?: string }> {
  const r = await markRead(id);
  if (r.ok) revalidatePath("/notifications");
  return r;
}

export async function markAllNotificationsReadAction(): Promise<{ ok: boolean; error?: string }> {
  const r = await markAllRead();
  if (r.ok) revalidatePath("/notifications");
  return r;
}
