import Link from "next/link";
import { ArrowUpRightIcon } from "lucide-react";
import { Logo } from "@/components/brand/Logo";
import { brand } from "@/lib/brand";

const links = [
  { label: "Browse calls", href: "/browse" },
  { label: "Buy tokens", href: "/wallet/topup" },
  { label: "Become a seller", href: "/become-a-seller" },
  { label: "My orders", href: "/orders" },
  { label: "Wallet", href: "/wallet" },
  { label: "My account", href: "/account" },
];

export function Footer() {
  return (
    <footer className="border-t border-gold/25 bg-surface/65">
      <div className="mx-auto max-w-7xl px-5 pt-14 pb-7 md:px-8 md:pt-20">
        <div className="grid gap-12 border-b border-gold/25 pb-14 md:grid-cols-[1.2fr_1fr] md:pb-20">
          <div>
            <p className="editorial-kicker">The private room</p>
            <Link href="/" aria-label={`${brand.name} — home`} className="mt-5 inline-block"><Logo size="lg" /></Link>
            <p className="mt-6 max-w-md text-sm leading-7 text-muted-foreground">{brand.description}</p>
          </div>
          <nav aria-label="Footer" className="grid grid-cols-2 gap-x-6 gap-y-4 self-end">
            {links.map((link) => <Link key={link.href} href={link.href} className="group inline-flex items-center justify-between gap-2 border-b border-gold/15 pb-2 text-sm text-foreground/80 transition-colors hover:border-gold hover:text-gold-soft">{link.label}<ArrowUpRightIcon className="size-3.5 shrink-0 text-gold opacity-0 transition-opacity group-hover:opacity-100" /></Link>)}
          </nav>
        </div>
        <div className="flex flex-wrap justify-between gap-3 pt-6 text-[10px] font-medium tracking-[.12em] text-muted-foreground uppercase">
          <span>© {new Date().getFullYear()} {brand.name} · {brand.domain}</span>
          <span>Private calls · Booked with tokens</span>
        </div>
      </div>
    </footer>
  );
}
