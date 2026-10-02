"use client";

import { CircleCheck, Info, TriangleAlert, CircleAlert, X } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

type Variant = "success" | "info" | "warning" | "error";
const config = {
  success: { icon: CircleCheck, accent: "text-success" },
  info: { icon: Info, accent: "text-foreground" },
  warning: { icon: TriangleAlert, accent: "text-warning" },
  error: { icon: CircleAlert, accent: "text-destructive" },
};

export function notificationAlert(input: { variant: Variant; title: string; body?: string | null; link?: string | null }) {
  const { icon: Icon, accent } = config[input.variant];
  toast.custom((id) => <div role="status" className="flex w-[min(22rem,calc(100vw-2rem))] items-start gap-3 rounded-lg border border-border bg-background p-4 text-foreground shadow-xl">
    <Icon className={cn("mt-0.5 size-5 shrink-0", accent)} aria-hidden="true" />
    <div className="min-w-0 flex-1 space-y-1"><p className="text-sm font-semibold">{input.title}</p>{input.body ? <p className="text-xs leading-relaxed text-muted-foreground">{input.body}</p> : null}{input.link ? <a href={input.link} className="inline-block pt-1 text-xs font-semibold text-gold hover:underline">View details</a> : null}</div>
    <button type="button" onClick={() => toast.dismiss(id)} aria-label="Dismiss" className="shrink-0 text-muted-foreground hover:text-foreground"><X className="size-4" /></button>
  </div>, { duration: 8000 });
}
