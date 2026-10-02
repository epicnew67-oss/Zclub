"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { saveTimeZoneAction } from "@/app/account/actions";
import { TimeZoneSelect, resolvedTimeZone } from "@/components/time-zone-select";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useHydrated } from "@/hooks/use-hydrated";

export function TimeZoneSettings({ initialTimeZone }: { initialTimeZone: string | null }) {
  const router = useRouter();
  const hydrated = useHydrated();
  const [choice, setChoice] = useState(initialTimeZone ?? "detect");
  const [pending, startTransition] = useTransition();
  return (
    <Card className="mt-4">
      <CardHeader><CardTitle>Region and time zone</CardTitle><CardDescription>Call times and seller slots use this time zone, even when your device is set to another region.</CardDescription></CardHeader>
      <CardContent className="flex flex-col gap-3 sm:flex-row sm:items-end">
        <div className="min-w-0 flex-1 space-y-2"><Label htmlFor="account-time-zone">Your time zone</Label><TimeZoneSelect id="account-time-zone" value={choice} onChange={setChoice} disabled={pending} /></div>
        <Button type="button" disabled={pending || !hydrated} onClick={() => startTransition(async () => {
          const result = await saveTimeZoneAction(resolvedTimeZone(choice));
          if (result.ok) { toast.success("Time zone saved."); router.refresh(); }
          else toast.error(result.error);
        })}>Save time zone</Button>
      </CardContent>
    </Card>
  );
}
