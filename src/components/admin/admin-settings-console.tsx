"use client";

import { useState, useTransition } from "react";
import type {
  AdminAnnouncementRow,
  AdminBannerRow,
  AdminCategoryRow,
  AdminSettingRow,
  AdminTokenPackRow,
} from "@/lib/admin";
import {
  createAnnouncementAction,
  createBannerAction,
  deleteAnnouncementAction,
  deleteBannerAction,
  setCategoryActiveAction,
  setSettingAction,
  setTokenPackActiveAction,
  setTokenPackPriceAction,
  toggleAnnouncementAction,
  toggleBannerAction,
  updateAnnouncementAction,
  updateBannerAction,
  updateCategoryNameAction,
  updatePaymentDetailsAction,
} from "@/app/admin/settings/actions";
import { PaymentQrUploader } from "@/components/admin/payment-qr-uploader";

type Tab = "general" | "categories" | "banners" | "announcements" | "token_packs" | "payment" | "money";

export function AdminSettingsConsole({
  isOwner,
  settings,
  banners,
  announcements,
  categories,
  tokenPacks,
  payment,
}: {
  isOwner: boolean;
  settings: AdminSettingRow[];
  banners: AdminBannerRow[];
  announcements: AdminAnnouncementRow[];
  categories: AdminCategoryRow[];
  tokenPacks: AdminTokenPackRow[];
  payment: { jazzcash: Record<string, unknown>; easypaisa: Record<string, unknown> };
}) {
  const [tab, setTab] = useState<Tab>("general");

  const tabs: { id: Tab; label: string }[] = [
    { id: "general", label: "General" },
    { id: "categories", label: "Categories" },
    { id: "banners", label: "Banners" },
    { id: "announcements", label: "Announcements" },
    { id: "token_packs", label: "Token packs" },
    { id: "payment", label: "Payment" },
    ...(isOwner ? [{ id: "money" as Tab, label: "Money" }] : []),
  ];

  return (
    <div>
      <div className="mb-4 flex flex-wrap gap-1 border-b border-border/60">
        {tabs.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            aria-current={tab === t.id ? "page" : undefined}
            className={`border-b-2 px-3 py-2 text-sm transition-colors ${
              tab === t.id
                ? "border-gold text-gold"
                : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === "general" ? <GeneralTab settings={settings} /> : null}
      {tab === "categories" ? <CategoriesTab categories={categories} /> : null}
      {tab === "banners" ? <BannersTab banners={banners} /> : null}
      {tab === "announcements" ? <AnnouncementsTab announcements={announcements} /> : null}
      {tab === "token_packs" ? <TokenPacksTab packs={tokenPacks} isOwner={isOwner} /> : null}
      {tab === "payment" ? <PaymentTab payment={payment} isOwner={isOwner} /> : null}
      {tab === "money" && isOwner ? <MoneyTab settings={settings.filter((s) => s.is_money)} /> : null}
    </div>
  );
}

function useServerSubmit() {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const onSubmit = (fn: () => Promise<{ ok: boolean; code?: string }>) => {
    setError(null);
    startTransition(async () => {
      const res = await fn();
      if (!res.ok) setError(res.code ?? "error");
    });
  };
  return { isPending, error, onSubmit, setError };
}

function GeneralTab({ settings }: { settings: AdminSettingRow[] }) {
  const nonMoney = settings.filter((s) => !s.is_money);
  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Non-money settings. Money keys (commission / payout_min_tokens / token_rate / payment_rates
        / JazzCash / Easypaisa) are owner-only.
      </p>
      <ul className="divide-y divide-border/40 rounded-lg border border-border/70 bg-surface/40">
        {nonMoney.map((s) => (
          <SettingRow key={s.key} setting={s} />
        ))}
      </ul>
    </div>
  );
}

function SettingRow({ setting }: { setting: AdminSettingRow }) {
  const [editing, setEditing] = useState(false);
  const [valueText, setValueText] = useState(JSON.stringify(setting.value));
  const { isPending, error, onSubmit } = useServerSubmit();

  return (
    <li className="px-4 py-3">
      <div className="flex items-center justify-between">
        <div>
          <div className="font-mono text-sm">{setting.key}</div>
          <div className="text-xs text-muted-foreground">
            {setting.is_money ? "money key · owner only" : "support + owner"}
          </div>
        </div>
        {!editing ? (
          <button
            type="button"
            onClick={() => setEditing(true)}
            disabled={setting.is_money}
            className="rounded border border-border/60 px-2 py-1 text-xs hover:border-gold/40 disabled:opacity-40"
          >
            Edit
          </button>
        ) : (
          <button
            type="button"
            onClick={() => {
              setEditing(false);
              setValueText(JSON.stringify(setting.value));
            }}
            className="rounded border border-border/60 px-2 py-1 text-xs hover:border-gold/40"
          >
            Cancel
          </button>
        )}
      </div>
      {editing ? (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            let parsed: unknown;
            try {
              parsed = JSON.parse(valueText);
            } catch {
              setValueText(JSON.stringify(setting.value));
              return;
            }
            onSubmit(async () => {
              const r = await setSettingAction(setting.key, parsed as Record<string, unknown>);
              if (r.ok) setEditing(false);
              return r;
            });
          }}
          className="mt-2 space-y-2"
        >
          <textarea
            value={valueText}
            onChange={(e) => setValueText(e.target.value)}
            rows={4}
            className="w-full rounded border border-input bg-transparent px-3 py-2 font-mono text-xs outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
          />
          <div className="flex gap-2">
            <button
              type="submit"
              disabled={isPending}
              className="rounded border border-gold/30 bg-gold/10 px-3 py-1 text-xs text-gold hover:bg-gold/20 disabled:opacity-40"
            >
              Save
            </button>
            {error ? <span className="text-xs text-destructive">{error}</span> : null}
          </div>
        </form>
      ) : (
        <pre className="mt-2 max-w-full overflow-x-auto rounded bg-background/40 p-2 font-mono text-xs text-muted-foreground">
          {JSON.stringify(setting.value, null, 2)}
        </pre>
      )}
    </li>
  );
}

function CategoriesTab({ categories }: { categories: AdminCategoryRow[] }) {
  return (
    <div className="rounded-lg border border-border/70 bg-surface/40">
      <ul className="divide-y divide-border/40">
        {categories.map((c) => (
          <CategoryRow key={c.id} category={c} />
        ))}
      </ul>
    </div>
  );
}

function CategoryRow({ category }: { category: AdminCategoryRow }) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(category.name);
  const { isPending, onSubmit } = useServerSubmit();
  return (
    <li className="px-4 py-3">
      <div className="flex items-center justify-between gap-4">
        {editing ? (
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="h-9 rounded border border-input bg-transparent px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
          />
        ) : (
          <div>
            <div className="font-medium">{category.name}</div>
            <div className="text-xs text-muted-foreground">
              slug: {category.slug} · sort: {category.sort_order} · icon: {category.icon ?? "—"}
            </div>
          </div>
        )}
        <div className="flex gap-2 text-xs">
          {editing ? (
            <>
              <button
                type="button"
                disabled={isPending}
                onClick={() => {
                  onSubmit(async () => {
                    const r = await updateCategoryNameAction(category.id, name);
                    if (r.ok) setEditing(false);
                    return r;
                  });
                }}
                className="rounded border border-gold/30 bg-gold/10 px-2 py-1 text-gold hover:bg-gold/20 disabled:opacity-40"
              >
                Save
              </button>
              <button
                type="button"
                onClick={() => {
                  setEditing(false);
                  setName(category.name);
                }}
                className="rounded border border-border/60 px-2 py-1 hover:border-gold/40"
              >
                Cancel
              </button>
            </>
          ) : (
            <>
              <button
                type="button"
                onClick={() => setEditing(true)}
                className="rounded border border-border/60 px-2 py-1 hover:border-gold/40"
              >
                Rename
              </button>
              <button
                type="button"
                disabled={isPending}
                onClick={() => {
                  onSubmit(async () => setCategoryActiveAction(category.id, !category.is_active));
                }}
                className={`rounded border px-2 py-1 ${
                  category.is_active
                    ? "border-border/60 hover:border-gold/40"
                    : "border-gold/30 bg-gold/10 text-gold hover:bg-gold/20"
                } disabled:opacity-40`}
              >
                {category.is_active ? "Deactivate" : "Activate"}
              </button>
            </>
          )}
        </div>
      </div>
    </li>
  );
}

function BannersTab({ banners }: { banners: AdminBannerRow[] }) {
  return (
    <div className="space-y-4">
      <CreateBannerForm />
      <ul className="divide-y divide-border/40 rounded-lg border border-border/70 bg-surface/40">
        {banners.length === 0 ? (
          <li className="px-4 py-3 text-sm text-muted-foreground">No banners yet.</li>
        ) : null}
        {banners.map((b) => (
          <BannerRow key={b.id} banner={b} />
        ))}
      </ul>
    </div>
  );
}

function CreateBannerForm() {
  const [label, setLabel] = useState("");
  const [body, setBody] = useState("");
  const [link, setLink] = useState("");
  const [startsAt, setStartsAt] = useState("");
  const [endsAt, setEndsAt] = useState("");
  const { isPending, onSubmit } = useServerSubmit();
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit(async () => {
          const r = await createBannerAction({
            label,
            body,
            link: link || null,
            starts_at: startsAt || new Date().toISOString(),
            ends_at: endsAt || new Date(Date.now() + 7 * 86400_000).toISOString(),
          });
          if (r.ok) {
            setLabel("");
            setBody("");
            setLink("");
            setStartsAt("");
            setEndsAt("");
          }
          return r;
        });
      }}
      className="rounded-lg border border-border/70 bg-surface/40 p-4 space-y-2"
    >
      <div className="text-sm font-medium">New banner</div>
      <input
        placeholder="Label"
        value={label}
        onChange={(e) => setLabel(e.target.value)}
        className="h-9 w-full rounded border border-input bg-transparent px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
      />
      <textarea
        placeholder="Body"
        value={body}
        onChange={(e) => setBody(e.target.value)}
        rows={2}
        className="w-full rounded border border-input bg-transparent px-3 py-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
      />
      <input
        placeholder="Link (optional)"
        value={link}
        onChange={(e) => setLink(e.target.value)}
        className="h-9 w-full rounded border border-input bg-transparent px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
      />
      <div className="flex gap-2">
        <input
          type="datetime-local"
          value={startsAt}
          onChange={(e) => setStartsAt(e.target.value)}
          className="h-9 rounded border border-input bg-transparent px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
        />
        <input
          type="datetime-local"
          value={endsAt}
          onChange={(e) => setEndsAt(e.target.value)}
          className="h-9 rounded border border-input bg-transparent px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
        />
      </div>
      <button
        type="submit"
        disabled={isPending || !label || !body}
        className="rounded border border-gold/30 bg-gold/10 px-3 py-1 text-sm text-gold hover:bg-gold/20 disabled:opacity-40"
      >
        Create banner
      </button>
    </form>
  );
}

function BannerRow({ banner }: { banner: AdminBannerRow }) {
  const { isPending, onSubmit } = useServerSubmit();
  return (
    <li className="px-4 py-3">
      <div className="flex items-center justify-between">
        <div>
          <div className="font-medium">{banner.label}</div>
          <div className="text-xs text-muted-foreground">
            {banner.body} {banner.link ? `· ${banner.link}` : ""}
          </div>
          <div className="text-xs text-muted-foreground">
            {new Date(banner.starts_at).toLocaleDateString()} →{" "}
            {new Date(banner.ends_at).toLocaleDateString()}
          </div>
        </div>
        <div className="flex gap-2 text-xs">
          <button
            type="button"
            disabled={isPending}
            onClick={() => {
              onSubmit(async () => toggleBannerAction(banner.id, !banner.is_active));
            }}
            className="rounded border border-border/60 px-2 py-1 hover:border-gold/40 disabled:opacity-40"
          >
            {banner.is_active ? "Deactivate" : "Activate"}
          </button>
          <button
            type="button"
            disabled={isPending}
            onClick={() => {
              if (confirm("Delete banner?")) {
                onSubmit(async () => deleteBannerAction(banner.id));
              }
            }}
            className="rounded border border-destructive/40 px-2 py-1 text-destructive hover:bg-destructive/10 disabled:opacity-40"
          >
            Delete
          </button>
        </div>
      </div>
    </li>
  );
}

function AnnouncementsTab({ announcements }: { announcements: AdminAnnouncementRow[] }) {
  return (
    <div className="space-y-4">
      <CreateAnnouncementForm />
      <ul className="divide-y divide-border/40 rounded-lg border border-border/70 bg-surface/40">
        {announcements.length === 0 ? (
          <li className="px-4 py-3 text-sm text-muted-foreground">No announcements yet.</li>
        ) : null}
        {announcements.map((a) => (
          <AnnouncementRow key={a.id} announcement={a} />
        ))}
      </ul>
    </div>
  );
}

function CreateAnnouncementForm() {
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const { isPending, onSubmit } = useServerSubmit();
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit(async () => {
          const r = await createAnnouncementAction({ title, body, is_active: true });
          if (r.ok) {
            setTitle("");
            setBody("");
          }
          return r;
        });
      }}
      className="rounded-lg border border-border/70 bg-surface/40 p-4 space-y-2"
    >
      <div className="text-sm font-medium">New announcement</div>
      <input
        placeholder="Title"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        className="h-9 w-full rounded border border-input bg-transparent px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
      />
      <textarea
        placeholder="Body"
        value={body}
        onChange={(e) => setBody(e.target.value)}
        rows={3}
        className="w-full rounded border border-input bg-transparent px-3 py-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
      />
      <button
        type="submit"
        disabled={isPending || !title || !body}
        className="rounded border border-gold/30 bg-gold/10 px-3 py-1 text-sm text-gold hover:bg-gold/20 disabled:opacity-40"
      >
        Publish
      </button>
    </form>
  );
}

function AnnouncementRow({ announcement }: { announcement: AdminAnnouncementRow }) {
  const { isPending, onSubmit } = useServerSubmit();
  return (
    <li className="px-4 py-3">
      <div className="flex items-center justify-between gap-4">
        <div>
          <div className="font-medium">{announcement.title}</div>
          <div className="text-xs text-muted-foreground">
            {announcement.body} · {new Date(announcement.posted_at).toLocaleString()}
          </div>
        </div>
        <div className="flex gap-2 text-xs">
          <button
            type="button"
            disabled={isPending}
            onClick={() => {
              onSubmit(async () =>
                toggleAnnouncementAction(announcement.id, !announcement.is_active)
              );
            }}
            className="rounded border border-border/60 px-2 py-1 hover:border-gold/40 disabled:opacity-40"
          >
            {announcement.is_active ? "Hide" : "Show"}
          </button>
          <button
            type="button"
            disabled={isPending}
            onClick={() => {
              if (confirm("Delete announcement?")) {
                onSubmit(async () => deleteAnnouncementAction(announcement.id));
              }
            }}
            className="rounded border border-destructive/40 px-2 py-1 text-destructive hover:bg-destructive/10 disabled:opacity-40"
          >
            Delete
          </button>
        </div>
      </div>
    </li>
  );
}

function TokenPacksTab({ packs, isOwner }: { packs: AdminTokenPackRow[]; isOwner: boolean }) {
  return (
    <div className="rounded-lg border border-border/70 bg-surface/40">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border/60 text-left text-xs uppercase tracking-wider text-muted-foreground">
            <th className="px-3 py-2">Label</th>
            <th className="px-3 py-2">Tokens</th>
            <th className="px-3 py-2">Price (PKR)</th>
            <th className="px-3 py-2">Active</th>
          </tr>
        </thead>
        <tbody>
          {packs.map((p) => (
            <TokenPackRow key={p.id} pack={p} isOwner={isOwner} />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function TokenPackRow({ pack, isOwner }: { pack: AdminTokenPackRow; isOwner: boolean }) {
  const [editingPrice, setEditingPrice] = useState(false);
  const [price, setPrice] = useState(pack.price_pkr);
  const { isPending, onSubmit } = useServerSubmit();
  return (
    <tr className="border-b border-border/40 last:border-0">
      <td className="px-3 py-2 font-medium">{pack.label}</td>
      <td className="px-3 py-2">{pack.tokens}</td>
      <td className="px-3 py-2">
        {editingPrice && isOwner ? (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              onSubmit(async () => {
                const r = await setTokenPackPriceAction(pack.id, price);
                if (r.ok) setEditingPrice(false);
                return r;
              });
            }}
            className="flex items-center gap-2"
          >
            <input
              type="number"
              min={1}
              value={price}
              onChange={(e) => setPrice(parseInt(e.target.value, 10) || 0)}
              className="h-8 w-24 rounded border border-input bg-transparent px-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
            />
            <button
              type="submit"
              disabled={isPending}
              className="rounded border border-gold/30 bg-gold/10 px-2 py-1 text-xs text-gold hover:bg-gold/20 disabled:opacity-40"
            >
              Save
            </button>
          </form>
        ) : (
          <button
            type="button"
            onClick={() => setEditingPrice(true)}
            disabled={!isOwner}
            className="hover:underline disabled:cursor-default disabled:no-underline"
          >
            {pack.price_pkr}
          </button>
        )}
      </td>
      <td className="px-3 py-2">
        <button
          type="button"
          disabled={isPending}
          onClick={() => onSubmit(async () => setTokenPackActiveAction(pack.id, !pack.is_active))}
          className={`rounded border px-2 py-1 text-xs ${
            pack.is_active
              ? "border-gold/30 bg-gold/10 text-gold hover:bg-gold/20"
              : "border-border/60 hover:border-gold/40"
          } disabled:opacity-40`}
        >
          {pack.is_active ? "Active" : "Hidden"}
        </button>
      </td>
    </tr>
  );
}

function PaymentTab({
  payment,
  isOwner,
}: {
  payment: { jazzcash: Record<string, unknown>; easypaisa: Record<string, unknown> };
  isOwner: boolean;
}) {
  return (
    <div className="space-y-4">
      {!isOwner ? (
        <p className="text-sm text-muted-foreground">
          Owner-only. You can view this page, but only owners can edit payment details.
        </p>
      ) : null}
      <PaymentDetailsForm provider="jazzcash" value={payment.jazzcash} disabled={!isOwner} />
      <PaymentDetailsForm provider="easypaisa" value={payment.easypaisa} disabled={!isOwner} />
    </div>
  );
}

function PaymentDetailsForm({
  provider,
  value,
  disabled,
}: {
  provider: "jazzcash" | "easypaisa";
  value: Record<string, unknown>;
  disabled: boolean;
}) {
  const [accountName, setAccountName] = useState((value.account_name as string) ?? "");
  const [accountNumber, setAccountNumber] = useState((value.account_number as string) ?? "");
  const [instructions, setInstructions] = useState((value.instructions as string) ?? "");
  const [qrDataUrl, setQrDataUrl] = useState((value.qr_data_url as string) ?? "");
  const { isPending, error, onSubmit } = useServerSubmit();

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit(async () =>
          updatePaymentDetailsAction({
            provider,
            account_name: accountName,
            account_number: accountNumber,
            instructions,
            qr_data_url: qrDataUrl,
          })
        );
      }}
      className="rounded-lg border border-border/70 bg-surface/40 p-4 space-y-2"
    >
      <div className="text-sm font-medium uppercase tracking-wider text-muted-foreground">
        {provider}
      </div>
      <input
        placeholder="Account name"
        value={accountName}
        onChange={(e) => setAccountName(e.target.value)}
        disabled={disabled}
        className="h-9 w-full rounded border border-input bg-transparent px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-50"
      />
      <input
        placeholder="Account number"
        value={accountNumber}
        onChange={(e) => setAccountNumber(e.target.value)}
        disabled={disabled}
        className="h-9 w-full rounded border border-input bg-transparent px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-50"
      />
      <textarea
        placeholder="Instructions"
        value={instructions}
        onChange={(e) => setInstructions(e.target.value)}
        rows={2}
        disabled={disabled}
        className="w-full rounded border border-input bg-transparent px-3 py-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-50"
      />
      <PaymentQrUploader
        provider={provider}
        value={qrDataUrl}
        disabled={disabled}
        onCommit={async (url) => {
          const result = await updatePaymentDetailsAction({
            provider,
            account_name: accountName,
            account_number: accountNumber,
            instructions,
            qr_data_url: url ?? "",
          });
          if (result.ok) {
            setQrDataUrl(url ?? "");
            return { ok: true as const };
          }
          return {
            ok: false as const,
            error:
              result.code === "forbidden"
                ? "You don't have permission to change payment details."
                : "Could not save the QR code — try again.",
          };
        }}
      />
      <button
        type="submit"
        disabled={disabled || isPending}
        className="rounded border border-gold/30 bg-gold/10 px-3 py-1 text-sm text-gold hover:bg-gold/20 disabled:opacity-40"
      >
        Save
      </button>
      {error ? <span className="text-xs text-destructive">{error}</span> : null}
    </form>
  );
}

function MoneyTab({ settings }: { settings: AdminSettingRow[] }) {
  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Owner-only. Every edit appends to the audit log with old + new.
      </p>
      <ul className="divide-y divide-border/40 rounded-lg border border-border/70 bg-surface/40">
        {settings.map((s) => (
          <SettingRow key={s.key} setting={s} />
        ))}
      </ul>
    </div>
  );
}