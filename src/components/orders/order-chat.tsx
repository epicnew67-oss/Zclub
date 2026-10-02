"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { toast } from "sonner";
import { Loader2Icon, SendIcon } from "lucide-react";
import { sendChatMessageAction } from "@/app/orders/actions";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { JoinCallButton } from "@/components/orders/join-call-button";

type Msg = { id: number; senderId: string; body: string; createdAt: string };

function initials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((s) => s[0]?.toUpperCase() ?? "")
    .join("") || "?";
}

function relTime(iso: string, now: number) {
  const then = new Date(iso).getTime();
  const diff = Math.round((now - then) / 1000);
  const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });
  if (diff < 60) return rtf.format(-diff, "second");
  if (diff < 3600) return rtf.format(-Math.round(diff / 60), "minute");
  if (diff < 86400) return rtf.format(-Math.round(diff / 3600), "hour");
  return rtf.format(-Math.round(diff / 86400), "day");
}

export function OrderChat({
  chatId,
  bookingId,
  currentUserId,
  buyerId,
  sellerId,
  buyerName,
  sellerName,
  status,
  isOnDemand = false,
  slotStartsAt,
  slotEndsAt,
  initialMessages,
}: {
  chatId: string;
  bookingId: string;
  currentUserId: string;
  buyerId: string;
  sellerId: string;
  buyerName: string;
  sellerName: string;
  status: string;
  isOnDemand?: boolean;
  slotStartsAt: string;
  slotEndsAt: string;
  initialMessages: Msg[];
}) {
  const router = useRouter();
  const [messages, setMessages] = useState<Msg[]>(initialMessages);
  const [draft, setDraft] = useState("");
  const [pending, startTransition] = useTransition();
  const [clock, setClock] = useState<number | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const closed = status === "cancelled" || status === "seller_no_show";

  useEffect(() => {
    const tick = () => setClock(Date.now());
    tick();
    const timer = window.setInterval(tick, 30_000);
    return () => window.clearInterval(timer);
  }, []);

  // Scroll to bottom on new message.
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages.length]);

  // Realtime subscription for new messages.
  useEffect(() => {
    const supabase = createClient();
    let active = true;
    async function catchUp() {
      const { data, error } = await supabase.from("booking_messages")
        .select("id, sender_id, body, created_at").eq("chat_id", chatId)
        .order("created_at", { ascending: false }).limit(500);
      if (!active || error || !data) return;
      setMessages((prev) => {
        const merged = new Map(prev.map(m => [m.id, m]));
        for (const m of data) merged.set(m.id, { id: m.id, senderId: m.sender_id, body: m.body, createdAt: m.created_at });
        return [...merged.values()].sort((a, b) => a.createdAt.localeCompare(b.createdAt)).slice(-500);
      });
    }
    const channel = supabase
      .channel(`booking-chat:${chatId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "booking_messages",
          filter: `chat_id=eq.${chatId}`,
        },
        (payload) => {
          const m = payload.new as {
            id: number;
            sender_id: string;
            body: string;
            created_at: string;
          };
          setMessages((prev) => {
            if (prev.some((p) => p.id === m.id)) return prev;
            return [
              ...prev,
              {
                id: m.id,
                senderId: m.sender_id,
                body: m.body,
                createdAt: m.created_at,
              },
            ];
          });
        }
      )
      .on("postgres_changes", {
        event: "UPDATE", schema: "public", table: "bookings", filter: `id=eq.${bookingId}`,
      }, () => router.refresh())
      .subscribe((state) => {
        if (state === "SUBSCRIBED") { void catchUp(); router.refresh(); }
      });
    const onFocus = () => { void catchUp(); router.refresh(); };
    window.addEventListener("focus", onFocus);
    return () => {
      active = false;
      window.removeEventListener("focus", onFocus);
      supabase.removeChannel(channel);
    };
  }, [chatId, bookingId, router]);

  function send() {
    const body = draft.trim();
    if (!body || pending) return;
    if (body.length > 4000) {
      toast.error("Message is too long (max 4000 characters).");
      return;
    }
    startTransition(async () => {
      const result = await sendChatMessageAction(chatId, body);
      if (result.ok) {
        setDraft("");
        // The realtime channel will pick up the new row, but if for
        // some reason Realtime is delayed we still show it instantly.
        setMessages((prev) => {
          if (prev.some((p) => p.id === result.message.id)) return prev;
          return [
            ...prev,
            {
              id: result.message.id,
              senderId: result.message.senderId,
              body: result.message.body,
              createdAt: result.message.createdAt,
            },
          ];
        });
      } else {
        switch (result.code) {
          case "rate_limited":
            toast.error("Slow down a bit — too many messages in the last minute.");
            break;
          case "empty":
            toast.error("Message can't be empty.");
            break;
          case "not_participant":
            toast.error("You can't post in this chat.");
            break;
          default:
            toast.error("Could not send. Try again.");
        }
      }
    });
  }

  return (
    <Card className="flex h-[60vh] flex-col overflow-hidden md:h-[480px]">
      <CardHeader className="flex flex-row items-start justify-between gap-3 border-b border-border/60 pb-3">
        <div>
          <CardTitle className="text-base">Chat</CardTitle>
          <p className="mt-1 text-xs text-muted-foreground">
            Only you and {currentUserId === buyerId ? sellerName : buyerName} can see these messages.{" "}
            {closed ? "This order is finalized — messages stay readable." : "Text is plain; HTML is stripped."}
          </p>
        </div>
        <JoinCallButton
          bookingId={bookingId}
          slotStartsAt={slotStartsAt}
          slotEndsAt={slotEndsAt}
          status={status}
          isOnDemand={isOnDemand}
        />
      </CardHeader>
      <CardContent className="flex min-h-0 flex-1 flex-col gap-3 p-0">
        <div
          ref={scrollRef}
          className="flex-1 space-y-3 overflow-y-auto px-4 py-3"
          aria-live="polite"
        >
          {messages.length === 0 ? (
            <div className="grid h-full place-items-center text-center text-sm text-muted-foreground">
              <div>
                <p>No messages yet.</p>
                <p className="mt-1 text-xs">
                  Say hi — share what you&apos;d like to talk about.
                </p>
              </div>
            </div>
          ) : (
            messages.map((m) => {
              const mine = m.senderId === currentUserId;
              const senderName =
                m.senderId === buyerId ? buyerName : m.senderId === sellerId ? sellerName : "—";
              return (
                <div
                  key={m.id}
                  className={`flex items-end gap-2 ${mine ? "justify-end" : "justify-start"}`}
                >
                  {!mine ? (
                    <span
                      aria-hidden
                      className="grid size-7 shrink-0 place-items-center rounded-md border border-gold/30 bg-gold/10 font-heading text-[10px] text-gold"
                    >
                      {initials(senderName)}
                    </span>
                  ) : null}
                  <div
                    className={`max-w-[78%] rounded-2xl px-3 py-2 text-sm leading-relaxed ${
                      mine
                        ? "rounded-br-sm bg-burgundy/30 text-foreground"
                        : "rounded-bl-sm border border-border/70 bg-surface/60 text-foreground/90"
                    }`}
                  >
                    {!mine ? (
                      <p className="mb-0.5 text-[10px] tracking-wider text-muted-foreground uppercase">
                        {senderName}
                      </p>
                    ) : null}
                    <p className="whitespace-pre-wrap break-words">{m.body}</p>
                    <p className="mt-1 text-right text-[10px] text-muted-foreground">
                      {clock === null ? "Sent" : relTime(m.createdAt, clock)}
                    </p>
                  </div>
                  {mine ? (
                    <span
                      aria-hidden
                      className="grid size-7 shrink-0 place-items-center rounded-md border border-gold/30 bg-gold/10 font-heading text-[10px] text-gold"
                    >
                      You
                    </span>
                  ) : null}
                </div>
              );
            })
          )}
        </div>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            send();
          }}
          className="flex items-end gap-2 border-t border-border/60 bg-background/50 px-4 py-3"
        >
          <Textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                send();
              }
            }}
            placeholder={
              closed
                ? "This order is finalized — chat is read-only."
                : "Type a message…"
            }
            rows={1}
            disabled={closed || pending}
            className="min-h-10 max-h-32 resize-y"
            aria-label="Message"
          />
          <Button
            type="submit"
            size="icon"
            disabled={closed || pending || !draft.trim()}
            className="bg-burgundy text-foreground hover:bg-burgundy/90"
            aria-label="Send message"
          >
            {pending ? (
              <Loader2Icon className="size-4 animate-spin" />
            ) : (
              <SendIcon className="size-4" />
            )}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
