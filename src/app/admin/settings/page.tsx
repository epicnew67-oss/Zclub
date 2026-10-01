import { requireUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import {
  getAllSettings,
  listAnnouncements,
  listBanners,
  listCategories,
  listTokenPacks,
  getPaymentDetails,
} from "@/lib/admin";
import { AdminSettingsConsole } from "@/components/admin/admin-settings-console";

export const metadata = { title: "Admin · Settings" };

export default async function AdminSettingsPage() {
  await requireUser("/admin/settings");

  // The settings RPC returns is_money flags but doesn't expose the
  // caller's role; do that here so the UI can hide the owner-only
  // controls for non-owners.
  const supabase = await createClient();
  const [{ data: isOwner }, settings, banners, announcements, categories, tokenPacks, payment] =
    await Promise.all([
      supabase.rpc("user_has_role", { _role: "owner" }),
      getAllSettings().catch(() => []),
      listBanners().catch(() => []),
      listAnnouncements().catch(() => []),
      listCategories().catch(() => []),
      listTokenPacks().catch(() => []),
      getPaymentDetails().catch(() => ({ jazzcash: {}, easypaisa: {} })),
    ]);

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-8 md:px-6 md:py-10">
      <header className="mb-6">
        <h1 className="font-heading text-3xl font-semibold">
          Website <span className="text-gold">settings</span>
        </h1>
        <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
          Categories, banners, announcements, token packs, payment details, and global settings.
          Money values (commission, payout minimum, token rate, payment rates, JazzCash / Easypaisa)
          are owner-only and every edit writes an audit row.
        </p>
      </header>

      <AdminSettingsConsole
        isOwner={!!isOwner}
        settings={settings}
        banners={banners}
        announcements={announcements}
        categories={categories}
        tokenPacks={tokenPacks}
        payment={payment}
      />
    </div>
  );
}