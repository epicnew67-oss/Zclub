import { CalendarPlusIcon, CoinsIcon, PhoneIcon, SparklesIcon } from "lucide-react";
import { RevealSection } from "@/components/home/reveal-section";

const steps = [
  {
    icon: SparklesIcon,
    title: "Browse",
    description: "Find a seller whose vibe matches what you're after.",
  },
  {
    icon: CalendarPlusIcon,
    title: "Book a slot",
    description: "Pick a time that works. Tokens are escrowed, not released yet.",
  },
  {
    icon: PhoneIcon,
    title: "Connect",
    description: "Join the 1:1 video call at the agreed time.",
  },
  {
    icon: CoinsIcon,
    title: "Released",
    description: "After the call completes, tokens are released to the seller.",
  },
];

export function HowItWorks() {
  return (
    <RevealSection
      id="how-it-works"
      target="[data-reveal]"
      className="mx-auto w-full max-w-6xl px-4 py-10 md:px-6 md:py-14"
    >
      <div data-reveal className="mb-8 max-w-2xl">
        <h2 className="font-heading text-2xl font-semibold tracking-tight md:text-3xl">
          How it <span className="text-gold">works</span>
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Four steps from browse to release. Tokens stay safe until the call is done.
        </p>
      </div>
      <ol className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {steps.map((step, i) => {
          const Icon = step.icon;
          return (
            <li
              key={step.title}
              data-reveal
              className="relative rounded-xl border border-gold/20 bg-surface/40 p-5"
            >
              <span className="absolute -top-3 left-5 grid size-7 place-items-center rounded-full border border-gold/40 bg-background font-heading text-xs text-gold">
                {String(i + 1).padStart(2, "0")}
              </span>
              <div className="mt-3 flex items-center gap-2">
                <Icon className="size-4 text-gold" />
                <span className="font-heading text-base text-foreground">
                  {step.title}
                </span>
              </div>
              <p className="mt-2 text-sm text-muted-foreground">
                {step.description}
              </p>
            </li>
          );
        })}
      </ol>
    </RevealSection>
  );
}