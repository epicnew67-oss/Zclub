import Link from "next/link";
import Image from "next/image";
import { brand } from "@/lib/brand";
import { Logo } from "@/components/brand/Logo";

export default function AuthLayout({ children }: LayoutProps<"/auth">) {
  return (
    <div className="grid flex-1 lg:grid-cols-2">
      <div className="relative hidden min-h-[44rem] overflow-hidden border-r border-gold/20 lg:block">
        <Image src="/editorial/editorial-wide.webp" alt="" fill priority sizes="50vw" className="object-cover object-center opacity-80" />
        <div className="absolute inset-0 bg-gradient-to-t from-background via-background/20 to-transparent" />
        <div className="absolute right-12 bottom-16 left-12">
          <p className="editorial-kicker">The private room</p>
          <p className="mt-5 max-w-xl font-heading text-6xl leading-[.94] tracking-tight text-foreground">A better way to <em className="text-gold-soft">connect.</em></p>
          <p className="mt-6 max-w-md border-l border-gold pl-4 text-sm leading-7 text-foreground/80">Private calls, on your terms. Find someone you want to meet and join when the moment is right.</p>
        </div>
      </div>
      <div className="flex items-center justify-center px-4 py-14 md:px-8 md:py-20">
        <div className="w-full max-w-md">
          <div className="mb-10 flex items-center justify-between border-b border-gold/25 pb-5">
            <Link href="/" aria-label={`${brand.name} home`}><Logo size="lg" /></Link>
            <span className="editorial-kicker">Members / 001</span>
          </div>
          {children}
        </div>
      </div>
    </div>
  );
}
