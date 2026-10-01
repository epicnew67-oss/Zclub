#!/usr/bin/env node
/**
 * Release sweep — `npm run bookings:release`.
 *
 * Finds bookings in status='completed' whose `live_ended_at` was more
 * than `release_window_hours` ago and which have NO open dispute, then
 * calls `release_escrow` on each. The RPC is idempotent: re-running the
 * sweep is safe and a no-op on already-released bookings.
 *
 * Run on a cron in production. Idempotent, so a double-run within the
 * same window is fine.
 */

import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

const env = Object.fromEntries(
  readFileSync(new URL("../.env.local", import.meta.url), "utf8")
    .split(/\r?\n/)
    .filter(
      (line) => line.trim() && !line.trim().startsWith("#") && line.includes("=")
    )
    .map((line) => {
      const idx = line.indexOf("=");
      return [line.slice(0, idx).trim(), line.slice(idx + 1).trim()];
    })
);

const base = env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY;

if (!base || !serviceKey) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.");
  process.exit(1);
}

const admin = createClient(base, serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

async function main() {
  // Pull the window length from settings; default to 24 hours.
  const { data: hoursRow } = await admin
    .from("settings")
    .select("value")
    .eq("key", "release_window_hours")
    .maybeSingle();
  const hours = Number((hoursRow?.value as { hours?: number } | null)?.hours ?? 24);

  const cutoff = new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();

  // Bookings that are completed + ended before the cutoff + have no open
  // dispute. We join disputes to filter out anything still frozen.
  const { data: candidates, error } = await admin
    .from("bookings")
    .select("id, slot_id, price_tokens, status, live_ended_at")
    .eq("status", "completed")
    .lt("live_ended_at", cutoff)
    .limit(500);
  if (error) {
    console.error("sweep query failed:", error);
    process.exit(1);
  }
  if (!candidates || candidates.length === 0) {
    console.log(`0 bookings past the ${hours}h window.`);
    return;
  }

  let released = 0;
  let frozen = 0;
  let failed = 0;
  const frozenDisputes = [];

  for (const b of candidates) {
    const { data: openDispute } = await admin
      .from("disputes")
      .select("id")
      .eq("booking_id", b.id)
      .eq("status", "open")
      .maybeSingle();
    if (openDispute) {
      frozen += 1;
      frozenDisputes.push(b.id);
      continue;
    }

    const { data, error: rpcErr } = await admin.rpc("release_escrow", {
      _booking_id: b.id,
    });
    if (rpcErr) {
      failed += 1;
      console.error(`release_escrow ${b.id} failed:`, rpcErr.message);
      continue;
    }
    if (!data || data.ok === false) {
      failed += 1;
      console.error(`release_escrow ${b.id} refused:`, JSON.stringify(data));
      continue;
    }
    if (data.already_released) continue;
    released += 1;
    console.log(
      `released ${b.id}: +${data.seller_credit} to seller (commission ${data.commission_pct}%)`
    );
  }

  console.log(
    `\n${released} released, ${frozen} frozen (open dispute), ${failed} failed, ${candidates.length - released - frozen - failed} already released.`
  );
  if (frozenDisputes.length > 0) {
    console.log("Frozen dispute ids:", frozenDisputes);
  }
}

main().catch((err) => {
  console.error("sweep failed:", err);
  process.exit(1);
});
