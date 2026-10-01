import { requireUser } from "@/lib/auth";
import { listChatLogBookings } from "@/lib/admin";
import { AdminChatLogBrowser } from "@/components/admin/admin-chat-log-browser";

export const metadata = { title: "Admin · Chat logs" };

export default async function AdminChatsPage() {
  await requireUser("/admin/chats");
  const data = await listChatLogBookings().catch(() => ({ rows: [], retention_days: 90 }));
  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-8 md:px-6 md:py-10">
      <header className="mb-6">
        <h1 className="font-heading text-3xl font-semibold">
          Chat <span className="text-gold">logs</span>
        </h1>
        <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
          Read-only access to messages for completed / disputed / cancelled / no-show bookings,
          inside the {data.retention_days}-day retention window. Every view requires a reason (≥10
          chars) and writes an audit row.
        </p>
      </header>

      <AdminChatLogBrowser bookings={data.rows} retentionDays={data.retention_days} />
    </div>
  );
}