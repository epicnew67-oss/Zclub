import Link from "next/link";
import { brand } from "@/lib/brand";
import { Logo } from "@/components/brand/Logo";

export default function AuthLayout({ children }: LayoutProps<"/auth">) {
  return (
    <div className="relative flex flex-1 items-center justify-center overflow-hidden px-4 py-12 md:py-20">
      {/* subtle burgundy glow, one corner */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -top-32 -right-32 h-[28rem] w-[28rem] rounded-full bg-burgundy/20 blur-3xl"
      />

      <div className="relative w-full max-w-md">
        <div className="mb-6 flex justify-center">
          <Link href="/" aria-label={`${brand.name} — home`}>
            <Logo size="lg" />
          </Link>
        </div>
        {children}
      </div>
    </div>
  );
}
