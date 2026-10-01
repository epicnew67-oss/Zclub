"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { CalendarPlusIcon, Loader2Icon, Trash2Icon } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { addSlotAction, removeSlotAction } from "@/app/seller/availability/actions";
import {
  CalendarWidget,
  type EventsData,
} from "@/components/watermelon/calendar-widget";
import { upperMeridiem } from "@/lib/datetime-format";

export type SlotOption = {
  id: string;
  listing_id: string;
  starts_at: string;
  ends_at: string;
  price_tokens: number;
  status: "open" | "booked" | "blocked" | "cancelled";
};

export type ApprovedListingOption = {
  id: string;
  title: string;
  duration_minutes: number;
  price_tokens: number;
};

type Props = {
  listings: ApprovedListingOption[];
  slots: SlotOption[];
};

type SlotByDay = {
  date: string;
  rows: SlotOption[];
};

function formatLocalDay(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(undefined, {
    weekday: "short",
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function formatLocalTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return upperMeridiem(
    d.toLocaleTimeString(undefined, {
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    })
  );
}

/** Preview for the datetime picker — always with uppercase AM/PM. */
function formatLocalInputPreview(value: string): string | null {
  const d = new Date(value);
  if (!value || Number.isNaN(d.getTime())) return null;
  const day = d.toLocaleDateString(undefined, {
    weekday: "short",
    year: "numeric",
    month: "short",
    day: "numeric",
  });
  const time = upperMeridiem(
    d.toLocaleTimeString(undefined, {
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    })
  );
  return `${day} · ${time}`;
}

function localDateKey(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

const HOURS12 = Array.from({ length: 12 }, (_, i) => i + 1);
const MINUTES = Array.from({ length: 12 }, (_, i) => i * 5);

export function AvailabilityManager({ listings, slots }: Props) {
  const router = useRouter();
  const [selectedListingId, setSelectedListingId] = useState(
    listings[0]?.id ?? ""
  );
  const selectedListing = useMemo(
    () => listings.find((l) => l.id === selectedListingId) ?? null,
    [listings, selectedListingId]
  );

  const [selectedDate, setSelectedDate] = useState(() => localDateKey(new Date()));
  const [hour12, setHour12] = useState(() => {
    const h = new Date().getHours() % 12;
    return h === 0 ? 12 : h;
  });
  const [minute, setMinute] = useState(() => {
    const m = new Date().getMinutes();
    return Math.floor(m / 5) * 5;
  });
  const [meridiem, setMeridiem] = useState<"AM" | "PM">(() =>
    new Date().getHours() >= 12 ? "PM" : "AM"
  );
  const [duration, setDuration] = useState(
    String(selectedListing?.duration_minutes ?? 30)
  );
  const [price, setPrice] = useState(
    String(selectedListing?.price_tokens ?? 200)
  );
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [removingId, setRemovingId] = useState<string | null>(null);
  // Optimistic removals so the list updates the moment Remove is clicked.
  const [removedIds, setRemovedIds] = useState<Set<string>>(new Set());

  const visibleSlots = useMemo(
    () => slots.filter((s) => !removedIds.has(s.id)),
    [slots, removedIds]
  );

  const slotsForListing = useMemo(
    () =>
      visibleSlots
        .filter((s) => s.listing_id === selectedListingId)
        .sort((a, b) => a.starts_at.localeCompare(b.starts_at)),
    [visibleSlots, selectedListingId]
  );

  const byDay: SlotByDay[] = useMemo(() => {
    const buckets = new Map<string, SlotOption[]>();
    for (const slot of slotsForListing) {
      const day = formatLocalDay(slot.starts_at);
      const arr = buckets.get(day) ?? [];
      arr.push(slot);
      buckets.set(day, arr);
    }
    return Array.from(buckets.entries()).map(([date, rows]) => ({
      date,
      rows,
    }));
  }, [slotsForListing]);

  // Agenda for the calendar widget — the seller's own slots, keyed by the
  // local day so dots + the day list match what they see below.
  const events: EventsData = useMemo(() => {
    const map: EventsData = {};
    for (const slot of slotsForListing) {
      const key = localDateKey(new Date(slot.starts_at));
      const list = map[key] ?? (map[key] = []);
      list.push({
        title: slot.status === "booked" ? "Booked call" : "Open slot",
        time: `${formatLocalTime(slot.starts_at)} – ${formatLocalTime(slot.ends_at)}`,
      });
    }
    return map;
  }, [slotsForListing]);

  const monthLabel = useMemo(
    () =>
      new Date(`${selectedDate}T00:00:00`).toLocaleDateString(undefined, {
        month: "long",
        year: "numeric",
      }),
    [selectedDate]
  );

  const startsAtLocal = useMemo(() => {
    const h24 = (hour12 % 12) + (meridiem === "PM" ? 12 : 0);
    return `${selectedDate}T${String(h24).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
  }, [selectedDate, hour12, minute, meridiem]);

  async function handleAdd(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedListing) return;
    setError(null);
    setSubmitting(true);
    try {
      if (!startsAtLocal) {
        throw new Error("Pick a start date and time.");
      }
      const result = await addSlotAction({
        listingId: selectedListing.id,
        startsAtLocal,
        durationMinutes: Number(duration),
        priceTokens: Number(price),
      });
      if (!result.ok) throw new Error(result.error);
      toast.success("Slot added.");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not add slot.");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleRemove(slotId: string) {
    setRemovingId(slotId);
    setError(null);
    // Instant feedback — hide it now; restore only on a real failure.
    setRemovedIds((prev) => new Set(prev).add(slotId));
    try {
      const result = await removeSlotAction(slotId);
      if (!result.ok) throw new Error(result.error);
      toast.success("Slot removed.");
      router.refresh();
    } catch (err) {
      setRemovedIds((prev) => {
        const next = new Set(prev);
        next.delete(slotId);
        return next;
      });
      setError(err instanceof Error ? err.message : "Could not remove slot.");
    } finally {
      setRemovingId(null);
    }
  }

  if (listings.length === 0) {
    return (
      <Card variant="gold">
        <CardHeader>
          <CardTitle className="text-gold">No approved listings yet</CardTitle>
          <CardDescription>
            Slots can&apos;t be added until at least one listing is approved by an admin.
            Create a listing and submit it for review first.
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <Card variant="gold">
        <CardHeader>
          <CardTitle className="text-gold">Manage availability</CardTitle>
          <CardDescription>
            Pick a listing, add slots in your local time, and we&apos;ll store them as UTC.
            Overlapping slots are rejected.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-2">
            <Label htmlFor="listing">Listing</Label>
            <select
              id="listing"
              value={selectedListingId}
              onChange={(e) => {
                const id = e.target.value;
                setSelectedListingId(id);
                const l = listings.find((x) => x.id === id);
                if (l) {
                  setDuration(String(l.duration_minutes));
                  setPrice(String(l.price_tokens));
                }
              }}
              className="flex h-8 w-full rounded-lg border border-input bg-transparent px-2.5 py-1 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
            >
              {listings.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.title}
                </option>
              ))}
            </select>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Add slot</CardTitle>
          <CardDescription>
            Duration is in minutes. Default duration and price come from the listing.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleAdd} className="grid gap-3 sm:grid-cols-4">
            <div className="space-y-3 sm:col-span-4">
              <Label>Starts at</Label>
              <div className="max-w-full overflow-x-auto pb-1">
                <CalendarWidget
                  events={events}
                  initialSelectedDate={selectedDate}
                  currentMonthYear={monthLabel}
                  onDateSelect={setSelectedDate}
                />
              </div>
              <div className="flex flex-wrap items-end gap-3">
                <div className="space-y-1">
                  <Label htmlFor="hour">Hour</Label>
                  <select
                    id="hour"
                    value={hour12}
                    onChange={(e) => setHour12(Number(e.target.value))}
                    className="flex h-8 rounded-lg border border-input bg-transparent px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
                  >
                    {HOURS12.map((h) => (
                      <option key={h} value={h}>
                        {h}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="space-y-1">
                  <Label htmlFor="minute">Minute</Label>
                  <select
                    id="minute"
                    value={minute}
                    onChange={(e) => setMinute(Number(e.target.value))}
                    className="flex h-8 rounded-lg border border-input bg-transparent px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
                  >
                    {MINUTES.map((m) => (
                      <option key={m} value={m}>
                        {String(m).padStart(2, "0")}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="space-y-1">
                  <Label>AM / PM</Label>
                  <div className="inline-flex overflow-hidden rounded-lg border border-input">
                    {(["AM", "PM"] as const).map((m) => (
                      <button
                        key={m}
                        type="button"
                        onClick={() => setMeridiem(m)}
                        className={`h-8 px-3 text-sm transition-colors ${
                          meridiem === m
                            ? "bg-gold font-medium text-background"
                            : "text-muted-foreground hover:text-foreground"
                        }`}
                      >
                        {m}
                      </button>
                    ))}
                  </div>
                </div>
                {formatLocalInputPreview(startsAtLocal) ? (
                  <p className="pb-2 text-xs text-muted-foreground">
                    Local time: {formatLocalInputPreview(startsAtLocal)}
                  </p>
                ) : null}
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="duration">Duration (min)</Label>
              <Input
                id="duration"
                type="number"
                min={5}
                max={240}
                value={duration}
                onChange={(e) => setDuration(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="price">Price (tokens)</Label>
              <Input
                id="price"
                type="number"
                min={1}
                value={price}
                onChange={(e) => setPrice(e.target.value)}
              />
            </div>
            <div className="sm:col-span-4">
              <Button
                type="submit"
                disabled={submitting}
                className="bg-burgundy text-foreground hover:bg-burgundy/90 shadow-glow"
              >
                {submitting ? (
                  <Loader2Icon className="size-4 animate-spin" />
                ) : (
                  <CalendarPlusIcon className="size-4" />
                )}
                Add slot
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      {error ? (
        <Alert variant="destructive">
          <AlertTitle>Couldn&apos;t update</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Upcoming slots</CardTitle>
          <CardDescription>
            Showing slots for the selected listing, grouped by local date.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {byDay.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No slots yet. Add one above.
            </p>
          ) : (
            <div className="space-y-4">
              {byDay.map((bucket) => (
                <div key={bucket.date} className="space-y-2">
                  <p className="text-xs tracking-wider uppercase text-muted-foreground">
                    {bucket.date}
                  </p>
                  <ul className="divide-y divide-border/70 rounded-lg border border-border/70">
                    {bucket.rows.map((slot) => {
                      const isBooked = slot.status === "booked";
                      return (
                        <li
                          key={slot.id}
                          className="flex items-center justify-between gap-3 px-3 py-2"
                        >
                          <div className="flex items-center gap-3 text-sm">
                            <span className="font-medium text-foreground">
                              {formatLocalTime(slot.starts_at)} – {formatLocalTime(slot.ends_at)}
                            </span>
                            <span className="text-xs text-muted-foreground">
                              {slot.price_tokens.toLocaleString()} tokens
                            </span>
                            {isBooked ? (
                              <Badge variant="gold-outline">Booked</Badge>
                            ) : null}
                          </div>
                          {isBooked ? null : (
                            <Button
                              size="sm"
                              variant="outline"
                              disabled={removingId === slot.id}
                              onClick={() => handleRemove(slot.id)}
                            >
                              {removingId === slot.id ? (
                                <Loader2Icon className="size-3 animate-spin" />
                              ) : (
                                <Trash2Icon className="size-3" />
                              )}
                              Remove
                            </Button>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}