import Link from "next/link";
import { LocalDateTime } from "@/components/local-date-time";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export type TopupHistoryRow = {
  id: string;
  method: "crypto" | "jazzcash" | "easypaisa";
  tokens: number;
  status: "pending" | "completed" | "failed" | "expired";
  created_at: string;
};

const methodLabel = { crypto: "Crypto", jazzcash: "JazzCash", easypaisa: "Easypaisa" };
const statusLabel = { pending: "Pending", completed: "Complete", failed: "Failed", expired: "Expired" };

export function TopupHistory({ rows }: { rows: TopupHistoryRow[] }) {
  if (rows.length === 0) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Recent top-up payments</CardTitle>
        <CardDescription>Check whether your token purchases have completed.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-2">
        {rows.map((row) => (
          <Link
            key={row.id}
            href={`/wallet/topup/status?id=${encodeURIComponent(row.id)}`}
            className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border/70 p-3 transition-colors hover:bg-muted/30"
          >
            <div className="min-w-0">
              <p className="text-sm font-medium">{row.tokens.toLocaleString("en-US")} tokens · {methodLabel[row.method] ?? row.method}</p>
              <span className="text-xs text-muted-foreground"><LocalDateTime value={row.created_at} /></span>
            </div>
            <Badge variant={row.status === "completed" ? "success" : row.status === "failed" ? "destructive" : "outline"}>
              {statusLabel[row.status] ?? row.status}
            </Badge>
          </Link>
        ))}
      </CardContent>
    </Card>
  );
}
