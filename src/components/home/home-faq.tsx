import { RevealSection } from "@/components/home/reveal-section";

const faqs = [
  {
    q: "What are tokens?",
    a: "Tokens are StripClub's in-app currency. 1 PKR = 2 tokens. You buy token packs with PKR via crypto or local bank transfer, and spend tokens on listings.",
  },
  {
    q: "When is the seller paid?",
    a: "Tokens are held in escrow when you book. They're released to the seller after the call completes successfully — not before.",
  },
  {
    q: "What if the seller no-shows?",
    a: "If the seller doesn't join, the booking moves to disputed and tokens are refunded to your wallet in full.",
  },
  {
    q: "Can I get a refund?",
    a: "If you cancel before the call starts, tokens return to your wallet. After the call, refunds are handled by support on a case-by-case basis.",
  },
  {
    q: "How do I become a seller?",
    a: "Apply at /become-a-seller with a brief about what you offer. Once approved, you can publish listings and start taking bookings.",
  },
];

export function HomeFaq() {
  return (
    <RevealSection
      target="[data-reveal]"
      className="mx-auto w-full max-w-3xl px-4 py-10 md:px-6 md:py-14"
    >
      <div data-reveal className="mb-6">
        <h2 className="font-heading text-2xl font-semibold tracking-tight md:text-3xl">
          <span className="text-gold">FAQ</span>
        </h2>
      </div>
      <div className="space-y-2">
        {faqs.map((f) => (
          <details
            key={f.q}
            data-reveal
            className="group/faq rounded-xl border border-gold/20 bg-surface/40 px-4 py-3 open:bg-surface/70 [&_summary::-webkit-details-marker]:hidden"
          >
            <summary className="flex cursor-pointer list-none items-center justify-between gap-2 font-heading text-base text-foreground marker:hidden">
              {f.q}
              <span
                aria-hidden
                className="grid size-6 place-items-center rounded-full border border-gold/40 text-xs text-gold transition-transform duration-200 group-open/faq:rotate-45"
              >
                +
              </span>
            </summary>
            <p className="mt-2 text-sm text-muted-foreground">{f.a}</p>
          </details>
        ))}
      </div>
    </RevealSection>
  );
}