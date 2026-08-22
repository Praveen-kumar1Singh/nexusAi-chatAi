"use client";

import { useState } from "react";
import {
  AlertCircle,
  Eye,
  EyeOff,
  Loader2,
  Lock,
  LogIn,
  Mail,
  User,
  UserPlus,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { showToast } from "@/components/ui/toast";
import { refreshCurrentUser } from "@/lib/auth";

export async function registerUser(
  email: string,
  password_hash: string,
): Promise<{ success: boolean; error?: string }> {
  const normalizedEmail = email.trim().toLowerCase();

  try {
    const res = await fetch("/api/auth/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: normalizedEmail, password_hash }),
    });

    const data = await res.json().catch(() => null);

    if (res.ok) {
      await refreshCurrentUser();
      return { success: true };
    }

    return {
      success: false,
      error: data?.error || data?.detail || "Registration failed. Account may already exist.",
    };
  } catch {
    return { success: false, error: "Network error. Please try again." };
  }
}

export async function loginUser(
  email: string,
  password_hash: string,
): Promise<{ success: boolean; error?: string }> {
  const normalizedEmail = email.trim().toLowerCase();

  try {
    const res = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: normalizedEmail, password_hash }),
    });

    const data = await res.json().catch(() => null);

    if (res.ok) {
      await refreshCurrentUser();
      return { success: true };
    }

    return {
      success: false,
      error: data?.error || data?.detail || "Invalid email or password.",
    };
  } catch {
    return { success: false, error: "Network error. Please try again." };
  }
}

export function AuthModal({
  open,
  onClose,
  initialTab = "login",
}: {
  open: boolean;
  onClose: () => void;
  initialTab?: "login" | "register";
}) {
  const [tab, setTab] = useState<"login" | "register">(initialTab);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!open) return null;

  // Password rules validation
  const hasMinLength = password.length >= 8;
  const hasUpper = /[A-Z]/.test(password);
  const hasSpecial = /[!@#$%^&*(),.?":{}|<>]/.test(password);
  const hasNumber = /[0-9]/.test(password);
  const isPasswordStrong = hasMinLength && hasUpper && hasSpecial && hasNumber;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!email || !emailRegex.test(email.trim())) {
      setError("Please enter a valid email address (e.g. name@example.com).");
      return;
    }

    if (tab === "register") {
      if (!isPasswordStrong) {
        setError("Please satisfy all password safety requirements before registering.");
        return;
      }

      if (password !== confirmPassword) {
        setError("Passwords do not match. Please verify your confirm password.");
        return;
      }
    } else {
      if (!password || password.length < 4) {
        setError("Password must be at least 4 characters long.");
        return;
      }
    }

    setIsSubmitting(true);
    try {
      if (tab === "register") {
        const res = await registerUser(email, password);
        if (res.success) {
          showToast("Account created successfully! Welcome to Nexus AI.", "success");
          setEmail("");
          setPassword("");
          setConfirmPassword("");
          onClose();
        } else {
          const errMsg = res.error || "Registration failed. Account may already exist.";
          setError(errMsg);
        }
      } else {
        const res = await loginUser(email, password);
        if (res.success) {
          showToast("Logged in successfully! Welcome back.", "success");
          setEmail("");
          setPassword("");
          setConfirmPassword("");
          onClose();
        } else {
          const errMsg = res.error || "Login failed. Invalid email or password.";
          setError(errMsg);
        }
      }
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-3 sm:p-4 animate-in fade-in duration-200">
      <div className="relative w-full max-w-md max-h-[88vh] sm:max-h-[85vh] overflow-y-auto rounded-2xl border border-border bg-sidebar p-4 sm:p-6 shadow-2xl space-y-4 sm:space-y-5 scrollbar-none animate-in zoom-in-95 duration-200">
        <button
          onClick={onClose}
          disabled={isSubmitting}
          className="absolute right-3 top-3 sm:right-4 sm:top-4 rounded-lg p-1.5 text-muted-foreground hover:bg-elevated hover:text-foreground transition-colors disabled:opacity-50 z-10"
          aria-label="Close modal"
        >
          <X className="size-4" />
        </button>

        <div className="text-center space-y-1">
          <h2 className="text-xl font-semibold font-display">
            {tab === "login" ? "Welcome Back" : "Create Account"}
          </h2>
          <p className="text-xs text-muted-foreground">
            {tab === "login"
              ? "Enter your credentials to access your workspace"
              : "Register to create your secure account"}
          </p>
        </div>

        {/* Navigation Tabs */}
        <div className="grid grid-cols-2 rounded-xl bg-elevated/70 p-1 border border-border">
          <button
            type="button"
            disabled={isSubmitting}
            onClick={() => {
              setTab("login");
              setError(null);
            }}
            className={`flex items-center justify-center gap-2 rounded-lg py-2 text-xs font-medium transition-all ${
              tab === "login"
                ? "bg-surface text-foreground shadow-xs"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            <LogIn className="size-3.5" />
            Login
          </button>
          <button
            type="button"
            disabled={isSubmitting}
            onClick={() => {
              setTab("register");
              setError(null);
            }}
            className={`flex items-center justify-center gap-2 rounded-lg py-2 text-xs font-medium transition-all ${
              tab === "register"
                ? "bg-surface text-foreground shadow-xs"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            <UserPlus className="size-3.5" />
            Register
          </button>
        </div>

        {error && (
          <div className="flex items-center gap-2 rounded-xl border border-destructive/30 bg-destructive/10 px-3.5 py-2.5 text-xs text-destructive animate-in fade-in duration-200">
            <AlertCircle className="size-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Email Field */}
          <div className="space-y-1.5">
            <label className="text-[11.5px] font-medium text-muted-foreground">
              Email Address
            </label>
            <div className="relative">
              <Mail className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="user@example.com"
                disabled={isSubmitting}
                required
                className="w-full rounded-xl border border-border bg-surface pl-9 pr-3 py-2 text-sm text-foreground placeholder:text-muted-foreground/60 focus:border-primary focus:outline-hidden focus:ring-1 focus:ring-primary disabled:opacity-50"
              />
            </div>
          </div>

          {/* Password Field with Eye Toggle */}
          <div className="space-y-1.5">
            <label className="text-[11.5px] font-medium text-muted-foreground">
              Password
            </label>
            <div className="relative">
              <Lock className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
              <input
                type={showPassword ? "text" : "password"}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                disabled={isSubmitting}
                required
                className="w-full rounded-xl border border-border bg-surface pl-9 pr-10 py-2 text-sm text-foreground placeholder:text-muted-foreground/60 focus:border-primary focus:outline-hidden focus:ring-1 focus:ring-primary disabled:opacity-50"
              />
              <button
                type="button"
                onClick={() => setShowPassword((v) => !v)}
                className="absolute right-3 top-1/2 -translate-y-1/2 p-1 text-muted-foreground hover:text-foreground transition-colors"
                title={showPassword ? "Hide password" : "Show password"}
                aria-label={showPassword ? "Hide password" : "Show password"}
              >
                {showPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
              </button>
            </div>
          </div>

          {/* Registration Extra Fields: Confirm Password & Password Checklist */}
          {tab === "register" && (
            <>
              {/* Confirm Password Field */}
              <div className="space-y-1.5 animate-in fade-in duration-200">
                <label className="text-[11.5px] font-medium text-muted-foreground">
                  Confirm Password
                </label>
                <div className="relative">
                  <Lock className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
                  <input
                    type={showConfirmPassword ? "text" : "password"}
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    placeholder="••••••••"
                    disabled={isSubmitting}
                    required
                    className="w-full rounded-xl border border-border bg-surface pl-9 pr-10 py-2 text-sm text-foreground placeholder:text-muted-foreground/60 focus:border-primary focus:outline-hidden focus:ring-1 focus:ring-primary disabled:opacity-50"
                  />
                  <button
                    type="button"
                    onClick={() => setShowConfirmPassword((v) => !v)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 p-1 text-muted-foreground hover:text-foreground transition-colors"
                    title={showConfirmPassword ? "Hide confirm password" : "Show confirm password"}
                    aria-label={showConfirmPassword ? "Hide confirm password" : "Show confirm password"}
                  >
                    {showConfirmPassword ? (
                      <EyeOff className="size-4" />
                    ) : (
                      <Eye className="size-4" />
                    )}
                  </button>
                </div>
              </div>

              {/* Password Safety Live Checklist */}
              <div className="rounded-xl border border-border bg-elevated/40 p-3 space-y-1.5 text-[11.5px] animate-in fade-in duration-200">
                <p className="font-medium text-muted-foreground text-[11px] uppercase tracking-wider mb-1">
                  Password Requirements:
                </p>
                <div className="grid grid-cols-2 gap-1.5">
                  <div
                    className={`flex items-center gap-1.5 transition-colors ${
                      hasMinLength ? "text-emerald-500 font-medium" : "text-muted-foreground"
                    }`}
                  >
                    <span>{hasMinLength ? "✓" : "✗"}</span> At least 8 characters
                  </div>
                  <div
                    className={`flex items-center gap-1.5 transition-colors ${
                      hasUpper ? "text-emerald-500 font-medium" : "text-muted-foreground"
                    }`}
                  >
                    <span>{hasUpper ? "✓" : "✗"}</span> 1 Uppercase (A-Z)
                  </div>
                  <div
                    className={`flex items-center gap-1.5 transition-colors ${
                      hasSpecial ? "text-emerald-500 font-medium" : "text-muted-foreground"
                    }`}
                  >
                    <span>{hasSpecial ? "✓" : "✗"}</span> 1 Special (!@#$...)
                  </div>
                  <div
                    className={`flex items-center gap-1.5 transition-colors ${
                      hasNumber ? "text-emerald-500 font-medium" : "text-muted-foreground"
                    }`}
                  >
                    <span>{hasNumber ? "✓" : "✗"}</span> 1 Number (0-9)
                  </div>
                </div>
              </div>
            </>
          )}

          {/* Submit Button with Loading Spinner */}
          <Button
            type="submit"
            disabled={isSubmitting}
            className="w-full justify-center gap-2 py-2.5 text-sm font-medium cursor-pointer"
          >
            {isSubmitting ? (
              <>
                <Loader2 className="size-4 animate-spin" />
                {tab === "login" ? "Logging in..." : "Creating Account..."}
              </>
            ) : tab === "login" ? (
              <>
                <LogIn className="size-4" /> Log In
              </>
            ) : (
              <>
                <UserPlus className="size-4" /> Register &amp; Log In
              </>
            )}
          </Button>
        </form>

        <div className="pt-2 text-center text-[11px] text-muted-foreground">
          {tab === "login" ? (
            <p>
              Don&apos;t have an account?{" "}
              <button
                type="button"
                disabled={isSubmitting}
                onClick={() => {
                  setTab("register");
                  setError(null);
                }}
                className="text-primary hover:underline font-medium cursor-pointer"
              >
                Register here
              </button>
            </p>
          ) : (
            <p>
              Already registered?{" "}
              <button
                type="button"
                disabled={isSubmitting}
                onClick={() => {
                  setTab("login");
                  setError(null);
                }}
                className="text-primary hover:underline font-medium cursor-pointer"
              >
                Log in here
              </button>
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
