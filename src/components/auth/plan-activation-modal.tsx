"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Check,
  CheckCircle2,
  Crown,
  Loader2,
  Sparkles,
  X,
  Zap,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { refreshCurrentUser, useSession } from "@/lib/auth";
import { showToast } from "@/components/ui/toast";

declare global {
  interface Window {
    Razorpay: any;
  }
}

export function PlanActivationModal({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const router = useRouter();
  const { user } = useSession();
  const [activatingFree, setActivatingFree] = useState(false);
  const [purchasingPaid, setPurchasingPaid] = useState(false);

  if (!open || !user) return null;

  async function handleActivateFree() {
    setActivatingFree(true);
    try {
      const res = await fetch("/api/auth/activate-free-plan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: user?.email }),
      });
      const data = await res.json().catch(() => null);

      if (res.ok) {
        await refreshCurrentUser();
        showToast("Free Plan activated! 50 credits granted.", "success");
        onClose();
      } else {
        showToast(data?.error || "Failed to activate Free Plan.", "error");
      }
    } catch {
      showToast("Network error. Please try again.", "error");
    } finally {
      setActivatingFree(false);
    }
  }

  async function handleRazorpayCheckout() {
    setPurchasingPaid(true);
    try {
      const orderRes = await fetch("/api/payment/create-order", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: user?.email }),
      });
      const orderData = await orderRes.json().catch(() => null);

      if (!orderRes.ok || !orderData?.orderId) {
        showToast(orderData?.error || "Failed to initiate payment.", "error");
        setPurchasingPaid(false);
        return;
      }

      // Load Razorpay Script dynamically if needed
      if (!window.Razorpay) {
        const script = document.createElement("script");
        script.src = "https://checkout.razorpay.com/v1/checkout.js";
        script.async = true;
        document.body.appendChild(script);
        await new Promise((resolve) => {
          script.onload = resolve;
        });
      }

      const options = {
        key: orderData.keyId,
        amount: orderData.amount,
        currency: orderData.currency,
        name: "Nexus AI",
        description: "Pro Unlimited Plan - Lifetime Unlimited Chat & Tools",
        image: "/favicon.ico",
        order_id: orderData.orderId,
        handler: async function (response: any) {
          // Verify payment on backend
          const verifyRes = await fetch("/api/payment/verify", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              email: user?.email,
              razorpay_payment_id: response.razorpay_payment_id,
              razorpay_order_id: response.razorpay_order_id,
              razorpay_signature: response.razorpay_signature,
            }),
          });

          if (verifyRes.ok) {
            await refreshCurrentUser();
            showToast("Payment successful! Pro Unlimited Plan activated.", "success");
            onClose();
            router.push(
              `/payment/success?payment_id=${response.razorpay_payment_id}&order_id=${response.razorpay_order_id}`,
            );
          } else {
            const data = await verifyRes.json().catch(() => null);
            onClose();
            router.push(
              `/payment/failure?reason=${encodeURIComponent(
                data?.error || "Payment verification failed",
              )}`,
            );
          }
        },
        prefill: {
          email: user?.email,
          name: user?.name || "",
        },
        theme: {
          color: "#4f5bd5",
        },
      };

      const rzp = new window.Razorpay(options);
      rzp.open();
    } catch (err) {
      console.error("Razorpay Error:", err);
      showToast("Razorpay payment window failed to open.", "error");
    } finally {
      setPurchasingPaid(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-md p-3 sm:p-4 animate-in fade-in duration-200">
      <div className="relative w-full max-w-xl max-h-[88vh] sm:max-h-[85vh] overflow-y-auto rounded-3xl border border-border bg-sidebar p-4 sm:p-8 shadow-2xl space-y-4 sm:space-y-6 scrollbar-none animate-in zoom-in-95 duration-200">
        <button
          onClick={onClose}
          disabled={activatingFree || purchasingPaid}
          className="absolute right-3 top-3 sm:right-4 sm:top-4 rounded-full p-1.5 sm:p-2 text-muted-foreground hover:bg-elevated hover:text-foreground transition-colors cursor-pointer disabled:opacity-50 z-10"
          aria-label="Close modal"
          title="Close modal"
        >
          <X className="size-4 sm:size-5" />
        </button>
        <div className="text-center space-y-1.5 sm:space-y-2">
          <div className="mx-auto grid size-11 sm:size-14 place-items-center rounded-2xl bg-primary/15 text-primary ring-1 ring-primary/30 shadow-xs mb-1 sm:mb-2">
            <Sparkles className="size-5 sm:size-7 text-primary" />
          </div>
          <h2 className="text-2xl font-bold font-display tracking-tight text-foreground">
            {user.plan === "paid"
              ? "Pro Unlimited Plan Active"
              : user.plan === "free"
              ? "Your Workspace Plans & Upgrades"
              : "Activate Your Plan to Start Chatting"}
          </h2>
          <p className="text-xs sm:text-sm text-muted-foreground max-w-md mx-auto leading-relaxed">
            {user.plan === "paid"
              ? "You have lifetime unlimited AI messages, web searches, and priority tool execution."
              : user.plan === "free"
              ? `You are currently on the Free Starter plan (${user.credits ?? 0} credits remaining). Upgrade to Pro anytime for unlimited access.`
              : "Welcome to Nexus AI! Choose a plan below to activate your account and start interacting with your tools."}
          </p>
        </div>

        {/* 2 Plan Cards */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-2">
          {/* Free Plan Card */}
          <div className="flex flex-col justify-between rounded-2xl border border-border bg-surface p-5 space-y-4 hover:border-primary/40 transition-all shadow-xs">
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                  Starter Plan
                </span>
                <Zap className="size-4 text-emerald-400" />
              </div>
              <h3 className="text-xl font-bold text-foreground">Free Starter</h3>
              <p className="text-2xl font-extrabold text-foreground">
                50 <span className="text-xs font-normal text-muted-foreground">Free Credits</span>
              </p>
              <ul className="space-y-2 text-xs text-muted-foreground pt-2">
                <li className="flex items-center gap-1.5">
                  <Check className="size-3.5 text-emerald-400 shrink-0" />
                  50 AI Messages turn allowance
                </li>
                <li className="flex items-center gap-1.5">
                  <Check className="size-3.5 text-emerald-400 shrink-0" />
                  Standard Web Search &amp; Tool Calling
                </li>
                <li className="flex items-center gap-1.5">
                  <Check className="size-3.5 text-emerald-400 shrink-0" />
                  Cloud Thread History
                </li>
              </ul>
            </div>

            {user.plan === "paid" ? (
              <Button
                type="button"
                disabled
                variant="outline"
                className="w-full justify-center gap-2 py-2.5 text-xs font-semibold opacity-60 cursor-not-allowed"
              >
                Plan Superseded by Pro
              </Button>
            ) : user.plan === "free" ? (
              <Button
                type="button"
                disabled
                variant="outline"
                className="w-full justify-center gap-2 py-2.5 text-xs font-semibold border-emerald-500/40 text-emerald-400 bg-emerald-500/10 cursor-default"
              >
                <CheckCircle2 className="size-3.5 text-emerald-400" /> Current Plan Active
              </Button>
            ) : (
              <Button
                type="button"
                onClick={handleActivateFree}
                disabled={activatingFree || purchasingPaid}
                variant="outline"
                className="w-full justify-center gap-2 py-2.5 text-xs font-semibold cursor-pointer"
              >
                {activatingFree ? (
                  <>
                    <Loader2 className="size-3.5 animate-spin" /> Activating...
                  </>
                ) : (
                  <>
                    <CheckCircle2 className="size-3.5 text-emerald-400" /> Activate 50 Free Credits
                  </>
                )}
              </Button>
            )}
          </div>

          {/* Pro Unlimited Plan Card */}
          <div className="relative flex flex-col justify-between rounded-2xl border-2 border-primary/60 bg-gradient-to-b from-primary/10 via-surface to-surface p-5 space-y-4 hover:border-primary transition-all shadow-md">
            <span className="absolute -top-3 right-4 rounded-full bg-primary px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-primary-foreground shadow-xs">
              {user.plan === "paid" ? "Active" : "Recommended"}
            </span>
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold uppercase tracking-wider text-primary">
                  Pro Plan
                </span>
                <Crown className="size-4 text-amber-400" />
              </div>
              <h3 className="text-xl font-bold text-foreground">Pro Unlimited</h3>
              <p className="text-2xl font-extrabold text-foreground">
                ₹299 <span className="text-xs font-normal text-muted-foreground">/ Month</span>
              </p>
              <ul className="space-y-2 text-xs text-muted-foreground pt-2">
                <li className="flex items-center gap-1.5 font-medium text-foreground">
                  <Check className="size-3.5 text-primary shrink-0" />
                  Unlimited AI Chat Messages
                </li>
                <li className="flex items-center gap-1.5 font-medium text-foreground">
                  <Check className="size-3.5 text-primary shrink-0" />
                  Unlimited Voice AI Chat &amp; Speech Synthesis
                </li>
                <li className="flex items-center gap-1.5 font-medium text-foreground">
                  <Check className="size-3.5 text-primary shrink-0" />
                  Unlimited Real-Time Web Tool Calls
                </li>
                <li className="flex items-center gap-1.5">
                  <Check className="size-3.5 text-primary shrink-0" />
                  Priority LLM Processing Speed
                </li>
              </ul>
            </div>

            {user.plan === "paid" ? (
              <Button
                type="button"
                disabled
                className="w-full justify-center gap-2 py-2.5 text-xs font-semibold bg-emerald-600 text-white shadow-md cursor-default"
              >
                <Crown className="size-3.5 text-amber-300" /> Current Plan Active (Pro)
              </Button>
            ) : (
              <Button
                type="button"
                onClick={handleRazorpayCheckout}
                disabled={activatingFree || purchasingPaid}
                className="w-full justify-center gap-2 py-2.5 text-xs font-semibold cursor-pointer shadow-md shadow-primary/25"
              >
                {purchasingPaid ? (
                  <>
                    <Loader2 className="size-3.5 animate-spin" /> Connecting Razorpay...
                  </>
                ) : (
                  <>
                    <Crown className="size-3.5 text-amber-300" /> Buy Pro Unlimited (Razorpay)
                  </>
                )}
              </Button>
            )}
          </div>
        </div>

        <div className="pt-2 text-center text-[11px] text-muted-foreground">
          <p>
            Want to see full plan features and comparison?{" "}
            <Link
              href="/plans"
              onClick={onClose}
              className="text-primary hover:underline font-medium cursor-pointer"
            >
              View Dedicated Plans Page &rarr;
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}
