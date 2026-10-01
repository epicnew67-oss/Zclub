"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { CheckIcon, Loader2Icon, XIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";
import type { AdminApplicationRow } from "@/lib/seller";
import {
  approveSellerApplicationAction,
  rejectSellerApplicationAction,
} from "@/app/admin/sellers/actions";

function AdminCard({ app }: { app: AdminApplicationRow }) {
  const router = useRouter();
  const [approving, setApproving] = useState(false);
  const [rejecting, setRejecting] = useState(false);
  const [rejectReason, setRejectReason] = useState("");
  const [approveNote, setApproveNote] = useState("");

  async function handleApprove() {
    setApproving(true);
    try {
      const result = await approveSellerApplicationAction(
        app.id,
        approveNote.trim() || null
      );
      if (!result.ok) throw new Error(result.error);
      toast.success("Application approved — seller profile live.");
      setApproveNote("");
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Approve failed.");
    } finally {
      setApproving(false);
    }
  }

  async function handleReject() {
    if (rejectReason.trim().length < 10) {
      toast.error("Rejection reason must be at least 10 characters.");
      return;
    }
    setRejecting(true);
    try {
      const result = await rejectSellerApplicationAction(app.id, rejectReason.trim());
      if (!result.ok) throw new Error(result.error);
      toast.success("Application rejected — buyer notified.");
      setRejectReason("");
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Reject failed.");
    } finally {
      setRejecting(false);
    }
  }

  return (
    <Card variant="glow" className="overflow-hidden">
      <CardHeader>
        <div className="flex items-start justify-between gap-3">
          <div className="space-y-1">
            <CardTitle className="flex items-center gap-2 text-base">
              <span className="font-heading text-gold">{app.display_name}</span>
              <Badge variant="gold-outline" className="capitalize">
                {app.gender?.replace("_", " ")}
              </Badge>
              <Badge variant="outline">Attempt {app.attempt_number} of 3</Badge>
            </CardTitle>
            <p className="text-xs text-muted-foreground">
              {new Date(app.created_at).toLocaleString()} · {app.user_email}
            </p>
          </div>
          <Badge
            variant={
              app.status === "pending"
                ? "default"
                : app.status === "approved"
                  ? "success"
                  : "destructive"
            }
            className="capitalize"
          >
            {app.status}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {app.avatar_url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={app.avatar_url}
            alt={app.display_name ?? "Applicant"}
            className="h-32 w-32 rounded-2xl border border-gold/30 object-cover"
          />
        ) : (
          <div className="flex h-20 w-20 items-center justify-center rounded-2xl border border-gold/20 bg-muted/20 text-xs text-muted-foreground">
            No photo
          </div>
        )}

        <div>
          <p className="text-xs tracking-wider text-muted-foreground uppercase">Offering</p>
          <p className="mt-1 text-sm text-foreground">{app.offering ?? "—"}</p>
        </div>

        <div className="grid gap-2 text-xs sm:grid-cols-2">
          <div>
            <span className="text-muted-foreground">Terms:</span> {app.terms_version ?? "—"}
          </div>
          <div>
            <span className="text-muted-foreground">Terms IP:</span> {app.terms_ip ?? "—"}
          </div>
        </div>

        {app.status === "rejected" && app.review_note ? (
          <div className="rounded-xl border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
            <span className="font-medium">Rejection reason:</span> {app.review_note}
          </div>
        ) : null}

        {app.status === "pending" ? (
          <>
            <Separator />
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor={`approve-note-${app.id}`}>Approve note (optional)</Label>
                <Input
                  id={`approve-note-${app.id}`}
                  value={approveNote}
                  onChange={(e) => setApproveNote(e.target.value)}
                  placeholder="Welcome note"
                  disabled={approving || rejecting}
                />
                <Button
                  size="sm"
                  className="w-full bg-burgundy text-foreground hover:bg-burgundy/90 shadow-glow"
                  onClick={handleApprove}
                  disabled={approving || rejecting}
                >
                  {approving ? <Loader2Icon className="size-4 animate-spin" /> : <CheckIcon className="size-4" />}
                  Approve
                </Button>
              </div>
              <div className="space-y-2">
                <Label htmlFor={`reject-${app.id}`}>Rejection reason *</Label>
                <Textarea
                  id={`reject-${app.id}`}
                  value={rejectReason}
                  onChange={(e) => setRejectReason(e.target.value)}
                  placeholder="At least 10 characters — buyer will see this."
                  rows={2}
                  disabled={approving || rejecting}
                />
                <Button
                  size="sm"
                  variant="destructive"
                  className="w-full"
                  onClick={handleReject}
                  disabled={approving || rejecting}
                >
                  {rejecting ? <Loader2Icon className="size-4 animate-spin" /> : <XIcon className="size-4" />}
                  Reject
                </Button>
              </div>
            </div>
          </>
        ) : null}
      </CardContent>
    </Card>
  );
}

export function SellerAdminQueue({
  pending,
  history,
}: {
  pending: AdminApplicationRow[];
  history: AdminApplicationRow[];
}) {
  return (
    <div className="space-y-6">
      {pending.length === 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>Queue empty</CardTitle>
            <p className="text-sm text-muted-foreground">No pending applications. The rest of the queue is below.</p>
          </CardHeader>
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {pending.map((app) => (
            <AdminCard key={app.id} app={app} />
          ))}
        </div>
      )}

      {history.length > 0 ? (
        <div className="space-y-3">
          <h2 className="font-heading text-lg text-foreground">History</h2>
          <div className="grid gap-4 md:grid-cols-2">
            {history.slice(0, 20).map((app) => (
              <AdminCard key={app.id} app={app} />
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}