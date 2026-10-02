"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboardIcon,
  ListChecksIcon,
  ShoppingBagIcon,
  UserCircleIcon,
  WalletIcon,
} from "lucide-react";
import { Logo } from "@/components/brand/Logo";
import { cn } from "cn";

type Item = {
  label: string;
  href: string;
  icon: typeof LayoutDashboardIcon;
  /** Treat /seller as active when path is exactly /seller, but the
   *  child routes (/seller/listings, /seller/availability, …) are
   *  matched on exact href rather than prefix. */
  exact?: boolean;
};

const items: Item[] = [
  { label: "Dashboard", href: "/seller", icon: LayoutDashboardIcon, exact: true },
  { label: "Listings", href: "/seller/listings", icon: ListChecksIcon },
  { label: "Orders", href: "/seller/orders", icon: ShoppingBagIcon },
  { label: "Wallet", href: "/wallet", icon: WalletIcon },
  { label: "Profile", href: "/seller/profile", icon: UserCircleIcon },
];

export function SellerSidebar() {
  const pathname = usePathname() ?? "";

  return (
    <aside
      aria-label="Seller navigation"
      className="hidden w-60 shrink-0 border-r border-border/70 bg-surface/40 px-4 py-6 md:flex md:flex-col"
    >
      <div className="mb-6 flex items-center gap-2">
        <Logo variant="mark" size="md" />
        <span className="text-xs tracking-wider text-muted-foreground uppercase">
          Seller
        </span>
      </div>

      <nav className="flex flex-col gap-1">
        {items.map((item) => {
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

export function SellerMobileNav() {
  const pathname = usePathname() ?? "";
  return (
    <nav
      aria-label="Seller navigation (mobile)"
      className="border-b border-border/70 bg-background/85 px-2 py-2 md:hidden"
    >
      <div className="flex items-center gap-3">
        <Logo variant="mark" size="sm" />
        <select
          aria-label="Seller section"
          className="flex h-9 w-full rounded-lg border border-input bg-transparent px-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
          value={
            items.find((i) =>
              i.exact ? pathname === i.href : pathname === i.href || pathname.startsWith(`${i.href}/`)
            )?.href ?? "/seller"
          }
          onChange={(e) => {
            window.location.href = e.target.value;
          }}
        >
          {items.map((item) => (
            <option key={item.href} value={item.href}>
              {item.label}
            </option>
          ))}
        </select>
      </div>
    </nav>
  );
}
