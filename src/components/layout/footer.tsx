import Link from "next/link";
import { brand } from "@/lib/brand";
import { Logo } from "@/components/brand/Logo";
import { Separator } from "@/components/ui/separator";

/**
 * Footer links — audited. Every entry either points at a real route or is
 * explicitly marked `soon` (rendered as subdued, non-interactive text with
 * a "Soon" tag). No live-looking link ever 404s or does nothing.
 */
type FooterLink = { label: string; href: string } | { label: string; soon: true };

const columns: Array<{ title: string; links: FooterLink[] }> = [
  {
    title: "Marketplace",
    links: [
      { label: "Browse listings", href: "/browse" },
      { label: "Become a seller", href: "/become-a-seller" },
      { label: "Token packs", href: "/wallet/topup" },
      { label: "Safety & trust", soon: true },
    ],
  },
  {
    title: "Account",
    links: [
      { label: "My account", href: "/account" },
      { label: "Wallet", href: "/wallet" },
      { label: "Notifications", href: "/notifications" },
    ],
  },
  {
    title: "Support",
    links: [
      { label: "Help center", soon: true },
      { label: "Terms of service", soon: true },
      { label: "Privacy policy", soon: true },
      { label: "Contact support", soon: true },
    ],
  },
];

export function Footer() {
  return (
    <footer className="border-t border-border/70 bg-background">
      <div className="mx-auto max-w-6xl px-4 py-12 md:px-6">
        <div className="grid gap-10 md:grid-cols-[1.5fr_1fr_1fr_1fr]">
          <div className="space-y-4">
            <Link href="/" aria-label={`${brand.name} — home`}>
              <Logo size="md" />
            </Link>
            <p className="max-w-sm text-sm text-muted-foreground">
              {brand.description}
            </p>
          </div>

          {columns.map((column) => (
            <nav
              key={column.title}
              aria-label={column.title}
              className="space-y-4"
            >
              <h3 className="text-sm font-semibold text-foreground">
                {column.title}
              </h3>
              <ul className="space-y-2.5 text-sm">
                {column.links.map((link) => (
                  <li key={link.label}>
                    {"href" in link ? (
                      <Link
                        href={link.href}
                        className="text-muted-foreground transition-colors hover:text-gold"
                      >
                        {link.label}
                      </Link>
                    ) : (
                      <span
                        aria-disabled="true"
                        title="Coming soon"
                        className="inline-flex cursor-default items-center gap-2 text-muted-foreground/60"
                      >
                        {link.label}
                        <span className="rounded-full border border-border/70 px-1.5 py-0.5 text-[9px] tracking-wider uppercase text-muted-foreground/70">
                          Soon
                        </span>
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            </nav>
          ))}
        </div>

        <Separator className="my-8 bg-border/70" />

        <p className="text-xs text-muted-foreground">
          © {new Date().getFullYear()} {brand.name} · {brand.domain} · Every
          payment moves through an append-only ledger — balances are earned,
          never overwritten.
        </p>
      </div>
    </footer>
  );
}
