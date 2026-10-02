"use client";

import { useTransition } from "react";
import { CheckIcon, Loader2Icon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { markAllNotificationsReadAction, markNotificationReadAction } from "@/app/notifications/actions";
import { useNotifications, type NotificationRow } from "@/hooks/use-notifications";

export function NotificationsList({ rows }: { rows: NotificationRow[] }) {
  const initialUnread = rows.filter((r) => !r.read_at).length;
  const { rows: live, unread, markLocalRead, markAllLocalRead } = useNotifications(rows, initialUnread);
  const [pending, startTransition] = useTransition();

  return (
    <div className="rounded-lg border border-border/70 bg-surface/40">
      <div className="flex items-center justify-between border-b border-border/60 px-4 py-3">
        <div className="text-sm text-muted-foreground">
          {live.length} total · {unread} unread
        </div>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          disabled={pending || unread === 0}
          onClick={() =>
            startTransition(async () => {
              const r = await markAllNotificationsReadAction();
              if (r.ok) markAllLocalRead();
            })
          }
        >
          {pending ? <Loader2Icon className="mr-1 h-3 w-3 animate-spin" /> : <CheckIcon className="mr-1 h-3 w-3" />}
          Mark all read
        </Button>
      </div>
      <ul>
        {live.length === 0 ? (
          <li className="px-4 py-12 text-center text-sm text-muted-foreground">
            You don&apos;t have any notifications yet.
          </li>
        ) : null}
        {live.map((r) => (
          <li
            key={r.id}
            className={`flex flex-col gap-1 border-b border-border/30 px-4 py-4 last:border-0 ${
              !r.read_at ? "bg-burgundy/5" : ""
            }`}
          >
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                {!r.read_at ? <span className="h-2 w-2 rounded-full bg-gold" aria-hidden="true" /> : null}
                <div className="text-sm font-medium">{r.title}</div>
              </div>
              <div className="text-xs text-muted-foreground">{new Date(r.created_at).toLocaleString()}</div>
            </div>
            {r.body ? <div className="text-sm text-muted-foreground">{r.body}</div> : null}
            <div className="mt-1 flex items-center justify-between gap-3">
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{r.type}</div>
              <div className="flex items-center gap-2">
                {!r.read_at ? (
                  <button
                    type="button"
                    disabled={pending}
                    onClick={() =>
                      startTransition(async () => {
                        const res = await markNotificationReadAction(r.id);
                        if (res.ok) markLocalRead(r.id);
                      })
                    }
                    className="text-xs text-muted-foreground hover:text-foreground disabled:opacity-40"
                  >
                    Mark read
                  </button>
                ) : null}
                {r.link ? (
                  <a href={r.link} className="text-xs text-gold hover:underline">
                    Open →
                  </a>
                ) : null}
              </div>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
