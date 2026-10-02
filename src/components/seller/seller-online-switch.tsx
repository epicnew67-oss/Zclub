"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useGSAP } from "@gsap/react";
import gsap from "gsap";
import { toast } from "sonner";
import { createClient } from "@/lib/supabase/client";

gsap.registerPlugin(useGSAP);

export function SellerOnlineSwitch({ initialOnline }: { initialOnline: boolean }) {
  const router = useRouter();
  const [online, setOnline] = useState(initialOnline);
  const [busy, setBusy] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const thumb = useRef<HTMLSpanElement>(null);
  const first = useRef(true);

  useGSAP(() => {
    if (!thumb.current) return;
    const x = online ? 28 : 0;
    if (first.current || window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      gsap.set(thumb.current, { x });
      first.current = false;
    } else {
      gsap.to(thumb.current, { x, duration: 0.28, ease: "power3.out", overwrite: "auto" });
    }
  }, { scope: root, dependencies: [online] });

  async function toggle() {
    if (busy) return;
    setBusy(true);
    const next = !online;
    const { error } = await createClient().rpc("set_seller_online", { _online: next });
    setBusy(false);
    if (error) {
      toast.error("Could not change your online status. Try again.");
      return;
    }
    setOnline(next);
    toast.success(next ? "You are online. Buyers can book now." : "You are offline. New bookings are paused.");
    router.refresh();
  }

  return (
    <div ref={root} className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-gold/25 bg-surface/60 px-5 py-4">
      <div className="space-y-1">
        <p className="text-sm font-semibold text-foreground">Your availability</p>
        <p className="text-xs text-muted-foreground">
          {online ? "Online · buyers can book while this browser stays open." : "Offline · buyers cannot book you."}
        </p>
      </div>
      <button type="button" role="switch" aria-label="Online status" aria-checked={online} onClick={toggle} disabled={busy}
        className="flex items-center gap-3 rounded-full outline-none focus-visible:ring-2 focus-visible:ring-gold disabled:opacity-60">
        <span className={`relative h-8 w-[60px] rounded-full border transition-colors ${online ? "border-success/50 bg-success/25" : "border-border bg-muted/60"}`}>
          <span ref={thumb} className={`absolute left-[3px] top-[3px] size-6 rounded-full ${online ? "bg-success" : "bg-muted-foreground"}`} />
        </span>
        <span className={`min-w-12 text-sm font-semibold ${online ? "text-success" : "text-muted-foreground"}`}>{online ? "Online" : "Offline"}</span>
      </button>
    </div>
  );
}
