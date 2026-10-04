"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { PlusIcon, ShieldBanIcon, UserRoundIcon } from "lucide-react";
import { manageCustomerAction } from "@/app/admin/customers/actions";
import type { AdminUserSearchRow } from "@/lib/admin";
import { Dialog, DialogContent, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

type Action = "credit" | "ban" | "unban" | "remove";
const titles = { credit: "Add tokens", ban: "Ban member", unban: "Remove ban", remove: "Remove account" };

export function AdminCustomersTable({ rows, canAdjust = false, canManage = false }: { rows: AdminUserSearchRow[]; canAdjust?: boolean; canManage?: boolean }) {
  const router = useRouter();
  const [selection, setSelection] = useState<{ row: AdminUserSearchRow; action: Action } | null>(null);
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();
  function open(row: AdminUserSearchRow, action: Action) { setError(""); setSelection({ row, action }); }
  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selection || pending) return;
    const form = new FormData(event.currentTarget);
    setError("");
    startTransition(async () => {
      try {
        const result = await manageCustomerAction({ userId: selection.row.id, action: selection.action, amount: Number(form.get("amount")), reason: String(form.get("reason") ?? "") });
        if (!result.ok) { setError(result.error); return; }
        toast.success(result.message); setSelection(null); router.refresh();
      } catch { setError("Could not confirm the change. Refresh before trying again."); }
    });
  }
  return <>
    <div className="space-y-3">
      {!rows.length ? <p className="border border-dashed border-border p-10 text-center text-sm text-muted-foreground">No members match your search.</p> : null}
      {rows.map(row => <article key={row.id} data-member-id={row.id} className="flex flex-wrap items-center gap-5 rounded-xl border border-border bg-card p-5">
        <div className="flex min-w-0 flex-1 basis-52 items-center gap-4"><span className="grid size-11 shrink-0 place-items-center rounded-full bg-muted text-gold-soft"><UserRoundIcon className="size-5" /></span><div className="min-w-0"><h2 className="truncate font-semibold">{row.display_name || "Member"}</h2><p className="mt-1 text-xs text-muted-foreground">{row.roles.join(" ? ")} ? Joined {new Date(row.created_at).toISOString().slice(0, 10)}</p><p className="mt-1 font-mono text-[10px] text-muted-foreground">{row.id}</p></div></div>
        <div className="flex gap-6 text-sm"><div><p className="text-xs text-muted-foreground">Tokens</p><p className="mt-1 font-semibold">{row.balance.toLocaleString()}</p></div><div><p className="text-xs text-muted-foreground">Orders</p><p className="mt-1">{row.bookings_count}</p></div></div>
        <span className={`rounded-full px-3 py-1 text-xs ${row.is_banned || row.soft_deleted_at ? "bg-destructive/10 text-destructive" : "bg-success/10 text-success"}`}>{row.soft_deleted_at ? "Removed" : row.is_banned ? "Banned" : "Active"}</span>
        <div className="flex w-full flex-wrap gap-2 border-t border-border pt-4">
          {canAdjust ? <Button size="sm" variant="outline" disabled={!!row.soft_deleted_at} onClick={() => open(row, "credit")}><PlusIcon /> Add tokens</Button> : null}
          {canManage ? <><Button size="sm" variant="outline" disabled={!!row.soft_deleted_at} onClick={() => open(row, row.is_banned ? "unban" : "ban")}><ShieldBanIcon />{row.is_banned ? "Remove ban" : "Ban member"}</Button><Button size="sm" variant="ghost" disabled={!!row.soft_deleted_at} onClick={() => open(row, "remove")}>Remove account</Button></> : null}
        </div>
      </article>)}
    </div>
    <Dialog open={!!selection} onOpenChange={open => { if (!open && !pending) setSelection(null); }}>
      <DialogContent showCloseButton={!pending} className="p-6 sm:max-w-md">
        <DialogTitle className="pr-5 font-heading text-2xl">{selection ? titles[selection.action] : "Manage member"}</DialogTitle>
        <DialogDescription>{selection?.row.display_name || "Member"} ? Current balance: {selection?.row.balance.toLocaleString()} tokens</DialogDescription>
        <form onSubmit={submit} className="space-y-5">
          {selection?.action === "credit" ? <><label className="block space-y-2 text-sm"><span>Tokens to add</span><Input name="amount" type="number" min={1} max={2147483647} step={1} required disabled={pending} autoFocus /></label><label className="block space-y-2 text-sm"><span>Reason</span><Textarea name="reason" minLength={10} maxLength={500} required disabled={pending} placeholder="Why are you adding these tokens?" /></label><p className="text-xs leading-5 text-muted-foreground">Tokens are available immediately. Your name and reason are recorded in the audit log.</p></> : <><p className="text-sm leading-6 text-muted-foreground">{selection?.action === "remove" ? "Remove this account from the member list. Orders and payment records are kept. Accounts with open orders or pending payments cannot be removed." : selection?.action === "ban" ? "Mark this member as banned? You can remove the ban later." : "Remove this member's ban?"}</p>{selection?.action === "ban" ? <label className="block space-y-2 text-sm"><span>Reason (optional)</span><Textarea name="reason" maxLength={500} disabled={pending} /></label> : null}</>}
          {error ? <p role="alert" className="rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">{error}</p> : null}
          <div className="flex justify-end gap-3"><Button variant="outline" type="button" disabled={pending} onClick={() => setSelection(null)}>Cancel</Button><Button type="submit" disabled={pending}>{pending ? "Saving?" : selection ? titles[selection.action] : "Save"}</Button></div>
        </form>
      </DialogContent>
    </Dialog>
  </>;
}
