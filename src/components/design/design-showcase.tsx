"use client";

import * as React from "react";
import Image from "next/image";
import { toast } from "sonner";
import {
  OctagonXIcon,
  InfoIcon,
  Loader2Icon,
  CalendarPlusIcon,
  SparklesIcon,
} from "lucide-react";
import { brand } from "@/lib/brand";
import { useGsap } from "@/hooks/use-gsap";
import { cn } from "cn";
import { Logo } from "@/components/brand/Logo";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

function Section({
  id,
  title,
  description,
  children,
}: {
  id: string;
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <section id={id} data-ds-section className="ds-reveal scroll-mt-24">
      <div className="mb-5">
        <h2 className="font-heading text-2xl font-semibold text-foreground">
          {title}
        </h2>
        <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
          {description}
        </p>
      </div>
      {children}
    </section>
  );
}

function Panel({
  className,
  children,
}: {
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div
      className={cn(
        "rounded-xl border border-border/70 bg-card p-5 md:p-6",
        className
      )}
    >
      {children}
    </div>
  );
}

const swatches: Array<[keyof typeof brand.colors, string]> = [
  ["bg", "Background"],
  ["surface", "Surface / card"],
  ["elevated", "Elevated"],
  ["overlay", "Overlay / popover"],
  ["text", "Foreground"],
  ["textMuted", "Muted foreground"],
  ["line", "Border"],
  ["lineStrong", "Input border"],
  ["gold", "Gold — primary"],
  ["goldSoft", "Gold soft"],
  ["goldDeep", "Gold deep"],
  ["onGold", "On gold"],
  ["burgundy", "Burgundy"],
  ["burgundyDeep", "Burgundy deep — secondary"],
  ["success", "Success"],
  ["danger", "Danger — destructive"],
];

const radii = [
  ["rounded-sm", "sm"],
  ["rounded-md", "md"],
  ["rounded-lg", "lg"],
  ["rounded-xl", "xl"],
  ["rounded-2xl", "2xl"],
] as const;

export function DesignShowcase() {
  const scopeRef = useGsap<HTMLDivElement>(({ gsap }) => {
    gsap.utils.toArray<HTMLElement>(".ds-reveal").forEach((el) => {
      gsap.from(el, {
        opacity: 0,
        y: 26,
        duration: 0.6,
        ease: "power2.out",
        scrollTrigger: { trigger: el, start: "top 88%", once: true },
      });
    });
  });

  return (
    <div
      ref={scopeRef}
      className="mx-auto max-w-6xl space-y-14 px-4 py-10 md:space-y-20 md:px-6 md:py-16"
    >
      <header className="ds-reveal">
        <Badge variant="gold-outline">Design system</Badge>
        <h1 className="mt-4 font-heading text-4xl font-semibold text-foreground md:text-5xl">
          {brand.name}{" "}
          <span className="text-gold">brand & components</span>
        </h1>
        <p className="mt-3 max-w-2xl text-muted-foreground">
          Every token on this page is driven by{" "}
          <code className="rounded bg-muted px-1.5 py-0.5 text-xs text-foreground">
            src/lib/brand.ts
          </code>{" "}
          — change a color there and the whole site updates.
        </p>
      </header>

      <Section
        id="brand"
        title="Brand & logo"
        description="Interlocked burgundy S + gold C mark with a thin gold accent line, and the wide-tracked Playfair wordmark — rendered as inline SVG from brand.ts colors."
      >
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {[
            { title: "Full", node: <Logo size="lg" /> },
            { title: "Mark", node: <Logo variant="mark" size="lg" /> },
            { title: "Wordmark", node: <Logo variant="wordmark" size="lg" /> },
            { title: "Inverted (on gold)", node: <Logo size="lg" invert /> },
          ].map((item) => (
            <div
              key={item.title}
              className={cn(
                "flex min-h-28 items-center justify-center rounded-xl border border-border/70 p-6",
                item.title === "Inverted (on gold)" && "bg-gold"
              )}
            >
              {item.node}
            </div>
          ))}
        </div>
        <div className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-4">
          {[
            { src: brand.logo.icon512, size: 96, label: "512" },
            { src: brand.logo.icon192, size: 64, label: "192" },
            { src: brand.logo.appleTouchIcon, size: 48, label: "180" },
            { src: brand.logo.favicon, size: 32, label: "32 (favicon)" },
          ].map((icon) => (
            <Panel key={icon.label} className="flex flex-col items-center gap-3">
              <Image
                src={icon.src}
                alt={`${brand.name} ${icon.label}px app icon`}
                width={icon.size}
                height={icon.size}
                className="rounded-md"
              />
              <span className="text-xs text-muted-foreground">
                {icon.label}px
              </span>
            </Panel>
          ))}
        </div>
      </Section>

      <Section
        id="colors"
        title="Color tokens"
        description="Surfaces, text, lines, and the gold / burgundy accents — straight from brand.ts."
      >
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
          {swatches.map(([key, label]) => (
            <div
              key={key}
              className="overflow-hidden rounded-lg border border-border/70 bg-card"
            >
              <div
                className="h-14 border-b border-border/70"
                style={{ background: brand.colors[key] }}
              />
              <div className="p-3">
                <div className="text-xs font-medium text-foreground">
                  {label}
                </div>
                <div className="mt-0.5 font-mono text-xs uppercase text-muted-foreground">
                  {brand.colors[key]}
                </div>
              </div>
            </div>
          ))}
        </div>
      </Section>

      <Section
        id="typography"
        title="Typography"
        description="Playfair Display for headings (font-heading), Inter for body (font-sans)."
      >
        <div className="grid gap-4 lg:grid-cols-2">
          <Panel>
            <div className="text-xs tracking-widest text-muted-foreground uppercase">
              Display — Playfair Display
            </div>
            <p className="mt-3 font-heading text-4xl font-semibold">
              An evening, arranged.
            </p>
            <p className="mt-2 font-heading text-2xl text-muted-foreground">
              Booked in tokens, held in escrow.
            </p>
          </Panel>
          <Panel>
            <div className="text-xs tracking-widest text-muted-foreground uppercase">
              Body — Inter
            </div>
            <p className="mt-3 text-base">
              Sellers list fixed-price 1:1 video call slots. Buyers purchase
              them with site tokens — every balance is the sum of an
              append-only ledger.
            </p>
            <p className="mt-2 text-sm text-muted-foreground">
              Muted body copy uses text-muted-foreground at a comfortable
              reading size.
            </p>
          </Panel>
        </div>
      </Section>

      <Section
        id="buttons"
        title="Buttons"
        description="Variants and sizes. Default uses the gold primary token, secondary the burgundy deep surface."
      >
        <Panel className="space-y-5">
          <div className="flex flex-wrap items-center gap-3">
            <Button className="shadow-gold">
              <CalendarPlusIcon data-icon="inline-start" /> Book a call
            </Button>
            <Button variant="secondary">Secondary</Button>
            <Button variant="outline">Outline</Button>
            <Button variant="gold-outline">Gold outline</Button>
            <Button variant="glow">Glow</Button>
            <Button variant="ghost">Ghost</Button>
            <Button variant="link">Link</Button>
            <Button variant="destructive">Cancel booking</Button>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <Button size="sm">Small</Button>
            <Button size="default">Default</Button>
            <Button size="lg">Large</Button>
            <Button disabled>Disabled</Button>
            <Button disabled>
              <Loader2Icon data-icon="inline-start" className="animate-spin" />
              Processing
            </Button>
          </div>
        </Panel>
      </Section>

      <Section
        id="inputs"
        title="Inputs"
        description="Text, password, textarea, and states — focus rings use the gold token."
      >
        <div className="grid gap-4 md:grid-cols-2">
          <Panel className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="ds-username">Username</Label>
              <Input
                id="ds-username"
                placeholder="Your stage name"
                autoComplete="username"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="ds-password">Password</Label>
              <Input
                id="ds-password"
                type="password"
                placeholder="••••••••"
                autoComplete="current-password"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="ds-invalid">Invalid</Label>
              <Input
                id="ds-invalid"
                aria-invalid
                defaultValue="not-an-email"
                type="email"
              />
            </div>
          </Panel>
          <Panel className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="ds-note">Note to seller</Label>
              <Textarea
                id="ds-note"
                placeholder="Anything the seller should know before the call…"
                rows={4}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="ds-disabled">Disabled</Label>
              <Input id="ds-disabled" disabled placeholder="Locked" />
            </div>
          </Panel>
        </div>
      </Section>

      <Section
        id="cards"
        title="Cards"
        description="Default, gold-border, and burgundy-glow variants of the card component."
      >
        <div className="grid gap-4 md:grid-cols-3">
          {(["default", "gold", "glow"] as const).map((variant) => (
            <Card key={variant} variant={variant}>
              <CardHeader>
                <CardTitle className="capitalize">{variant}</CardTitle>
                <CardDescription>
                  {variant === "default" &&
                    "Surface token on a hairline ring — the everyday card."}
                  {variant === "gold" &&
                    "gold-border effect: a 45% gold edge with a soft gold shadow."}
                  {variant === "glow" &&
                    "burgundy-glow effect: layered burgundy and gold ambient light."}
                </CardDescription>
              </CardHeader>
              <CardContent className="text-sm text-muted-foreground">
                Fixed-price 1:1 slot · 30 minutes · 400 tokens
              </CardContent>
              <CardFooter className="justify-between">
                <span className="text-sm font-medium text-foreground">
                  400 tokens
                </span>
                <Button size="sm">Book</Button>
              </CardFooter>
            </Card>
          ))}
        </div>
      </Section>

      <Section
        id="modal"
        title="Modal & overlays"
        description="Dialog with a gold hairline edge and a 60% scrim for foreground legibility."
      >
        <Panel className="flex flex-wrap gap-3">
          <Dialog>
            <DialogTrigger asChild>
              <Button className="shadow-gold">
                <SparklesIcon data-icon="inline-start" /> Open modal
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Confirm booking</DialogTitle>
                <DialogDescription>
                  400 tokens will be held in escrow and released to the seller
                  once the call completes.
                </DialogDescription>
              </DialogHeader>
              <div className="rounded-lg bg-muted/60 p-4 text-sm">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Slot</span>
                  <span className="font-medium">Fri 21:00 · 30 min</span>
                </div>
                <div className="mt-2 flex justify-between">
                  <span className="text-muted-foreground">Price</span>
                  <span className="font-medium text-gold">400 tokens</span>
                </div>
              </div>
              <DialogFooter>
                <Button variant="ghost">Not yet</Button>
                <Button className="shadow-gold">Hold tokens</Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="outline">Hover for tooltip</Button>
            </TooltipTrigger>
            <TooltipContent>Tooltips use the overlay tokens</TooltipContent>
          </Tooltip>
        </Panel>
      </Section>

      <Section
        id="toast"
        title="Toasts"
        description="Sonner toasts themed with the popover tokens."
      >
        <Panel className="flex flex-wrap gap-3">
          <Button
            variant="outline"
            onClick={() =>
              toast.success("Booking confirmed", {
                description: "Tokens held in escrow until the call completes.",
              })
            }
          >
            Success toast
          </Button>
          <Button
            variant="outline"
            onClick={() =>
              toast.error("Payment failed", {
                description: "No tokens were deducted from your balance.",
              })
            }
          >
            Error toast
          </Button>
          <Button
            variant="outline"
            onClick={() =>
              toast("Slot released", {
                description: "The seller re-listed this slot.",
              })
            }
          >
            Default toast
          </Button>
        </Panel>
      </Section>

      <Section
        id="badges"
        title="Badges"
        description="Status chips for bookings, roles, and states."
      >
        <Panel className="flex flex-wrap items-center gap-3">
          <Badge>Gold — default</Badge>
          <Badge variant="secondary">Burgundy</Badge>
          <Badge variant="outline">Outline</Badge>
          <Badge variant="gold-outline">Gold outline</Badge>
          <Badge variant="success">Completed</Badge>
          <Badge variant="destructive">Disputed</Badge>
          <Badge variant="ghost">Ghost</Badge>
        </Panel>
      </Section>

      <Section
        id="effects"
        title="Effects"
        description="Brand signature effects and shadows, exposed as utilities: gold-border, burgundy-glow, shadow-gold, shadow-glow."
      >
        <div className="grid gap-4 md:grid-cols-2">
          <div className="gold-border flex min-h-32 items-center justify-center rounded-xl bg-card p-6 font-heading text-lg text-gold">
            gold-border
          </div>
          <div className="burgundy-glow flex min-h-32 items-center justify-center rounded-xl bg-burgundy-deep p-6 font-heading text-lg text-foreground">
            burgundy-glow
          </div>
          <Panel className="flex min-h-24 items-center justify-center rounded-xl shadow-gold">
            shadow-gold
          </Panel>
          <Panel className="flex min-h-24 items-center justify-center rounded-xl shadow-glow">
            shadow-glow
          </Panel>
        </div>
      </Section>

      <Section
        id="radius"
        title="Radius & lines"
        description="The radius scale (from brand.radius) and separators."
      >
        <div className="flex flex-wrap gap-4">
          {radii.map(([cls, label]) => (
            <div key={cls} className="flex flex-col items-center gap-2">
              <div
                className={cn(
                  "flex h-16 w-20 items-center justify-center bg-gold/15 text-xs text-gold",
                  cls
                )}
              >
                {label}
              </div>
              <span className="font-mono text-xs text-muted-foreground">
                {cls}
              </span>
            </div>
          ))}
        </div>
        <Separator className="my-6" />
        <div className="space-y-3">
          <Skeleton className="h-4 w-3/4" />
          <Skeleton className="h-4 w-1/2" />
        </div>
      </Section>

      <Section
        id="feedback"
        title="Feedback & controls"
        description="Alerts, tabs, and switches for form and status states."
      >
        <div className="grid gap-4 lg:grid-cols-2">
          <div className="space-y-4">
            <Alert>
              <InfoIcon />
              <AlertTitle>Heads up</AlertTitle>
              <AlertDescription>
                Neutral info alert on the elevated surface token.
              </AlertDescription>
            </Alert>
            <Alert variant="destructive">
              <OctagonXIcon />
              <AlertTitle>Seller no-show</AlertTitle>
              <AlertDescription>
                Destructive alert — the booking moves to the disputed state.
              </AlertDescription>
            </Alert>
          </div>
          <div className="space-y-6">
            <Tabs defaultValue="buyer">
              <TabsList>
                <TabsTrigger value="buyer">Buyer</TabsTrigger>
                <TabsTrigger value="seller">Seller</TabsTrigger>
                <TabsTrigger value="support">Support</TabsTrigger>
              </TabsList>
              <TabsContent value="buyer" className="mt-3 text-sm text-muted-foreground">
                Browse slots, buy token packs, chat inside bookings.
              </TabsContent>
              <TabsContent value="seller" className="mt-3 text-sm text-muted-foreground">
                List slots, receive released tokens, keep a public profile.
              </TabsContent>
              <TabsContent value="support" className="mt-3 text-sm text-muted-foreground">
                Mediate disputes — every action lands in the audit log.
              </TabsContent>
            </Tabs>
            <div className="flex items-center gap-3">
              <Switch id="ds-switch" aria-label="Example switch" />
              <Label htmlFor="ds-switch">Reduced ambient glow</Label>
            </div>
          </div>
        </div>
      </Section>

      <footer className="ds-reveal border-t border-border/70 pt-8 text-sm text-muted-foreground">
        That is the whole system: tokens from{" "}
        <code className="rounded bg-muted px-1.5 py-0.5 text-xs text-foreground">
          src/lib/brand.ts
        </code>
        , utilities in globals.css, and shadcn/ui components themed on top.
      </footer>
    </div>
  );
}
