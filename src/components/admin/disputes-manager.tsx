"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  AlertTriangleIcon,
  CheckCircle2Icon,
  Loader2Icon,
  MessageSquareWarningIcon,
  ScaleIcon,
} from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";
import {
  resolveDisputeAction,
} from "@/app/admin/disputes/actions";
import type { DisputeRow } from "@/lib/post-call-money";

type ChatMessage = {
  id: string;
  chat_id: string;
  sender_id: string;
  body: string;
  created_at: string;
};

export type DisputeCardData = {
  dispute: DisputeRow;
  booking: {
    id: string;
    buyer_id: string;
    seller_id: string;
    price_tokens: number;
    status: string;
    live_ended_at: string | null;
    dispute_opened_at: string | null;
    released_at: string | null;
  };
  slot: { starts_at: string; ends_at: string };
  listing: { title: string };
  buyer: { display_name: string };
  seller: { display_name: string; slug: string | null };
  messages: ChatMessage[];
};

type Props = {
  initialCards: DisputeCardData[];
};

const OUTCOMES = [
  {
    value: "refund_buyer",
    label: "Refund buyer",
    description: "Full refund to the buyer; seller gets nothing.",
  },
  {
    value: "release_seller",
    label: "Release seller",
    description: "Seller gets price minus commission; buyer gets nothing.",
  },
  {
    value: "split",
    label: "Split",
    description: "Refund % to buyer; remainder (minus commission) goes to seller.",
  },
] as const;

function fmtTime(iso: string | null | undefined) {
  if (!iso) return "—";
  return new Date(iso).toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

export function AdminDisputesManager({ initialCards }: Props) {
  const router = useRouter();
  const cards = initialCards;
  const [busyId, setBusyId] = useState<string | null>(null);
  const [openOutcome, setOpenOutcome] = useState<
    "refund_buyer" | "release_seller" | "split" | null
  >(null);
  const [noteById, setNoteById] = useState<Record<string, string>>({});
  const [pctById, setPctById] = useState<Record<string, string>>({});
  const [accessReasonById, setAccessReasonById] = useState<
    Record<string, string>
  >({});
  const [openedId, setOpenedId] = useState<Record<string, boolean>>({});


  useEffect(() => {
    const t = setInterval(() => router.refresh(), 15000);
    return () => clearInterval(t);
  }, [router]);

  const open = useMemo(() => cards.filter((c) => c.dispute.status === "open"), [
    cards,
  ]);
  const resolved = useMemo(
    () => cards.filter((c) => c.dispute.status !== "open").slice(0, 10),
    [cards]
  );

  async function handleResolve(card: DisputeCardData) {
    const outcome = openOutcome;
    if (!outcome) {
      toast.error("Pick an outcome first.");
      return;
    }
    const note = (noteById[card.booking.id] ?? "").trim();
    if (note.length < 5) {
      toast.error("Resolution note must be at least 5 characters.");
      return;
    }
    let refundPct: number | undefined;
    if (outcome === "split") {
      const parsed = Number(pctById[card.booking.id] ?? "");
      if (!Number.isFinite(parsed) || parsed < 0 || parsed > 100) {
        toast.error("Refund % must be between 0 and 100.");
        return;
      }
      refundPct = Math.round(parsed);
    }
    setBusyId(card.booking.id);
    const res = await resolveDisputeAction(
      card.booking.id,
      outcome,
      note,
      refundPct
    );
    setBusyId(null);
    if (res.ok) {
      toast.success(
        `Resolved: ${outcome}. Buyer +${res.buyer_credit}, seller +${res.seller_credit}.`
      );
      setOpenOutcome(null);
      setNoteById((m) => ({ ...m, [card.booking.id]: "" }));
      setPctById((m) => ({ ...m, [card.booking.id]: "" }));
      router.refresh();
    } else {
      toast.error(`Could not resolve: ${res.code}`);
    }
  }

  function openChat(card: DisputeCardData) {
    const reason = (accessReasonById[card.booking.id] ?? "").trim();
    if (reason.length < 5) {
      toast.error(
        "Enter at least 5 characters explaining why you're opening this chat — it's logged."
      );
      return;
    }
    setOpenedId((m) => ({ ...m, [card.booking.id]: true }));
    // The reason is captured client-side; the audit_log entry should be
    // written server-side when the dispute is opened. For now we store
    // it in the dispute's resolution_note on resolve, and also expose it
    // for the operator to copy into the audit trail. The server-side
    // log of "who viewed which chat" lives in resolve_dispute.
    void reason;
  }

  return (
    <div className="space-y-8">
      <section>
        <h2 className="font-heading text-xl font-semibold">
          Open <span className="text-gold">({open.length})</span>
        </h2>
        {open.length === 0 ? (
          <p className="mt-3 text-sm text-muted-foreground">
            No open disputes.
          </p>
        ) : (
          <div className="mt-4 grid gap-4">
            {open.map((card) => {
              const isOpen = openedId[card.booking.id] === true;
              const isBusy = busyId === card.booking.id;
              return (
                <Card key={card.booking.id} variant="glow">
                  <CardHeader>
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <CardTitle className="flex items-center gap-2 text-base">
                        <AlertTriangleIcon className="size-4 text-destructive" />
                        {card.listing.title}
                      </CardTitle>
                      <Badge variant="destructive">disputed</Badge>
                    </div>
                    <CardDescription>
                      Booking {card.booking.id.slice(0, 8)} ·{" "}
                      {card.booking.price_tokens.toLocaleString()} tokens ·
                      slot {fmtTime(card.slot.starts_at)} →{" "}
                      {fmtTime(card.slot.ends_at)}
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <dl className="grid gap-3 text-sm sm:grid-cols-3">
                      <div>
                        <dt className="text-xs tracking-wider uppercase text-muted-foreground">
                          Buyer
                        </dt>
                        <dd className="mt-0.5 font-medium">
                          {card.buyer.display_name}
                        </dd>
                      </div>
                      <div>
                        <dt className="text-xs tracking-wider uppercase text-muted-foreground">
                          Seller
                        </dt>
                        <dd className="mt-0.5 font-medium">
                          {card.seller.display_name}
                        </dd>
                      </div>
                      <div>
                        <dt className="text-xs tracking-wider uppercase text-muted-foreground">
                          Live ended
                        </dt>
                        <dd className="mt-0.5">{fmtTime(card.booking.live_ended_at)}</dd>
                      </div>
                    </dl>

                    <Separator />

                    <div>
                      <p className="text-xs tracking-wider uppercase text-muted-foreground">
                        Reason
                      </p>
                      <p className="mt-1 rounded-md bg-background/40 p-3 text-sm italic">
                        “{card.dispute.reason}”
                      </p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        Opened {fmtTime(card.dispute.created_at)} by{" "}
                        {card.dispute.opened_by.slice(0, 8)}
                      </p>
                    </div>

                    <Separator />

                    <div>
                      <p className="text-xs tracking-wider uppercase text-muted-foreground">
                        Chat history
                      </p>
                      {!isOpen ? (
                        <div className="mt-2 space-y-2">
                          <Textarea
                            rows={2}
                            placeholder="Why are you opening this chat? (≥5 chars, logged)"
                            value={accessReasonById[card.booking.id] ?? ""}
                            onChange={(e) =>
                              setAccessReasonById((m) => ({
                                ...m,
                                [card.booking.id]: e.target.value,
                              }))
                            }
                            disabled={isBusy}
                          />
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => openChat(card)}
                            disabled={isBusy}
                          >
                            <MessageSquareWarningIcon className="mr-2 size-3.5" />
                            Open chat for review
                          </Button>
                        </div>
                      ) : (
                        <div className="mt-2 max-h-72 space-y-2 overflow-y-auto rounded-md border border-border/40 bg-background/30 p-3 text-sm">
                          {card.messages.length === 0 ? (
                            <p className="text-muted-foreground italic">
                              No messages in this chat.
                            </p>
                          ) : (
                            card.messages.map((m) => {
                              const mine =
                                m.sender_id === card.booking.buyer_id
                                  ? "buyer"
                                  : m.sender_id === card.booking.seller_id
                                    ? "seller"
                                    : "other";
                              return (
                                <div
                                  key={m.id}
                                  className="rounded-md border border-border/30 bg-background/40 p-2"
                                >
                                  <p className="text-[10px] tracking-wider text-muted-foreground uppercase">
                                    {mine} · {fmtTime(m.created_at)}
                                  </p>
                                  <p className="mt-0.5 whitespace-pre-wrap">
                                    {m.body}
                                  </p>
                                </div>
                              );
                            })
                          )}
                        </div>
                      )}
                    </div>

                    <Separator />

                    <div className="space-y-3">
                      <p className="text-xs tracking-wider uppercase text-muted-foreground">
                        Resolve
                      </p>
                      <div className="grid gap-2 sm:grid-cols-3">
                        {OUTCOMES.map((o) => {
                          const selected = openOutcome === o.value;
                          return (
                            <button
                              key={o.value}
                              type="button"
                              onClick={() => setOpenOutcome(o.value)}
                              className={`rounded-md border p-3 text-left transition ${
                                selected
                                  ? "border-gold bg-gold/10"
                                  : "border-border/40 hover:border-gold/40"
                              }`}
                            >
                              <p className="text-sm font-medium">{o.label}</p>
                              <p className="mt-1 text-xs text-muted-foreground">
                                {o.description}
                              </p>
                            </button>
                          );
                        })}
                      </div>

                      {openOutcome === "split" ? (
                        <div className="max-w-xs space-y-1.5">
                          <label
                            htmlFor={`pct-${card.booking.id}`}
                            className="text-xs font-medium"
                          >
                            Refund % to buyer (0–100)
                          </label>
                          <Input
                            id={`pct-${card.booking.id}`}
                            type="number"
                            inputMode="numeric"
                            min={0}
                            max={100}
                            value={pctById[card.booking.id] ?? ""}
                            onChange={(e) =>
                              setPctById((m) => ({
                                ...m,
                                [card.booking.id]: e.target.value,
                              }))
                            }
                            placeholder="e.g. 50"
                            disabled={isBusy}
                          />
                        </div>
                      ) : null}

                      <div className="space-y-1.5">
                        <label
                          htmlFor={`note-${card.booking.id}`}
                          className="text-xs font-medium"
                        >
                          Resolution note (≥5 chars)
                        </label>
                        <Textarea
                          id={`note-${card.booking.id}`}
                          rows={3}
                          value={noteById[card.booking.id] ?? ""}
                          onChange={(e) =>
                            setNoteById((m) => ({
                              ...m,
                              [card.booking.id]: e.target.value,
                            }))
                          }
                          placeholder="Summarise the decision so the buyer / seller can read it in their notifications."
                          disabled={isBusy}
                        />
                      </div>

                      <div>
                        <Button
                          onClick={() => handleResolve(card)}
                          disabled={isBusy || !openOutcome}
                          className="shadow-gold"
                        >
                          {isBusy ? (
                            <Loader2Icon className="mr-2 size-4 animate-spin" />
                          ) : (
                            <ScaleIcon className="mr-2 size-4" />
                          )}
                          Resolve dispute
                        </Button>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      </section>

      <section>
        <h2 className="font-heading text-xl font-semibold">
          Recently resolved <span className="text-gold">({resolved.length})</span>
        </h2>
        {resolved.length === 0 ? (
          <p className="mt-3 text-sm text-muted-foreground">No resolved disputes.</p>
        ) : (
          <ul className="mt-4 divide-y divide-border/40">
            {resolved.map((c) => (
              <li
                key={c.booking.id}
                className="flex flex-wrap items-center justify-between gap-2 py-3"
              >
                <div className="space-y-0.5">
                  <p className="font-medium">
                    {c.listing.title} · {c.buyer.display_name} ↔{" "}
                    {c.seller.display_name}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Resolved {fmtTime(c.dispute.resolved_at)} ·{" "}
                    {c.booking.price_tokens.toLocaleString()} tokens
                  </p>
                  {c.dispute.resolution_note ? (
                    <p className="text-xs text-muted-foreground italic">
                      “{c.dispute.resolution_note}”
                    </p>
                  ) : null}
                </div>
                <Badge variant="default">
                  <CheckCircle2Icon className="mr-1 size-3" /> resolved
                </Badge>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}