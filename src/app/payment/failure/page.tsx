"use client";

import { Suspense } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import {
  AlertCircle,
  ArrowLeft,
  HelpCircle,
  RefreshCw,
  XCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";

function FailureContent() {
  const searchParams = useSearchParams();
  const rawReason = searchParams.get("reason") || "Payment request was cancelled or declined by your bank.";

  return (
    <div className="mx-auto max-w-xl px-4 py-16 text-center space-y-8 animate-in fade-in zoom-in-95 duration-300">
      {/* Error Badge */}
      <div className="relative mx-auto grid size-20 place-items-center rounded-3xl bg-destructive/15 text-destructive ring-2 ring-destructive/30 shadow-2xl shadow-destructive/20">
        <XCircle className="size-10" />
        <div className="pointer-events-none absolute -inset-2 rounded-3xl bg-destructive/10 blur-xl -z-10 animate-pulse" />
      </div>

      {/* Header */}
      <div className="space-y-3">
        <div className="inline-flex items-center gap-1.5 rounded-full border border-destructive/30 bg-destructive/10 px-3 py-1 text-xs font-semibold text-destructive">
          <AlertCircle className="size-3.5" /> Payment Unsuccessful
        </div>
        <h1 className="text-3xl sm:text-4xl font-bold font-display tracking-tight text-foreground">
          Payment Failed
        </h1>
        <p className="text-sm text-muted-foreground max-w-md mx-auto leading-relaxed">
          We couldn't process your transaction. Don't worry, your account was not charged.
        </p>
      </div>

      {/* Reason Box */}
      <div className="rounded-3xl border border-destructive/20 bg-sidebar/90 p-6 space-y-4 shadow-xl backdrop-blur-md text-left">
        <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-destructive border-b border-border/80 pb-3">
          <AlertCircle className="size-4" /> Failure Details
        </div>

        <p className="text-xs text-foreground bg-surface p-3.5 rounded-2xl border border-border/60 leading-relaxed font-mono">
          {rawReason}
        </p>

        <div className="space-y-2 pt-1 text-xs text-muted-foreground">
          <p className="font-semibold text-foreground flex items-center gap-1.5 text-[11.5px]">
            <HelpCircle className="size-3.5 text-primary" /> Troubleshooting Tips:
          </p>
          <ul className="list-disc list-inside space-y-1 text-[11.5px] leading-relaxed">
            <li>Check if your card or UPI app has sufficient balance.</li>
            <li>Ensure 3D Secure OTP authentication was completed.</li>
            <li>Try using another payment method (UPI, Netbanking, or Debit/Credit Card).</li>
          </ul>
        </div>
      </div>

      {/* Action Buttons */}
      <div className="flex flex-col sm:flex-row items-center justify-center gap-3 pt-2">
        <Button
          asChild
          className="w-full sm:w-auto py-3 px-8 text-xs font-semibold gap-2 cursor-pointer shadow-lg shadow-primary/25"
        >
          <Link href="/plans">
            <RefreshCw className="size-3.5" /> Retry Payment on Plans Page
          </Link>
        </Button>
        <Button
          variant="outline"
          asChild
          className="w-full sm:w-auto py-3 px-6 text-xs font-medium cursor-pointer"
        >
          <Link href="/">
            <ArrowLeft className="size-3.5" /> Return to Workspace
          </Link>
        </Button>
      </div>
    </div>
  );
}

export default function PaymentFailurePage() {
  return (
    <div className="relative min-h-screen w-full bg-background text-foreground flex flex-col justify-center items-center">
      <div className="pointer-events-none absolute -top-40 left-1/2 -translate-x-1/2 size-[600px] rounded-full bg-destructive/10 blur-3xl" />
      <Suspense fallback={<div className="text-xs text-muted-foreground">Loading details...</div>}>
        <FailureContent />
      </Suspense>
    </div>
  );
}
