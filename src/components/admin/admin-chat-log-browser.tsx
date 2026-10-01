"use client";

import { useState, useTransition } from "react";
import { getChatLogAction } from "@/app/admin/chats/actions";
import type { AdminChatLogBookingRow, AdminChatLogMessage } from "@/lib/admin";

function fmt(s: string): string {
  return new Date(s).toISOString().replace("T", " ").slice(0, 19);
}

export function AdminChatLogBrowser({
  bookings,
  retentionDays,
}: {
  bookings: AdminChatLogBookingRow[];
  retentionDays: number;
}) {
  const [selected, setSelected] = useState<AdminChatLogBookingRow | null>(null);
  const [reason, setReason] = useState("");
  const [messages, setMessages] = useState<AdminChatLogMessage[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  if (bookings.length === 0) {
    return (
      <div className="rounded-lg border border-border/70 bg-surface/40 px-4 py-6 text-center text-sm text-muted-foreground">
        No bookings eligible for chat-log review right now (retention: {retentionDays} days).
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_1.2fr]">
      <div className="rounded-lg border border-border/70 bg-surface/40">
        <ul className="divide-y divide-border/40">
          {bookings.map((b) => (
            <li key={b.booking_id}>
              <button
                type="button"
                onClick={() => {
                  setSelected(b);
                  setMessages(null);
                  setError(null);
                  setReason("");
                }}
                aria-current={selected?.booking_id === b.booking_id ? "true" : undefined}
                className={`flex w-full flex-col items-start gap-1 px-4 py-3 text-left text-sm hover:bg-gold/5 ${
                  selected?.booking_id === b.booking_id ? "bg-gold/10" : ""
                }`}
              >
                <div className="font-medium">{b.listing_title}</div>
                <div className="text-xs text-muted-foreground">
                  {b.buyer_name} → {b.seller_name}
                </div>
                <div className="flex gap-2 text-xs">
                  <span className="rounded border border-border/60 px-1.5 py-0.5 capitalize">
                    {b.booking_status}
                  </span>
                  <span className="text-muted-foreground">last msg {fmt(b.last_message_at)}</span>
                </div>
              </button>
            </li>
          ))}
        </ul>
      </div>

      <div className="rounded-lg border border-border/70 bg-surface/40 p-4">
        {!selected ? (
          <p className="text-sm text-muted-foreground">
            Pick a booking on the left to view the messages.
          </p>
        ) : (
          <>
            <div className="mb-3">
              <div className="font-medium">{selected.listing_title}</div>
              <div className="text-xs text-muted-foreground">
                {selected.buyer_name} → {selected.seller_name} ·{" "}
                <span className="capitalize">{selected.booking_status}</span>
              </div>
            </div>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                if (reason.trim().length < 10) {
                  setError("Reason must be at least 10 characters.");
                  return;
                }
                startTransition(async () => {
                  setError(null);
                  const res = await getChatLogAction(selected.booking_id, reason.trim());
                  if (res.ok) {
                    setMessages(res.messages);
                  } else {
                    setMessages(null);
                    setError(res.code ?? "unknown error");
                  }
                });
              }}
              className="mb-3 flex flex-col gap-2"
            >
              <label className="flex flex-col text-xs">
                <span className="mb-1 text-muted-foreground">
                  Reason (≥10 chars; recorded in audit log)
                </span>
                <textarea
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  rows={2}
                  className="rounded-lg border border-input bg-transparent px-3 py-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
                  placeholder="Why are you viewing this chat?"
                />
              </label>
              <button
                type="submit"
                disabled={isPending}
                className="h-9 self-start rounded-lg border border-gold/30 bg-gold/10 px-4 text-sm font-medium text-gold hover:bg-gold/20 disabled:opacity-40"
              >
                {isPending ? "Loading…" : "Open chat log"}
              </button>
              {error ? (
                <div className="text-xs text-destructive">Error: {error}</div>
              ) : null}
            </form>

            {messages ? (
              <ol className="max-h-96 space-y-3 overflow-y-auto rounded border border-border/40 bg-background/30 p-3 text-sm">
                {messages.length === 0 ? (
                  <li className="text-muted-foreground">No messages.</li>
                ) : null}
                {messages.map((m) => (
                  <li key={m.id} className="border-b border-border/30 pb-2 last:border-0">
                    <div className="text-xs text-muted-foreground">
                      {m.sender_id.slice(0, 8)} · {fmt(m.created_at)}
                    </div>
                    <div>{m.body}</div>
                  </li>
                ))}
              </ol>
            ) : null}
          </>
        )}
      </div>
    </div>
  );
}