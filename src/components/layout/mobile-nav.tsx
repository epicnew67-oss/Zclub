"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  CoinsIcon,
  CompassIcon,
  MessageCircleIcon,
  UserIcon,
} from "lucide-react";
import { cn } from "cn";

const items = [
  { label: "Browse", href: "/browse", icon: CompassIcon },
  { label: "Orders", href: "/orders", icon: MessageCircleIcon },
  { label: "Wallet", href: "/wallet", icon: CoinsIcon },
  { label: "You", href: "/account", icon: UserIcon },
];

/**
 * Authenticated bottom navigation. Rendered by the root layout ONLY
 * when there is a valid session — guests never see the app shell.
 */
export function MobileNav() {
  const pathname = usePathname();

  return (
    <nav
      aria-label="Primary"
      className="fixed inset-x-0 bottom-0 z-40 border-t border-border/70 bg-background/90 backdrop-blur-md md:hidden"
    >
      <div className="mx-auto grid max-w-md grid-cols-4 pb-[env(safe-area-inset-bottom)]">
        {items.map((item) => {
          const active = pathname === item.href;
          const Icon = item.icon;
          return (
            <Link
              key={item.label}
              href={item.href}
              aria-current={active ? "page" : undefined}
              className={cn(
                "flex min-h-14 flex-col items-center justify-center gap-1 px-1 py-2 text-[0.68rem] font-medium transition-colors",
                active ? "text-gold" : "text-muted-foreground hover:text-foreground"
              )}
            >
              <Icon className="size-5" />
              {item.label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
