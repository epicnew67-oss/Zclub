import Link from "next/link";
import { ArrowRightIcon } from "lucide-react";
import { RevealSection } from "@/components/home/reveal-section";

const steps = [
  { number: "01", title: "Find someone online", description: "Browse live listings and choose a seller who is available now." },
  { number: "02", title: "Book with tokens", description: "The price is clear before you confirm. Your tokens are held for the call." },
  { number: "03", title: "Join your private call", description: "Meet one to one. After a completed call, the seller receives their share." },
];

export function HowItWorks() {
  return (
    <RevealSection id="how-it-works" target="[data-reveal]" className="mx-auto max-w-7xl px-5 py-16 md:px-8 md:py-24">
      <div data-reveal className="mb-10 grid gap-6 md:grid-cols-[1fr_auto] md:items-end">
        <div><p className="editorial-kicker">03 / The experience</p><h2 className="mt-3 font-heading text-4xl leading-none md:text-6xl">Simple by <em className="text-gold-soft">design.</em></h2></div>
        <p className="max-w-xs text-sm leading-6 text-muted-foreground">From browsing to the call, everything happens in your account.</p>
      </div>
      <ol className="grid border-y border-gold/25 md:grid-cols-3">
        {steps.map((step) => (
          <li key={step.number} data-reveal className="min-h-56 border-b border-gold/25 px-1 py-8 last:border-b-0 md:border-r md:border-b-0 md:px-8 md:first:pl-1 md:last:border-r-0">
            <span className="text-xs font-bold tracking-[.18em] text-gold">{step.number} / 03</span>
            <h3 className="mt-9 font-heading text-2xl leading-tight md:text-3xl">{step.title}</h3>
            <p className="mt-3 max-w-xs text-sm leading-6 text-muted-foreground">{step.description}</p>
          </li>
        ))}
      </ol>
      <Link href="/browse" className="mt-7 inline-flex items-center gap-2 text-xs font-bold tracking-[.15em] text-gold uppercase hover:text-gold-soft">Browse live calls <ArrowRightIcon className="size-4" /></Link>
    </RevealSection>
  );
}
