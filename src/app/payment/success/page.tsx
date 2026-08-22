"use client";

import { Suspense } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import {
  ArrowRight,
  CheckCircle2,
  Crown,
  ShieldCheck,
  Sparkles,
  Zap,
} from "lucide-react";
import { Button } from "@/components/ui/button";

function SuccessContent() {
  const searchParams = useSearchParams();
  const paymentId = searchParams.get("payment_id") || "pay_demo_success";
  const orderId = searchParams.get("order_id") || "order_demo_success";

  return (
    <div className="mx-auto max-w-xl px-4 py-16 text-center space-y-8 animate-in fade-in zoom-in-95 duration-300">
      {/* Success Badge */}
      <div className="relative mx-auto grid size-20 place-items-center rounded-3xl bg-emerald-500/15 text-emerald-400 ring-2 ring-emerald-500/30 shadow-2xl shadow-emerald-500/20">
        <CheckCircle2 className="size-10 animate-bounce duration-1000" />
        <div className="pointer-events-none absolute -inset-2 rounded-3xl bg-emerald-500/10 blur-xl -z-10 animate-pulse" />
      </div>

      {/* Header */}
      <div className="space-y-3">
        <div className="inline-flex items-center gap-1.5 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-3 py-1 text-xs font-semibold text-emerald-300">
          <Sparkles className="size-3.5" /> Order Confirmed
        </div>
        <h1 className="text-3xl sm:text-4xl font-bold font-display tracking-tight text-foreground">
          Payment Successful!
        </h1>
        <p className="text-sm text-muted-foreground max-w-md mx-auto leading-relaxed">
          Welcome to the <strong className="text-foreground">Pro Unlimited Plan</strong>. Your account has been upgraded with lifetime unlimited AI turns and tool calls.
        </p>
      </div>

      {/* Transaction Details Card */}
      <div className="rounded-3xl border border-emerald-500/20 bg-sidebar/90 p-6 space-y-4 shadow-xl backdrop-blur-md text-left">
        <div className="flex items-center justify-between border-b border-border/80 pb-3">
          <div className="flex items-center gap-2">
            <Crown className="size-4 text-amber-400" />
            <span className="text-xs font-bold uppercase tracking-wider text-foreground">
              Pro Unlimited Plan
            </span>
          </div>
          <span className="rounded-full bg-emerald-500/20 px-2.5 py-0.5 text-[11px] font-bold text-emerald-400">
            Active
          </span>
        </div>

        <div className="grid grid-cols-2 gap-4 text-xs">
          <div>
            <p className="text-muted-foreground text-[11px]">Amount Paid</p>
            <p className="text-base font-extrabold text-foreground mt-0.5">₹499.00</p>
          </div>
          <div>
            <p className="text-muted-foreground text-[11px]">Access Level</p>
            <p className="text-xs font-bold text-emerald-400 mt-1">Unlimited Messages</p>
          </div>
          <div>
            <p className="text-muted-foreground text-[11px]">Payment Reference</p>
            <p className="font-mono text-[11px] text-foreground truncate mt-0.5" title={paymentId}>
              {paymentId}
            </p>
          </div>
          <div>
            <p className="text-muted-foreground text-[11px]">Order ID</p>
            <p className="font-mono text-[11px] text-foreground truncate mt-0.5" title={orderId}>
              {orderId}
            </p>
          </div>
        </div>

        <div className="border-t border-border/60 pt-3 flex items-center gap-2 text-[11.5px] text-muted-foreground">
          <ShieldCheck className="size-4 text-emerald-400 shrink-0" />
          <span>Payment verified securely via Razorpay</span>
        </div>
      </div>

      {/* Action Buttons */}
      <div className="flex flex-col sm:flex-row items-center justify-center gap-3 pt-2">
        <Button
          asChild
          className="w-full sm:w-auto py-3 px-8 text-xs font-semibold gap-2 cursor-pointer shadow-lg shadow-primary/25"
        >
          <Link href="/">
            Return to Workspace <ArrowRight className="size-4" />
          </Link>
        </Button>
        <Button
          variant="outline"
          asChild
          className="w-full sm:w-auto py-3 px-6 text-xs font-medium cursor-pointer"
        >
          <Link href="/profile">View Account Profile</Link>
        </Button>
      </div>
    </div>
  );
}

export default function PaymentSuccessPage() {
  return (
    <div className="relative min-h-screen w-full bg-background text-foreground flex flex-col justify-center items-center">
      <div className="pointer-events-none absolute -top-40 left-1/2 -translate-x-1/2 size-[600px] rounded-full bg-emerald-500/10 blur-3xl" />
      <Suspense fallback={<div className="text-xs text-muted-foreground">Loading payment details...</div>}>
        <SuccessContent />
      </Suspense>
    </div>
  );
}
