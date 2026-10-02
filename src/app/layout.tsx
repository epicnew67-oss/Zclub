import type { Metadata, Viewport } from "next";
import { Inter, Playfair_Display } from "next/font/google";
import "./globals.css";
import { brand } from "@/lib/brand";
import { createClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { BrandStyle } from "@/components/brand/brand-style";
import { LoadingScreen } from "@/components/layout/loading-screen";
import { Navbar, type NavbarUser } from "@/components/layout/navbar";
import { FloatingNavbar } from "@/components/layout/floating-navbar";
import { Footer } from "@/components/layout/footer";
import { MobileNav } from "@/components/layout/mobile-nav";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ServiceWorkerRegistrar } from "@/components/pwa/service-worker-registrar";
import { TimeZoneProvider } from "@/components/time-zone-provider";
import type { NotificationRow } from "@/lib/notifications";
import { NavigationSkeleton } from "@/components/layout/navigation-skeleton";
import { isSafeImagePath } from "@/lib/safe-image-path";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  display: "swap",
});

const playfair = Playfair_Display({
  subsets: ["latin"],
  variable: "--font-playfair",
  display: "swap",
});

async function getNavbarSession(): Promise<{
  user: NavbarUser;
  balance: number | null;
  walletId: string | null;
  notifications: NotificationRow[];
  unread: number;
  roles: string[];
  timeZone: string | null;
}> {
  if (!isSupabaseConfigured()) {
    return { user: null, balance: null, walletId: null, notifications: [], unread: 0, roles: [], timeZone: null };
  }
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return { user: null, balance: null, walletId: null, notifications: [], unread: 0, roles: [], timeZone: null };

    const email = user.email ?? "unknown";
    const [profileResult, balanceResult, walletResult, rowsResult, unreadResult, rolesResult] = await Promise.all([
      supabase
        .from("profiles")
        .select("display_name, time_zone, avatar_url")
        .eq("id", user.id)
        .single(),
      supabase.rpc("get_own_wallet_balance"),
      supabase.from("wallets").select("id").eq("user_id", user.id).maybeSingle(),
      supabase
        .from("notifications")
        .select("id, type, title, body, link, read_at, created_at")
        .eq("user_id", user.id)
        .order("created_at", { ascending: false })
        .limit(15),
      supabase
        .from("notifications")
        .select("id", { count: "exact", head: true })
        .eq("user_id", user.id)
        .is("read_at", null),
      supabase.from("user_roles").select("role").eq("user_id", user.id),
    ]);

    const avatarPath = profileResult.data?.avatar_url;
    const avatarUrl = isSafeImagePath(avatarPath)
      ? (await supabase.storage.from("seller-avatars").createSignedUrl(avatarPath, 600)).data?.signedUrl ?? null
      : null;

    return {
      user: {
        email,
        displayName: profileResult.data?.display_name?.trim() || email.split("@")[0],
        avatarUrl,
      },
      balance: typeof balanceResult.data === "number" ? balanceResult.data : 0,
      walletId: walletResult.data?.id ?? null,
      notifications: (rowsResult.data ?? []) as NotificationRow[],
      unread: unreadResult.count ?? 0,
      roles: ((rolesResult.data ?? []) as Array<{ role: string }>).map((row) => row.role),
      timeZone: profileResult.data?.time_zone ?? null,
    };
  } catch {
    return { user: null, balance: null, walletId: null, notifications: [], unread: 0, roles: [], timeZone: null };
  }
}

export const metadata: Metadata = {
  title: {
    default: brand.name,
    template: `%s | ${brand.name}`,
  },
  description: brand.description,
  manifest: brand.pwa.manifest,
  applicationName: brand.name,
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: brand.name,
  },
  icons: {
    icon: [
      { url: brand.logo.favicon, sizes: "any", type: "image/svg+xml" },
      { url: brand.logo.icon192, sizes: "192x192", type: "image/svg+xml" },
      { url: brand.logo.icon512, sizes: "512x512", type: "image/svg+xml" },
    ],
    apple: [{ url: brand.logo.appleTouchIcon, sizes: "any", type: "image/svg+xml" }],
  },
  formatDetection: { telephone: false },
};

export const viewport: Viewport = {
  themeColor: brand.pwa.themeColor,
  width: "device-width",
  initialScale: 1,
  maximumScale: 5,
};

export default async function RootLayout({ children }: LayoutProps<"/">) {
  const { user, balance, walletId, notifications, unread, roles, timeZone } = await getNavbarSession();

  return (
    <html
      lang="en"
      className={`${inter.variable} ${playfair.variable} dark h-full antialiased`}
    >
      <body className="flex min-h-full flex-col">
        <BrandStyle />
        <TimeZoneProvider value={timeZone}>
        <TooltipProvider delayDuration={200}>
          <LoadingScreen />
          <NavigationSkeleton />
          {/* Logged-in users keep the full header (balance chip +
              notifications + avatar + dropdown). Guests get the
              premium floating pill so the public homepage reads as
              art-directed rather than as a dashboard chrome. */}
          {user ? (
            <Navbar
              user={user}
              balance={balance}
              walletId={walletId}
              notifications={notifications}
              unread={unread}
              roles={roles}
            />
          ) : (
            <FloatingNavbar />
          )}
          <main className="flex-1">{children}</main>
          <Footer />
          {/* Authenticated app shell only — guests never see the
              bottom navigation (Browse / Orders / Wallet / You). */}
          {user ? (
            <>
              <div aria-hidden="true" className="h-14 md:hidden" />
              <MobileNav />
            </>
          ) : null}
        </TooltipProvider>
        </TimeZoneProvider>
        <Toaster position="top-center" />
        <ServiceWorkerRegistrar />
      </body>
    </html>
  );
}
