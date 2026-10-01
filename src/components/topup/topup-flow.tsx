"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  BitcoinIcon,
  CheckIcon,
  CopyIcon,
  Loader2Icon,
  QrCodeIcon,
  SearchIcon,
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
import { sanitizeReturnUrl, TOPUP_SCREENSHOT_BUCKET, formatCryptoCode } from "@/lib/topups/types";
import type {
  CryptoCurrency,
  ManualAccount,
  TokenPack,
} from "@/lib/topups/types";
import {
  beginManualTopupAction,
  createCryptoTopupAction,
  getCryptoCoinInfoAction,
  listCryptoCurrenciesAction,
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
  const [phase, setPhase] = useState<"pack" | "method" | "crypto" | "manual">("pack");
  const [packId, setPackId] = useState<string | null>(preselectedPackId);
  const [method, setMethod] = useState<MethodChoice | null>(null);
  const [manual, setManual] = useState<ManualState | null>(null);
  const [busy, setBusy] = useState(false);
  const [pendingTransition, startTransition] = useTransition();
  // Crypto checkout: the coin list is fetched from our server (which
  // talks to NOWPayments — the browser never sees the API key).
  const [currencies, setCurrencies] = useState<CryptoCurrency[] | null>(null);
  const [coinQuery, setCoinQuery] = useState("");
  const [selectedCoin, setSelectedCoin] = useState<CryptoCurrency | null>(null);
  const [coinInfo, setCoinInfo] = useState<{ minUsd: number | null; packUsd: number | null } | null>(null);
  const [coinInfoLoading, setCoinInfoLoading] = useState(false);
  const [creatingPayment, setCreatingPayment] = useState(false);

  const selectedPack = useMemo(
    () => packs.find((p) => p.id === packId) ?? null,
    [packs, packId]
  );

  const filteredCoins = useMemo(() => {
    if (!currencies) return [];
    const q = coinQuery.trim().toLowerCase();
    if (!q) return currencies;
    return currencies.filter(
      (c) =>
        c.code.includes(q) ||
        c.name.toLowerCase().includes(q) ||
        (c.network ?? "").toLowerCase().includes(q)
    );
  }, [currencies, coinQuery]);
  const visibleCoins = filteredCoins.slice(0, 60);

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
                    // Not a payment yet — open the coin selector. The
                    // payment is created only after a coin is chosen.
                    setPhase("crypto");
                    setBusy(false);
                    if (!currencies) {
                      startTransition(async () => {
                        const res = await listCryptoCurrenciesAction();
                        if ("error" in res) {
                          toast.error(res.error);
                          setPhase("method");
                        } else {
                          setCurrencies(res.currencies);
                        }
                      });
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

      {/* 3. Crypto coin selector — coins come from NOWPayments via our
          server (enabled for this account only); the payment is created
          server-side for the chosen ticker. */}
      {phase === "crypto" ? (
        <section className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-sm font-semibold text-muted-foreground">
              Pay for{" "}
              {selectedPack
                ? `${selectedPack.tokens.toLocaleString("en-US")} tokens · ${formatPkr(selectedPack.price_pkr)}`
                : "selected pack"}{" "}
              with crypto
            </h2>
            <Button size="sm" variant="ghost" onClick={() => setPhase("method")}>
              Change method
            </Button>
          </div>

          <div className="relative">
            <SearchIcon className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={coinQuery}
              onChange={(e) => setCoinQuery(e.target.value)}
              placeholder="Search coin or network — BTC, USDT, TRC20…"
              className="pl-9"
              aria-label="Search cryptocurrency"
            />
          </div>

          {currencies === null ? (
            <div className="space-y-2">
              {Array.from({ length: 5 }).map((_, i) => (
                <div
                  key={i}
                  className="h-14 animate-pulse rounded-lg border border-border/70 bg-surface/40"
                />
              ))}
            </div>
          ) : filteredCoins.length === 0 ? (
            <p className="rounded-lg border border-border/70 bg-surface/40 px-3 py-6 text-center text-sm text-muted-foreground">
              No coins match “{coinQuery}”.
            </p>
          ) : (
            <>
              <div className="grid max-h-96 grid-cols-1 gap-2 overflow-y-auto pr-1 sm:grid-cols-2">
                {visibleCoins.map((coin) => {
                  const isSelected = selectedCoin?.code === coin.code;
                  return (
                    <button
                      key={coin.code}
                      type="button"
                      onClick={() => {
                        setSelectedCoin(coin);
                        setCoinInfo(null);
                        setCoinInfoLoading(true);
                        startTransition(async () => {
                          const info = await getCryptoCoinInfoAction(
                            packId!,
                            coin.code
                          );
                          if (!("error" in info)) setCoinInfo(info);
                          setCoinInfoLoading(false);
                        });
                      }}
                      className="text-left"
                    >
                      <Card
                        variant={isSelected ? "gold" : "default"}
                        className="transition-colors"
                      >
                        <CardContent className="flex items-center gap-3 py-3">
                          {coin.logoUrl ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img
                              src={coin.logoUrl}
                              alt=""
                              loading="lazy"
                              className="size-7 shrink-0 rounded-full"
                            />
                          ) : (
                            <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-gold/15 text-[10px] font-semibold text-gold">
                              {formatCryptoCode(coin.code).symbol.slice(0, 3)}
                            </span>
                          )}
                          <span className="min-w-0 flex-1">
                            <span className="flex items-center gap-2">
                              <span className="truncate text-sm font-medium">
                                {coin.name}
                              </span>
                              {coin.popular ? (
                                <Badge variant="gold-outline" className="shrink-0">
                                  Popular
                                </Badge>
                              ) : null}
                            </span>
                            <span className="mt-0.5 block text-xs text-muted-foreground uppercase">
                              {formatCryptoCode(coin.code).symbol}
                              {coin.network ? ` · ${coin.network}` : ""}
                            </span>
                          </span>
                          {isSelected ? (
                            <CheckIcon className="size-4 shrink-0 text-gold" />
                          ) : null}
                        </CardContent>
                      </Card>
                    </button>
                  );
                })}
              </div>
              {filteredCoins.length > visibleCoins.length ? (
                <p className="text-xs text-muted-foreground">
                  Showing {visibleCoins.length} of {filteredCoins.length} — keep
                  typing to narrow it down.
                </p>
              ) : null}
            </>
          )}

          {selectedCoin ? (
            <div className="space-y-3 rounded-xl border border-gold/30 bg-gradient-to-b from-gold/[0.07] to-transparent p-4">
              <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
                <span className="text-muted-foreground">
                  Paying with{" "}
                  <span className="font-medium text-foreground">
                    {selectedCoin.name}
                  </span>{" "}
                  <span className="text-xs uppercase">
                    ({formatCryptoCode(selectedCoin.code).symbol}
                    {selectedCoin.network
                      ? ` · ${selectedCoin.network}`
                      : ""}
                    )
                  </span>
                </span>
                {coinInfoLoading ? (
                  <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
                    <Loader2Icon className="size-3 animate-spin" />
                    Checking network minimum…
                  </span>
                ) : coinInfo ? (
                  coinInfo.minUsd != null ? (
                    <span className="text-xs text-muted-foreground">
                      Network minimum ~${coinInfo.minUsd.toFixed(2)}
                    </span>
                  ) : null
                ) : null}
              </div>

              {coinInfo &&
              coinInfo.minUsd != null &&
              coinInfo.packUsd != null &&
              coinInfo.packUsd < coinInfo.minUsd ? (
                <p className="rounded-lg bg-destructive/10 px-3 py-2 text-xs text-destructive">
                  This pack (${coinInfo.packUsd.toFixed(2)}) is below{" "}
                  {selectedCoin.name}&apos;s network minimum of ~$
                  {coinInfo.minUsd.toFixed(2)} — choose another coin or a
                  bigger pack.
                </p>
              ) : null}

              <div className="flex flex-wrap items-center gap-2">
                <Button
                  size="lg"
                  className="shadow-gold"
                  disabled={
                    creatingPayment ||
                    (coinInfo != null &&
                      coinInfo.minUsd != null &&
                      coinInfo.packUsd != null &&
                      coinInfo.packUsd < coinInfo.minUsd)
                  }
                  onClick={async () => {
                    if (!packId || !selectedCoin) return;
                    setCreatingPayment(true);
                    try {
                      const result = await createCryptoTopupAction(
                        packId,
                        selectedCoin.code,
                        returnUrl
                      );
                      if ("error" in result) {
                        toast.error(result.error);
                        setCreatingPayment(false);
                      } else {
                        router.push(
                          `/wallet/topup/status?id=${result.topupId}&return=${encodeURIComponent(returnUrl)}`
                        );
                      }
                    } catch (err) {
                      toast.error(
                        err instanceof Error
                          ? err.message
                          : "Could not create the payment."
                      );
                      setCreatingPayment(false);
                    }
                  }}
                >
                  {creatingPayment ? (
                    <>
                      <Loader2Icon data-icon="inline-start" className="animate-spin" />
                      Creating payment…
                    </>
                  ) : (
                    "Create crypto payment"
                  )}
                </Button>
                <Button
                  size="lg"
                  variant="ghost"
                  onClick={() => setSelectedCoin(null)}
                >
                  Clear selection
                </Button>
              </div>
            </div>
          ) : null}

          <p className="text-xs text-muted-foreground">
            Coins are fetched live from NOWPayments and limited to what our
            account supports. The exact amount, address and QR appear on the
            next screen.
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
