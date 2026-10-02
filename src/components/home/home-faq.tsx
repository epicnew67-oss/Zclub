import { RevealSection } from "@/components/home/reveal-section";

const faqs = [
  { q: "What are tokens?", a: "Tokens are used to book calls on StripClub. A pack's price and token amount are shown before you pay." },
  { q: "When can I join?", a: "After you book an available seller, your order page shows when you can join your private call." },
  { q: "When does the seller get paid?", a: "Your tokens are held for the call. After a completed call, the seller's share moves to their wallet." },
  { q: "Can I cancel?", a: "You can cancel an on-demand booking before either person joins. The held tokens return to your wallet." },
  { q: "How do I become a seller?", a: "Apply with a short profile. Once approved, you can create listings and choose when you are online." },
];

export function HomeFaq() {
  return (
    <RevealSection target="[data-reveal]" className="border-t border-gold/20 bg-surface/50">
      <div className="mx-auto grid max-w-7xl gap-10 px-5 py-16 md:grid-cols-[.7fr_1fr] md:px-8 md:py-24">
        <div data-reveal><p className="editorial-kicker">05 / Good to know</p><h2 className="mt-3 font-heading text-4xl leading-none md:text-6xl">A little more <em className="text-gold-soft">clarity.</em></h2></div>
        <div className="border-t border-gold/25">
          {faqs.map((faq) => (
            <details key={faq.q} data-reveal className="group border-b border-gold/25 py-5 [&_summary::-webkit-details-marker]:hidden">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-5 font-heading text-xl leading-snug text-foreground marker:hidden">
                {faq.q}<span aria-hidden className="text-2xl font-light leading-none text-gold transition-transform group-open:rotate-45">+</span>
              </summary>
              <p className="mt-4 max-w-xl pr-10 text-sm leading-7 text-muted-foreground">{faq.a}</p>
            </details>
          ))}
        </div>
      </div>
    </RevealSection>
  );
}
