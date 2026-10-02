"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  LogOutIcon,
  Loader2Icon,
  ShoppingBagIcon,
  WalletIcon,
  StoreIcon,
  ShieldCheckIcon,
} from "lucide-react";
import { brand } from "@/lib/brand";
import { Logo } from "@/components/brand/Logo";
import { BalanceChip } from "@/components/wallet/balance-chip";
import { NotificationBell } from "@/components/notifications/notification-bell";
import type { NotificationRow } from "@/hooks/use-notifications";
import { createClient } from "@/lib/supabase/client";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export type NavbarUser = {
  email: string;
  displayName: string;
} | null;

const STAFF_ROLES = ["support", "finance", "owner"] as const;

export function Navbar({
  user,
  balance,
  walletId,
  notifications,
  unread,
  roles = [],
}: {
  user: NavbarUser;
  balance: number | null;
  walletId: string | null;
  notifications: NotificationRow[];
  unread: number;
  roles?: string[];
}) {
  const router = useRouter();
  const [signingOut, setSigningOut] = useState(false);

  async function handleSignOut() {
    if (!isSupabaseConfigured()) return;
    setSigningOut(true);
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push("/");
    router.refresh();
  }

  const initialBalance = typeof balance === "number" ? balance : 0;
  const isSeller = roles.includes("seller");
  const isStaff = roles.some((role) =>
    (STAFF_ROLES as readonly string[]).includes(role)
  );
  // "Become a seller" is a recruiting CTA — only for signed-in users who
  // are neither sellers already nor running the platform.
  const showBecomeSeller = Boolean(user) && !isSeller && !isStaff;

  return (
    <header className="sticky top-0 z-40 border-b border-border/70 bg-background/85 backdrop-blur-md">
      <div className="mx-auto flex h-16 max-w-6xl items-center gap-4 px-4 md:px-6">
        <Link href="/" aria-label={`${brand.name} — home`} className="shrink-0">
          <Logo size="md" />
        </Link>

        <nav className="ml-4 hidden items-center gap-6 text-sm font-medium text-muted-foreground md:flex">
          <Link
            href="/browse"
            prefetch
            className="transition-colors hover:text-gold"
          >
            Browse
          </Link>
          <Link href="/orders" prefetch className="inline-flex items-center gap-1.5 transition-colors hover:text-gold">
            <ShoppingBagIcon className="size-4" /> My orders
          </Link>
          {user ? (
            <Link
              href="/wallet"
              prefetch
              className="transition-colors hover:text-gold"
            >
              Wallet
            </Link>
          ) : null}
          {isSeller ? (
            <Link
              href="/seller"
              prefetch
              className="transition-colors hover:text-gold"
            >
              Seller studio
            </Link>
          ) : null}
          {showBecomeSeller ? (
            <Link href="/become-a-seller" className="transition-colors hover:text-gold">
              Become a seller
            </Link>
          ) : null}
          {isStaff ? (
            <Link
              href="/admin"
              prefetch
              className="inline-flex items-center gap-1.5 text-gold transition-colors hover:text-gold-soft"
            >
              <ShieldCheckIcon className="size-4" />
              Admin panel
            </Link>
          ) : null}
        </nav>

        <div className="ml-auto flex items-center gap-3">
          {user ? (
            <>
              <BalanceChip
                walletId={walletId}
                initialBalance={initialBalance}
                signedIn
              />
              <NotificationBell
                initialRows={notifications}
                initialUnread={unread}
                isSeller={isSeller}
              />

              <DropdownMenu>
                <DropdownMenuTrigger
                  aria-label="Account menu"
                  className="rounded-full outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
                >
                  <Avatar>
                    <AvatarFallback className="bg-gold/15 text-gold">
                      {(user.displayName || user.email)
                        .slice(0, 2)
                        .toUpperCase()}
                    </AvatarFallback>
                  </Avatar>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-56">
                  <DropdownMenuLabel className="max-w-full truncate">
                    {user.email}
                  </DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem asChild>
                    <Link href="/account">My account</Link>
                  </DropdownMenuItem>
                  <DropdownMenuItem asChild>
                    <Link href="/wallet">
                      <WalletIcon data-icon="inline-start" /> Wallet
                    </Link>
                  </DropdownMenuItem>
                  {isSeller ? (
                    <DropdownMenuItem asChild>
                      <Link href="/seller">
                        <StoreIcon data-icon="inline-start" /> Seller studio
                      </Link>
                    </DropdownMenuItem>
                  ) : null}
                  {showBecomeSeller ? (
                    <DropdownMenuItem asChild>
                      <Link href="/become-a-seller">Become a seller</Link>
                    </DropdownMenuItem>
                  ) : null}
                  {isStaff ? (
                    <DropdownMenuItem asChild>
                      <Link href="/admin">
                        <ShieldCheckIcon data-icon="inline-start" /> Admin panel
                      </Link>
                    </DropdownMenuItem>
                  ) : null}
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    disabled={signingOut}
                    onSelect={(event) => {
                      event.preventDefault();
                      handleSignOut();
                    }}
                  >
                    {signingOut ? (
                      <Loader2Icon data-icon="inline-start" className="animate-spin" />
                    ) : (
                      <LogOutIcon data-icon="inline-start" />
                    )}
                    Sign out
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </>
          ) : (
            // Guest state — real buttons instead of a fake avatar, so an
            // unauthenticated visitor never sees a logged-in-looking
            // chip. Server-rendered from the session (no flash).
            <>
              <Button asChild variant="outline" className="border-gold/50 text-gold hover:border-gold hover:bg-gold/10">
                <Link href="/auth/sign-in">Sign in</Link>
              </Button>
              <Button asChild className="hidden bg-burgundy text-foreground shadow-glow hover:bg-burgundy/90 sm:inline-flex">
                <Link href="/auth/sign-up">Join now</Link>
              </Button>
            </>
          )}
        </div>
      </div>
    </header>
  );
}
