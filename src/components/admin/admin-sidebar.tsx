"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboardIcon,
  UsersIcon,
  ListChecksIcon,
  ClipboardListIcon,
  MessageSquareIcon,
  ReceiptIcon,
  WalletIcon,
  BarChartIcon,
  ScrollTextIcon,
  SettingsIcon,
  CreditCardIcon,
} from "lucide-react";
import { Logo } from "@/components/brand/Logo";
import { cn } from "cn";

export type AdminRole = "support" | "finance" | "owner";

type Item = {
  label: string;
  href: string;
  icon: typeof LayoutDashboardIcon;
  /** Treat /admin as active only when path is exactly /admin, but
   *  child routes are matched on exact href rather than prefix. */
  exact?: boolean;
  /** Hide this item from non-owners; the page itself does its own
   *  role check anyway, this is purely a sidebar visibility helper. */
  roles: AdminRole[];
};

const items: Item[] = [
  { label: "Dashboard", href: "/admin", icon: LayoutDashboardIcon, exact: true, roles: ["support", "finance", "owner"] },
  { label: "Customers", href: "/admin/customers", icon: UsersIcon, roles: ["support", "owner"] },
  { label: "Sellers", href: "/admin/sellers", icon: ListChecksIcon, roles: ["support", "owner"] },
  { label: "Listings", href: "/admin/listings", icon: ClipboardListIcon, roles: ["support", "finance", "owner"] },
  { label: "Disputes", href: "/admin/disputes", icon: ScrollTextIcon, roles: ["support", "finance", "owner"] },
  { label: "Chat logs", href: "/admin/chats", icon: MessageSquareIcon, roles: ["support", "owner"] },
  { label: "Top-ups", href: "/admin/topups", icon: CreditCardIcon, roles: ["finance", "owner"] },
  { label: "Payouts", href: "/finance/payouts", icon: WalletIcon, roles: ["finance", "owner"] },
  { label: "Reports", href: "/admin/reports", icon: BarChartIcon, roles: ["support", "finance", "owner"] },
  { label: "Audit", href: "/admin/audit", icon: ReceiptIcon, roles: ["support", "finance", "owner"] },
  { label: "Settings", href: "/admin/settings", icon: SettingsIcon, roles: ["support", "owner"] },
];

const roleLabels: Record<AdminRole, string> = {
  support: "Support",
  finance: "Finance",
  owner: "Owner",
};

function visibleItems(roles: AdminRole[]): Item[] {
  return items.filter((it) => it.roles.some((r) => roles.includes(r)));
}

export function AdminSidebar({ roles }: { roles: AdminRole[] }) {
  const pathname = usePathname() ?? "";
  const list = visibleItems(roles);

  // Display the highest-privilege role for the badge.
  const badgeRole: AdminRole = roles.includes("owner")
    ? "owner"
    : roles.includes("finance")
    ? "finance"
    : "support";

  return (
    <aside
      aria-label="Admin navigation"
      className="hidden w-60 shrink-0 border-r border-border/70 bg-surface/40 px-4 py-6 md:flex md:flex-col"
    >
      <div className="mb-6 flex items-center gap-2">
        <Logo variant="mark" size="md" />
        <span className="text-xs tracking-wider text-muted-foreground uppercase">
          Admin
        </span>
      </div>

      <div className="mb-4 rounded-md border border-border/60 bg-background/40 px-3 py-2 text-xs">
        <div className="text-muted-foreground">Your role</div>
        <div className="font-medium text-gold">{roleLabels[badgeRole]}</div>
      </div>

      <nav className="flex flex-col gap-1">
        {list.map((item) => {
          const Icon = item.icon;
          const isActive = item.exact
            ? pathname === item.href
            : pathname === item.href || pathname.startsWith(`${item.href}/`);
          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={isActive ? "page" : undefined}
              className={cn(
                "flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors",
                isActive
                  ? "bg-gold/10 text-gold"
                  : "text-muted-foreground hover:bg-gold/5 hover:text-gold"
              )}
            >
              <Icon className="size-4 shrink-0" />
              <span>{item.label}</span>
            </Link>
          );
        })}
      </nav>
    </aside>
  );
}

export function AdminMobileNav({ roles }: { roles: AdminRole[] }) {
  const pathname = usePathname() ?? "";
  const list = visibleItems(roles);

  return (
    <nav
      aria-label="Admin navigation (mobile)"
      className="border-b border-border/70 bg-background/85 px-2 py-2 md:hidden"
    >
      <div className="flex items-center gap-3">
        <Logo variant="mark" size="sm" />
        <select
          aria-label="Admin section"
          className="flex h-9 w-full rounded-lg border border-input bg-transparent px-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
          value={
            list.find((i) =>
              i.exact
                ? pathname === i.href
                : pathname === i.href || pathname.startsWith(`${i.href}/`)
            )?.href ?? "/admin"
          }
          onChange={(e) => {
            window.location.href = e.target.value;
          }}
        >
          {list.map((item) => (
            <option key={item.href} value={item.href}>
              {item.label}
            </option>
          ))}
        </select>
      </div>
    </nav>
  );
}