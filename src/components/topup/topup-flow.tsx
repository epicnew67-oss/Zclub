"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  BitcoinIcon,
  CopyIcon,
  Loader2Icon,
  QrCodeIcon,
  SmartphoneIcon,
  UploadIcon,
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { sanitizeReturnUrl, TOPUP_SCREENSHOT_BUCKET } from "@/lib/topups/types";
import type {
  ManualAccount,
  TokenPack,
} from "@/lib/topups/types";
import {
  beginManualTopupAction,
  createCryptoTopupAction,
  submitManualTopupAction,
} from "@/app/wallet/topup/actions";
import type { TopupMethod } from "@/lib/topups/types";

// Re-exports for the server component (no circular import).
 
export { sanitizeReturnUrl };

type TopupFlowProps = {
  packs: TokenPack[];
  preselectedPackId: string | null;
  neededTokens: number | null;
  returnUrl: string;
  userId: string;
  accounts: { jazzcash: ManualAccount | null; easypaisa: ManualAccount | null };
};

type MethodChoice = TopupMethod;

const METHOD_META: Record<
  MethodChoice,
  { label: string; note: string; icon: typeof BitcoinIcon }
> = {
  crypto: {
    label: "Crypto",
    note: "Auto-confirmed via NOWPayments. Rate locked at invoice creation.",
    icon: BitcoinIcon,
  },
  jazzcash: {
    label: "JazzCash",
    note: "Show the JazzCash account, then submit your transaction details.",
    icon: SmartphoneIcon,
  },
  easypaisa: {
    label: "Easypaisa",
    note: "Show the Easypaisa account, then submit your transaction details.",
    icon: SmartphoneIcon,
  },
};

function formatPkr(pkr: number) {
  return `PKR ${pkr.toLocaleString("en-US")}`;
}

function PreselectedNotice({
  needed,
  preselected,
}: {
  needed: number | null;
  preselected: string | null;
}) {
  if (needed == null || needed <= 0) return null;
  if (preselected) return null;
  return (
    <p className="rounded-lg bg-destructive/10 px-3 py-2 text-xs text-destructive">
      The amount you need ({needed.toLocaleString("en-US")} tokens) exceeds our
      largest pack. Contact support or return and split the booking.
    </p>
  );
}

type ManualState = {
  topupId: string;
  referenceCode: string;
  expiresAt: string;
  pricePkr: number;
  tokens: number;
  account: ManualAccount | null;
  method: "jazzcash" | "easypaisa";
};

export function TopupFlow({
  packs,
  preselectedPackId,
  neededTokens,
  returnUrl,
  userId,
  accounts,
}: TopupFlowProps) {
  const router = useRouter();
  const [phase, setPhase] = useState<"pack" | "method" | "manual">("pack");
  const [packId, setPackId] = useState<string | null>(preselectedPackId);
  const [method, setMethod] = useState<MethodChoice | null>(null);
  const [manual, setManual] = useState<ManualState | null>(null);
  const [busy, setBusy] = useState(false);
  const [pendingTransition, startTransition] = useTransition();

  const selectedPack = useMemo(
    () => packs.find((p) => p.id === packId) ?? null,
    [packs, packId]
  );

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text).catch(() => {});
    toast.success("Copied");
  };

  return (
    <div className="space-y-6">
      <PreselectedNotice needed={neededTokens} preselected={preselectedPackId} />

      {/* 1. Pack cards — the only place tokens are chosen (fixed list, no free typing) */}
      {phase === "pack" ? (
        <section className="space-y-3">
          <h2 className="text-sm font-semibold text-muted-foreground">
            Choose a pack
          </h2>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {packs.map((pack) => {
              const isSelected = packId === pack.id;
              const insufficient =
                neededTokens != null &&
                neededTokens > 0 &&
                pack.tokens < neededTokens;
              return (
                <button
                  key={pack.id}
                  type="button"
                  onClick={() => setPackId(pack.id)}
                  className="text-left"
                >
                  <Card
                    variant={isSelected ? "gold" : "default"}
                    className={insufficient ? "opacity-60" : undefined}
                  >
                    <CardHeader>
                      <CardTitle className="flex items-center gap-2">
                        <span
                          className={
                            isSelected ? "text-gold" : "text-muted-foreground"
                          }
                        >
                          {pack.label}
                        </span>
                        {isSelected ? (
                          <Badge variant="gold-outline">Selected</Badge>
                        ) : null}
                        {insufficient ? (
                          <Badge variant="outline">Below needed</Badge>
                        ) : null}
                      </CardTitle>
                      <CardDescription>
                        {formatPkr(pack.price_pkr)}
                        <span className="text-muted-foreground">
                          {" "}
                          · {pack.tokens.toLocaleString("en-US")} tokens
                        </span>
                      </CardDescription>
                    </CardHeader>
                    <CardContent>
                      <div className="flex items-baseline gap-2">
                        <span className="font-heading text-3xl font-semibold tabular-nums text-gold">
                          {pack.tokens.toLocaleString("en-US")}
                        </span>
                        <span className="text-sm text-muted-foreground">
                          tokens
                        </span>
                      </div>
                      <p className="mt-2 text-xs text-muted-foreground">
                        1 PKR = 2 tokens · {formatPkr(pack.price_pkr)} locked.
                      </p>
                    </CardContent>
                  </Card>
                </button>
              );
            })}
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <Button
              size="lg"
              className="shadow-gold"
              disabled={!packId || pendingTransition}
              onClick={() => setPhase("method")}
            >
              Continue
            </Button>
            <Button
              asChild
              size="lg"
              variant="ghost"
              disabled={pendingTransition}
            >
              <Link href={returnUrl}>Back</Link>
            </Button>
          </div>
        </section>
      ) : null}

      {/* 2. Method cards */}
      {phase === "method" ? (
        <section className="space-y-3">
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-sm font-semibold text-muted-foreground">
              Pay for{" "}
              {selectedPack
                ? `${selectedPack.tokens.toLocaleString("en-US")} tokens · ${formatPkr(selectedPack.price_pkr)}`
                : "selected pack"}
            </h2>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setPhase("pack")}
            >
              Change pack
            </Button>
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            {(Object.keys(METHOD_META) as MethodChoice[]).map((key) => {
              const meta = METHOD_META[key];
              const Icon = meta.icon;
              return (
                <button key={key} type="button" onClick={() => setMethod(key)}>
                  <Card
                    variant={method === key ? "gold" : "default"}
                    className="h-full text-left"
                  >
                    <CardHeader>
                      <CardTitle className="flex items-center gap-2">
                        <Icon className="size-4 text-gold" />
                        {meta.label}
                      </CardTitle>
                      <CardDescription className="text-xs">
                        {meta.note}
                      </CardDescription>
                    </CardHeader>
                  </Card>
                </button>
              );
            })}
          </div>

          <div className="flex flex-wrap gap-2">
            <Button
              size="lg"
              className="shadow-gold"
              disabled={!method || busy}
              onClick={async () => {
                if (!packId || !method) return;
                setBusy(true);
                try {
                  if (method === "crypto") {
                    const result = await createCryptoTopupAction(
                      packId,
                      returnUrl
                    );
                    if ("error" in result) {
                      toast.error(result.error);
                      setBusy(false);
                    } else {
                      router.push(
                        `/wallet/topup/status?id=${result.topupId}&return=${encodeURIComponent(returnUrl)}`
                      );
                    }
                  } else {
                    const result = await beginManualTopupAction(
                      packId,
                      method
                    );
                    if ("error" in result) {
                      toast.error(result.error);
                      setBusy(false);
                    } else {
                      const account =
                        method === "jazzcash"
                          ? accounts.jazzcash
                          : accounts.easypaisa;
                      setManual({
                        topupId: result.topupId,
                        referenceCode: result.referenceCode,
                        expiresAt: result.expiresAt,
                        pricePkr: result.pricePkr,
                        tokens: result.tokens,
                        account,
                        method,
                      });
                      setPhase("manual");
                      setBusy(false);
                    }
                  }
                } catch (err) {
                  toast.error(
                    err instanceof Error ? err.message : "Something went wrong."
                  );
                  setBusy(false);
                }
              }}
            >
              {busy ? (
                <>
                  <Loader2Icon data-icon="inline-start" className="animate-spin" />
                  Working…
                </>
              ) : method === "crypto" ? (
                "Pay with crypto"
              ) : (
                `Pay with ${method === "jazzcash" ? "JazzCash" : "Easypaisa"}`
              )}
            </Button>
            <Button size="lg" variant="ghost" onClick={() => setPhase("method")}>
              Back
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            Crypto is instant; JazzCash/Easypaisa go to finance for review and
            have a 30-minute payment window.
          </p>
        </section>
      ) : null}

      {phase === "manual" && manual ? (
        <ManualSubmission
          topupId={manual.topupId}
          referenceCode={manual.referenceCode}
          expiresAt={manual.expiresAt}
          pricePkr={manual.pricePkr}
          tokens={manual.tokens}
          account={manual.account}
          method={manual.method}
          returnUrl={returnUrl}
          userId={userId}
          onBack={() => setPhase("method")}
          copyToClipboard={copyToClipboard}
        />
      ) : null}
    </div>
  );
}

type ManualSubmissionProps = {
  topupId: string;
  referenceCode: string;
  expiresAt: string;
  pricePkr: number;
  tokens: number;
  account: ManualAccount | null;
  method: "jazzcash" | "easypaisa";
  returnUrl: string;
  userId: string;
  onBack: () => void;
  copyToClipboard: (text: string) => void;
};

function Countdown({ expiresAt }: { expiresAt: string }) {
  const [left, setLeft] = useState(() => {
    const ms = new Date(expiresAt).getTime() - Date.now();
    return Math.max(0, ms);
  });
  useState(() => {
    const timer = setInterval(() => {
      setLeft(Math.max(0, new Date(expiresAt).getTime() - Date.now()));
    }, 1000);
    return () => clearInterval(timer);
  });
  const mins = Math.floor(left / 60000);
  const secs = Math.floor((left % 60000) / 1000);
  const expired = left <= 0;
  return (
    <span className={expired ? "text-destructive" : "text-gold"}>
      {expired
        ? "Window expired — start again"
        : `${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")} left`}
    </span>
  );
}

function ManualSubmission({
  topupId,
  referenceCode,
  expiresAt,
  pricePkr,
  tokens,
  account,
  method,
  returnUrl,
  userId,
  onBack,
  copyToClipboard,
}: ManualSubmissionProps) {
  const router = useRouter();
  const [transactionId, setTransactionId] = useState("");
  const [senderNumber, setSenderNumber] = useState("");
  const [screenshotPath, setScreenshotPath] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleFileChange(file: File | null) {
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) {
      setError("Screenshot must be under 5 MB.");
      return;
    }
    if (!file.type.startsWith("image/")) {
      setError("Please choose an image file.");
      return;
    }
    setError(null);
    setUploading(true);
    try {
      const supabase = createClient();
      const key = `${userId}/${topupId}/screenshot-${Date.now()}.${file.name.split(".").pop() ?? "jpg"}`;
      const { error: uploadError } = await supabase.storage
        .from(TOPUP_SCREENSHOT_BUCKET)
        .upload(key, file, { contentType: file.type, upsert: true });
      if (uploadError) {
        setError(uploadError.message);
      } else {
        setScreenshotPath(key);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed.");
    } finally {
      setUploading(false);
    }
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setSubmitting(true);
    const result = await submitManualTopupAction({
      topupId,
      transactionId,
      senderNumber,
      screenshotPath,
    });
    if ("error" in result) {
      setError(result.error ?? "Something went wrong");
      setSubmitting(false);
    } else {
      router.push(
        `/wallet/topup/status?id=${topupId}&return=${encodeURIComponent(returnUrl)}`
      );
    }
  }

  return (
    <div className="space-y-4">
      <Card variant="gold">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <QrCodeIcon className="size-4 text-gold" /> Pay via{" "}
            {method === "jazzcash" ? "JazzCash" : "Easypaisa"}
          </CardTitle>
          <CardDescription>
            Send the exact amount from your {method === "jazzcash" ? "JazzCash" : "Easypaisa"} app to the account below, then submit the
            details so finance can verify and credit your wallet.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-3">
            <div>
              <div className="text-xs tracking-wider text-muted-foreground uppercase">
                Exact amount
              </div>
              <div className="mt-1 font-heading text-2xl font-semibold">
                PKR {pricePkr.toLocaleString("en-US")}
              </div>
              <div className="text-xs text-muted-foreground">
                = {tokens.toLocaleString("en-US")} tokens
              </div>
            </div>
            <div>
              <div className="text-xs tracking-wider text-muted-foreground uppercase">
                Reference code
              </div>
              <button
                type="button"
                className="mt-1 flex items-center gap-2 font-mono text-sm font-semibold text-gold hover:underline"
                onClick={() => copyToClipboard(referenceCode)}
              >
                {referenceCode} <CopyIcon className="size-3" />
              </button>
              <div className="text-xs text-muted-foreground">
                Put this in the payment note (if your app allows it).
              </div>
            </div>
            <div>
              <div className="text-xs tracking-wider text-muted-foreground uppercase">
                Window
              </div>
              <div className="mt-1 text-sm font-medium tabular-nums">
                <Countdown expiresAt={expiresAt} />
              </div>
            </div>
          </div>

          <Separator />

          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <div className="text-xs tracking-wider text-muted-foreground uppercase">
                Account
              </div>
              {account ? (
                <div className="mt-2 space-y-1">
                  <div className="flex items-center gap-2 font-mono text-sm">
                    {account.account_number}{" "}
                    <button
                      type="button"
                      className="text-gold hover:underline"
                      onClick={() => copyToClipboard(account.account_number)}
                    >
                      <CopyIcon className="size-3" />
                    </button>
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {account.account_name}
                  </div>
                </div>
              ) : (
                <p className="mt-1 text-xs text-muted-foreground">
                  No account configured yet — contact finance to set it up.
                </p>
              )}
            </div>
            {account?.qr_data_url ? (
              <div className="flex flex-col items-start gap-2">
                <div className="text-xs tracking-wider text-muted-foreground uppercase">
                  QR
                </div>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={account.qr_data_url}
                  alt="Payment QR"
                  className="h-32 w-32 rounded-lg border border-border/70 bg-muted/30 object-contain p-2"
                />
              </div>
            ) : (
              <div className="rounded-lg border border-dashed border-border/70 bg-muted/20 p-3 text-xs text-muted-foreground">
                QR not yet configured in settings. Use the account number
                above.
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      <form onSubmit={handleSubmit} className="space-y-4" noValidate>
        {error ? (
          <p className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {error}
          </p>
        ) : null}

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="tx">Transaction ID *</Label>
            <Input
              id="tx"
              name="tx"
              placeholder="e.g. TXN-123456"
              value={transactionId}
              onChange={(e) => setTransactionId(e.target.value)}
              required
              maxLength={64}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="sender">Sender number *</Label>
            <Input
              id="sender"
              name="sender"
              placeholder="0300-xxxxxxx"
              value={senderNumber}
              onChange={(e) => setSenderNumber(e.target.value)}
              required
            />
          </div>
        </div>

        <div className="space-y-2">
          <Label htmlFor="screenshot">Screenshot of the transfer</Label>
          <div className="flex items-center gap-2">
            <Input
              id="screenshot"
              type="file"
              accept="image/*"
              onChange={(e) =>
                handleFileChange(e.target.files?.[0] ?? null)
              }
              disabled={uploading}
            />
            {uploading ? (
              <Loader2Icon className="size-4 animate-spin text-muted-foreground" />
            ) : null}
          </div>
          {screenshotPath ? (
            <p className="text-xs text-success">Screenshot attached.</p>
          ) : null}
        </div>

        <div className="flex flex-wrap gap-2">
          <Button
            type="submit"
            className="shadow-gold"
            disabled={submitting || uploading}
          >
            {submitting ? (
              <>
                <Loader2Icon data-icon="inline-start" className="animate-spin" />
                Submitting…
              </>
            ) : (
              <>
                <UploadIcon data-icon="inline-start" /> Submit for review
              </>
            )}
          </Button>
          <Button
            type="button"
            variant="ghost"
            onClick={onBack}
            disabled={submitting || uploading}
          >
            Back
          </Button>
        </div>
      </form>
    </div>
  );
}
