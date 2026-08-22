"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  Check,
  CheckCircle2,
  ChevronDown,
  Crown,
  HelpCircle,
  Loader2,
  ShieldCheck,
  Sparkles,
  Zap,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { refreshCurrentUser, useSession } from "@/lib/auth";
import { showToast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";

declare global {
  interface Window {
    Razorpay: any;
  }
}

const FAQS = [
  {
    q: "How do the 50 free credits work?",
    a: "When you activate the Free Plan after logging in or registering, you receive 50 prompt credits instantly. Each message or prompt sent to Nexus AI consumes 1 credit.",
  },
  {
    q: "What happens when I reach 0 credits?",
    a: "Chatting and tool execution will pause once your credits reach 0. You can unlock unlimited chatting anytime by upgrading to the Pro Unlimited Plan using Razorpay.",
  },
  {
    q: "How does the Pro Unlimited Plan work?",
    a: "Pro Unlimited gives you lifetime unrestricted access to Nexus AI with zero credit limits, unlimited Web Search tool calls, and high-priority processing speed for ₹499.",
  },
  {
    q: "Is payment via Razorpay secure?",
    a: "Yes! Payments are processed directly through Razorpay's PCI-DSS compliant checkout. We verify payment signatures server-side using HMAC-SHA256 for instant activation.",
  },
  {
    q: "Can I switch or upgrade my plan anytime?",
    a: "Yes! You can upgrade from the Free Starter plan to Pro Unlimited at any time directly from the Plans page or profile dropdown menu.",
  },
];

export default function PlansPage() {
  const router = useRouter();
  const { user, loading } = useSession();
  const [activatingFree, setActivatingFree] = useState(false);
  const [purchasingPaid, setPurchasingPaid] = useState(false);
  const [openFaq, setOpenFaq] = useState<number | null>(0);

  const currentPlan = user?.plan || "none";
  const currentCredits = user?.credits ?? 0;

  async function handleActivateFree() {
    if (!user) {
      showToast("Please log in to activate your Free Plan.", "info");
      return;
    }

    setActivatingFree(true);
    try {
      const res = await fetch("/api/auth/activate-free-plan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: user.email }),
      });
      const data = await res.json().catch(() => null);

      if (res.ok) {
        await refreshCurrentUser();
        showToast("Free Plan activated! 50 credits granted.", "success");
        router.push("/");
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
    if (!user) {
      showToast("Please log in before upgrading to Pro Unlimited.", "info");
      return;
    }

    setPurchasingPaid(true);
    try {
      const orderRes = await fetch("/api/payment/create-order", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: user.email }),
      });
      const orderData = await orderRes.json().catch(() => null);

      if (!orderRes.ok || !orderData?.orderId) {
        showToast(orderData?.error || "Failed to initiate payment.", "error");
        setPurchasingPaid(false);
        return;
      }

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
        description: "Pro Unlimited Plan - Lifetime Unlimited Access",
        image: "/favicon.ico",
        order_id: orderData.orderId,
        handler: async function (response: any) {
          const verifyRes = await fetch("/api/payment/verify", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              email: user.email,
              razorpay_payment_id: response.razorpay_payment_id,
              razorpay_order_id: response.razorpay_order_id,
              razorpay_signature: response.razorpay_signature,
            }),
          });

          if (verifyRes.ok) {
            await refreshCurrentUser();
            showToast("Payment successful! Pro Unlimited Plan activated.", "success");
            router.push(
              `/payment/success?payment_id=${response.razorpay_payment_id}&order_id=${response.razorpay_order_id}`,
            );
          } else {
            const data = await verifyRes.json().catch(() => null);
            router.push(
              `/payment/failure?reason=${encodeURIComponent(
                data?.error || "Payment verification failed",
              )}`,
            );
          }
        },
        prefill: {
          email: user.email,
          name: user.name || "",
        },
        theme: {
          color: "#4f5bd5",
        },
      };

      const rzp = new window.Razorpay(options);
      rzp.open();
    } catch (err) {
      console.error("Razorpay Error:", err);
      showToast("Razorpay checkout failed to initialize.", "error");
    } finally {
      setPurchasingPaid(false);
    }
  }

  return (
    <div className="relative min-h-screen w-full bg-background text-foreground selection:bg-primary/20">
      {/* Background Lighting */}
      <div className="pointer-events-none absolute -top-40 right-1/4 -z-10 size-[600px] rounded-full bg-gradient-to-tr from-primary/20 via-indigo-500/10 to-purple-500/10 blur-3xl opacity-60 animate-pulse duration-1000" />
      <div className="pointer-events-none absolute bottom-10 left-10 -z-10 size-[500px] rounded-full bg-primary/10 blur-3xl" />

      {/* Header */}
      <header className="sticky top-0 z-30 flex h-16 w-full items-center justify-between border-b border-border bg-sidebar/80 px-6 sm:px-10 backdrop-blur-md">
        <div className="flex items-center gap-3">
          <Button
            variant="ghost"
            size="sm"
            asChild
            className="gap-2 text-muted-foreground hover:text-foreground cursor-pointer"
          >
            <Link href="/">
              <ArrowLeft className="size-4" /> Back to Workspace
            </Link>
          </Button>
        </div>

        <div className="flex items-center gap-2">
          {user ? (
            <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-surface px-3 py-1 text-xs text-muted-foreground">
              <Zap className="size-3 text-primary" />
              {currentPlan === "paid" ? (
                <span className="font-semibold text-emerald-400">Pro Unlimited</span>
              ) : currentPlan === "free" ? (
                <span className="font-semibold text-foreground">{currentCredits} / 50 Credits</span>
              ) : (
                <span>No Active Plan</span>
              )}
            </span>
          ) : (
            <span className="text-xs text-muted-foreground">Guest Visitor</span>
          )}
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-4 py-12 sm:px-8 space-y-12">
        {/* Banner Section */}
        <div className="text-center space-y-3 max-w-2xl mx-auto animate-in fade-in duration-300">
          <div className="inline-flex items-center gap-2 rounded-full border border-primary/30 bg-primary/10 px-3.5 py-1 text-xs font-semibold text-primary">
            <Sparkles className="size-3.5" /> Flexible AI Plans &amp; Instant Razorpay Checkout
          </div>
          <h1 className="text-3xl sm:text-5xl font-bold font-display tracking-tight text-foreground">
            Simple, Transparent Pricing
          </h1>
          <p className="text-sm sm:text-base text-muted-foreground leading-relaxed">
            Start with 50 free AI credits, or unlock unlimited chat, real-time web tool calling, and high-priority processing with the Pro Plan.
          </p>
        </div>

        {/* Pricing Cards */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-8 items-stretch max-w-4xl mx-auto">
          {/* Free Starter Card */}
          <div className="relative flex flex-col justify-between rounded-3xl border border-border bg-sidebar/90 p-8 space-y-6 shadow-md transition-all hover:border-primary/40">
            {currentPlan === "free" && (
              <span className="absolute -top-3.5 right-6 rounded-full bg-emerald-600 px-3 py-1 text-xs font-bold uppercase tracking-wider text-white shadow-md flex items-center gap-1">
                <CheckCircle2 className="size-3.5" /> Current Active Plan
              </span>
            )}
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                  Free Plan
                </span>
                <Zap className="size-5 text-emerald-400" />
              </div>
              <h2 className="text-2xl font-bold text-foreground">Free Starter</h2>
              <div className="flex items-baseline gap-1">
                <span className="text-4xl font-extrabold tracking-tight text-foreground">₹0</span>
                <span className="text-sm text-muted-foreground">/ 50 Free Credits</span>
              </div>
              <p className="text-xs text-muted-foreground leading-relaxed">
                Perfect for exploring Nexus AI. Get 50 free credits upon activation after login or registration.
              </p>

              <div className="border-t border-border pt-4 space-y-3">
                <p className="text-xs font-semibold uppercase tracking-wider text-foreground">
                  Included Features:
                </p>
                <ul className="space-y-2.5 text-xs text-muted-foreground">
                  <li className="flex items-center gap-2">
                    <Check className="size-4 text-emerald-400 shrink-0" />
                    <span>50 Total AI Chat Message turns</span>
                  </li>
                  <li className="flex items-center gap-2">
                    <Check className="size-4 text-emerald-400 shrink-0" />
                    <span>Real-Time Web Search &amp; Tool Calling</span>
                  </li>
                  <li className="flex items-center gap-2">
                    <Check className="size-4 text-emerald-400 shrink-0" />
                    <span>Secure Cloud Thread History &amp; Sync</span>
                  </li>
                </ul>
              </div>
            </div>

            <Button
              type="button"
              onClick={handleActivateFree}
              disabled={activatingFree || currentPlan === "free" || currentPlan === "paid" || loading}
              variant="outline"
              className={cn(
                "w-full justify-center gap-2 py-3 text-xs font-semibold cursor-pointer",
                currentPlan === "free" && "border-emerald-500/50 bg-emerald-500/10 text-emerald-400 opacity-100 cursor-default",
                currentPlan === "paid" && "opacity-60 cursor-not-allowed",
              )}
            >
              {activatingFree ? (
                <>
                  <Loader2 className="size-4 animate-spin" /> Activating...
                </>
              ) : currentPlan === "free" ? (
                <>
                  <CheckCircle2 className="size-4 text-emerald-400" /> Current Plan Active ({currentCredits} Credits Left)
                </>
              ) : currentPlan === "paid" ? (
                "Plan Superseded by Pro"
              ) : (
                <>
                  <Zap className="size-4 text-emerald-400" /> Activate Free 50 Credits
                </>
              )}
            </Button>
          </div>

          {/* Pro Unlimited Card */}
          <div className="relative flex flex-col justify-between rounded-3xl border-2 border-primary bg-gradient-to-b from-primary/12 via-sidebar to-sidebar p-8 space-y-6 shadow-2xl transition-all hover:scale-[1.01]">
            <span className={cn(
              "absolute -top-3.5 right-6 rounded-full px-3 py-1 text-xs font-bold uppercase tracking-wider text-white shadow-md flex items-center gap-1",
              currentPlan === "paid" ? "bg-emerald-600" : "bg-primary text-primary-foreground",
            )}>
              {currentPlan === "paid" ? (
                <>
                  <CheckCircle2 className="size-3.5" /> Current Active Plan
                </>
              ) : (
                "Most Popular"
              )}
            </span>
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold uppercase tracking-wider text-primary">
                  Pro Tier
                </span>
                <Crown className="size-5 text-amber-400" />
              </div>
              <h2 className="text-2xl font-bold text-foreground">Pro Unlimited</h2>
              <div className="flex items-baseline gap-1">
                <span className="text-4xl font-extrabold tracking-tight text-foreground">₹299</span>
                <span className="text-sm text-muted-foreground">/ Month</span>
              </div>
              <p className="text-xs text-muted-foreground leading-relaxed">
                Complete, unrestricted access to AI chat, Voice AI calling, and tools. Renews monthly.
              </p>

              <div className="border-t border-border/80 pt-4 space-y-3">
                <p className="text-xs font-semibold uppercase tracking-wider text-foreground">
                  Everything in Free, plus:
                </p>
                <ul className="space-y-2.5 text-xs text-muted-foreground">
                  <li className="flex items-center gap-2 font-medium text-foreground">
                    <Check className="size-4 text-primary shrink-0" />
                    <span>Unlimited AI Chat Messages &amp; Turns</span>
                  </li>
                  <li className="flex items-center gap-2 font-medium text-foreground">
                    <Check className="size-4 text-primary shrink-0" />
                    <span>Unlimited Voice AI Chat &amp; Speech Synthesis</span>
                  </li>
                  <li className="flex items-center gap-2 font-medium text-foreground">
                    <Check className="size-4 text-primary shrink-0" />
                    <span>Unlimited Web Search &amp; Connected Tool Execution</span>
                  </li>
                  <li className="flex items-center gap-2 font-medium text-foreground">
                    <Check className="size-4 text-primary shrink-0" />
                    <span>Priority Processing &amp; Zero Throttle</span>
                  </li>
                  <li className="flex items-center gap-2">
                    <Check className="size-4 text-primary shrink-0" />
                    <span>Instant Razorpay Payment Verification</span>
                  </li>
                </ul>
              </div>
            </div>

            <Button
              type="button"
              onClick={handleRazorpayCheckout}
              disabled={purchasingPaid || currentPlan === "paid" || loading}
              className={cn(
                "w-full justify-center gap-2 py-3 text-xs font-semibold cursor-pointer shadow-lg shadow-primary/30",
                currentPlan === "paid" && "bg-emerald-600 text-white opacity-100 shadow-emerald-600/30 cursor-default",
              )}
            >
              {purchasingPaid ? (
                <>
                  <Loader2 className="size-4 animate-spin" /> Opening Razorpay...
                </>
              ) : currentPlan === "paid" ? (
                <>
                  <Crown className="size-4 text-amber-300" /> Current Plan Active (Pro Unlimited)
                </>
              ) : (
                <>
                  <Crown className="size-4 text-amber-300" /> Buy Pro Unlimited (Razorpay)
                </>
              )}
            </Button>
          </div>
        </div>

        {/* Feature Comparison Table */}
        <div className="rounded-3xl border border-border bg-sidebar/80 p-6 sm:p-8 space-y-6">
          <div className="flex items-center gap-2 text-foreground font-semibold font-display text-lg">
            <ShieldCheck className="size-5 text-primary" /> Plan Feature Comparison
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="border-b border-border text-muted-foreground uppercase tracking-wider text-[11px]">
                  <th className="py-3 px-4">Feature</th>
                  <th className="py-3 px-4">Free Starter</th>
                  <th className="py-3 px-4 text-primary font-bold">Pro Unlimited</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/60">
                <tr>
                  <td className="py-3 px-4 font-medium">Credits Included</td>
                  <td className="py-3 px-4">50 Free Turns</td>
                  <td className="py-3 px-4 text-emerald-400 font-bold">Unlimited</td>
                </tr>
                <tr>
                  <td className="py-3 px-4 font-medium">Voice AI Chat &amp; Audio Mode</td>
                  <td className="py-3 px-4">Standard</td>
                  <td className="py-3 px-4 text-emerald-400 font-bold">Unlimited Voice Mode</td>
                </tr>
                <tr>
                  <td className="py-3 px-4 font-medium">Tool Calling &amp; Web Search</td>
                  <td className="py-3 px-4">Standard</td>
                  <td className="py-3 px-4 text-primary font-bold">Unlimited Priority</td>
                </tr>
                <tr>
                  <td className="py-3 px-4 font-medium">Cloud History Persistence</td>
                  <td className="py-3 px-4">Included</td>
                  <td className="py-3 px-4 text-primary font-bold">Included</td>
                </tr>
                <tr>
                  <td className="py-3 px-4 font-medium">Payment Method</td>
                  <td className="py-3 px-4">None Required</td>
                  <td className="py-3 px-4 text-foreground font-semibold">Razorpay Secure Checkout</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        {/* FAQ Accordion Section */}
        <div className="space-y-4 max-w-4xl mx-auto pt-4">
          <div className="text-center space-y-1 mb-6">
            <h3 className="text-xl font-bold font-display text-foreground flex items-center justify-center gap-2">
              <HelpCircle className="size-5 text-primary" /> Frequently Asked Questions
            </h3>
            <p className="text-xs text-muted-foreground">
              Click any question below to view answers about credits, plans, and payment security.
            </p>
          </div>

          <div className="space-y-3">
            {FAQS.map((faq, index) => {
              const isOpen = openFaq === index;
              return (
                <div
                  key={faq.q}
                  className="rounded-2xl border border-border bg-sidebar/90 overflow-hidden transition-all duration-300 shadow-xs hover:border-primary/40"
                >
                  <button
                    type="button"
                    onClick={() => setOpenFaq(isOpen ? null : index)}
                    className="flex w-full items-center justify-between p-4.5 text-left font-medium text-xs sm:text-sm text-foreground hover:bg-elevated/50 transition-colors cursor-pointer"
                    aria-expanded={isOpen}
                  >
                    <span className="font-semibold">{faq.q}</span>
                    <ChevronDown
                      className={cn(
                        "size-4 text-muted-foreground transition-transform duration-300 ease-in-out shrink-0 ml-3",
                        isOpen && "rotate-180 text-primary",
                      )}
                    />
                  </button>

                  <div
                    className={cn(
                      "grid transition-[grid-template-rows,opacity,padding] duration-300 ease-in-out border-t border-border/40 bg-surface/40",
                      isOpen
                        ? "grid-rows-[1fr] opacity-100 py-3.5 px-4.5"
                        : "grid-rows-[0fr] opacity-0 py-0 px-4.5 border-t-transparent",
                    )}
                  >
                    <div className="overflow-hidden text-xs text-muted-foreground leading-relaxed">
                      {faq.a}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </main>
    </div>
  );
}
