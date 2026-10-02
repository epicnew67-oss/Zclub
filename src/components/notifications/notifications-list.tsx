"use client";

import { useTransition } from "react";
import { CheckIcon, Loader2Icon } from "lucide-react";
import { markAllNotificationsReadAction, markNotificationReadAction } from "@/app/notifications/actions";
import { useNotifications, type NotificationRow } from "@/hooks/use-notifications";
import { LocalDateTime } from "@/components/local-date-time";
import { safeRedirectPath } from "@/lib/safe-redirect";

export function NotificationsList({ rows }: { rows: NotificationRow[] }) {
  const initialUnread = rows.filter((row) => !row.read_at).length;
  const { rows: live, unread, markLocalRead, markAllLocalRead } = useNotifications(rows, initialUnread);
  const [pending, startTransition] = useTransition();

  return (
    <div className="overflow-hidden rounded-xl border border-border bg-background">
      <div className="flex items-center justify-between gap-3 border-b border-border px-5 py-4">
        <p className="text-sm font-medium text-foreground">{unread ? `${unread} unread` : "All caught up"}</p>
        <button type="button" disabled={pending || unread === 0} onClick={() => startTransition(async () => {
          const result = await markAllNotificationsReadAction();
          if (result.ok) markAllLocalRead();
        })} className="inline-flex items-center gap-1.5 text-sm font-medium text-gold disabled:opacity-40">
          {pending ? <Loader2Icon className="size-4 animate-spin" /> : <CheckIcon className="size-4" />}
          Mark all read
        </button>
      </div>
      <ul className="divide-y divide-border/70">
        {live.length === 0 ? <li className="px-5 py-12 text-center text-sm text-muted-foreground">You don&apos;t have any notifications yet.</li> : null}
        {live.map((row) => (
          <li key={row.id} className={`border-l-[3px] px-5 py-5 ${row.read_at ? "border-l-transparent" : "border-l-gold bg-gold/5"}`}>
            <div className="flex items-start justify-between gap-3">
              <h2 className="min-w-0 text-base font-semibold leading-snug text-foreground">{row.title}</h2>
              {!row.read_at ? <span className="shrink-0 rounded bg-gold/15 px-2 py-0.5 text-xs font-medium text-gold">New</span> : null}
            </div>
            {row.body ? <p className="mt-2 whitespace-normal break-words text-sm leading-relaxed text-foreground/85">{row.body}</p> : null}
            <p className="mt-2 text-xs text-muted-foreground"><LocalDateTime value={row.created_at} /></p>
            <div className="mt-3 flex items-center gap-5">
              {row.link ? <a href={safeRedirectPath(row.link, "/notifications")} className="text-sm font-medium text-gold hover:underline">{row.type === "booking" ? "View booking" : "Open"}</a> : null}
              {!row.read_at ? <button type="button" disabled={pending} onClick={() => startTransition(async () => {
                const result = await markNotificationReadAction(row.id);
                if (result.ok) markLocalRead(row.id);
              })} className="text-sm text-muted-foreground hover:text-foreground disabled:opacity-40">Mark read</button> : null}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
