/**
 * No-show sweep — `npm run bookings:tick`.
 *
 * Finds bookings whose slot started more than `no_show_grace_minutes`
 * (default 10) ago and whose status is still `paid` or `scheduled`,
 * then calls `mark_no_show_refund` for each. The RPC is idempotent
 * (no-op on already-refunded rows).
 *
 * Run on a cron in production. Locally:
 *   npm run bookings:tick
 */

import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

const env = Object.fromEntries(
  readFileSync(new URL("../.env.local", import.meta.url), "utf8")
    .split(/\r?\n/)
    .filter((line) => line.trim() && !line.trim().startsWith("#") && line.includes("="))
    .map((line) => {
      const idx = line.indexOf("=");
      return [line.slice(0, idx).trim(), line.slice(idx + 1).trim()];
    })
);

const base = env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY;
if (!base || !serviceKey) {
  console.error("Missing Supabase env in .env.local.");
  process.exit(1);
}

const admin = createClient(base, serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const GRACE_MINUTES = 10;
const cutoff = new Date(Date.now() - GRACE_MINUTES * 60_000).toISOString();

const { data: bookings, error } = await admin
  .from("bookings")
  .select("id, slot:availability_slots(starts_at)")
  .in("status", ["paid", "scheduled"])
  .order("created_at", { ascending: true })
  .limit(500);

if (error) {
  console.error("Failed to list bookings:", error.message);
  process.exit(1);
}

const expired = (bookings ?? []).filter((b) => {
  const slot = Array.isArray(b.slot) ? b.slot[0] : b.slot;
  return slot?.starts_at && new Date(slot.starts_at).getTime() < Date.parse(cutoff);
});

if (expired.length === 0) {
  console.log("No-show sweep: nothing to refund.");
  process.exit(0);
}

let refunded = 0;
let noop = 0;
let failed = 0;
for (const b of expired) {
  const { data, error: rpcErr } = await admin.rpc("mark_no_show_refund", {
    _booking_id: b.id,
  });
  if (rpcErr) {
    failed += 1;
    console.error(`  ! ${b.id} -> ${rpcErr.message}`);
    continue;
  }
  const row = data ?? {};
  if (row.noop) noop += 1;
  else refunded += 1;
}

console.log(
  `No-show sweep: ${refunded} refunded, ${noop} no-op, ${failed} failed (out of ${expired.length} candidate${expired.length === 1 ? "" : "s"}).`
);
process.exit(failed === 0 ? 0 : 1);
