"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  AlertCircle,
  ArrowLeft,
  Camera,
  Check,
  CheckCircle2,
  Eye,
  EyeOff,
  Laptop,
  Lock,
  Mail,
  Moon,
  ShieldCheck,
  Sparkles,
  Sun,
  Upload,
  User,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { showToast } from "@/components/ui/toast";
import { refreshCurrentUser, useSession } from "@/lib/auth";
import { useTheme } from "@/lib/theme";
import { cn } from "@/lib/utils";

const AVATAR_GRADIENTS = [
  { id: "primary", bg: "from-primary to-indigo-500", name: "Classic Indigo" },
  { id: "emerald", bg: "from-emerald-500 to-teal-600", name: "Emerald" },
  { id: "rose", bg: "from-rose-500 to-pink-600", name: "Rose" },
  { id: "amber", bg: "from-amber-500 to-orange-600", name: "Amber" },
  { id: "purple", bg: "from-purple-600 to-violet-600", name: "Violet" },
];

export default function ProfilePage() {
  const router = useRouter();
  const { user, loading } = useSession();
  const { theme: currentTheme, setTheme } = useTheme();

  const [name, setName] = useState("");
  const [avatar, setAvatar] = useState("from-primary to-indigo-500");
  const [avatarImage, setAvatarImage] = useState<string | null>(null);

  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");

  const [showCurrentPassword, setShowCurrentPassword] = useState(false);
  const [showNewPassword, setShowNewPassword] = useState(false);

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    router.prefetch("/");
  }, [router]);

  // Seed the form once the session's profile arrives from the server. Done
  // during render rather than in an effect so the first paint already shows the
  // saved values instead of empty fields.
  const [seededFor, setSeededFor] = useState<string | null>(null);
  if (user && seededFor !== user.email) {
    setSeededFor(user.email);
    setName(user.name || "");
    setAvatar(user.avatar || "from-primary to-indigo-500");
    setAvatarImage(user.avatarImage || null);
  }

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background text-foreground">
        <div className="size-8 rounded-full bg-elevated animate-pulse" />
      </div>
    );
  }

  if (!user) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center bg-background text-foreground p-6 text-center space-y-4">
        <div className="grid size-16 place-items-center rounded-2xl bg-primary/15 text-primary">
          <User className="size-8" />
        </div>
        <h1 className="text-2xl font-bold font-display">Authentication Required</h1>
        <p className="text-sm text-muted-foreground max-w-sm">
          Please log in from the workspace to access your profile settings.
        </p>
        <Button asChild className="gap-2 cursor-pointer">
          <Link href="/">
            <ArrowLeft className="size-4" /> Return to Workspace
          </Link>
        </Button>
      </div>
    );
  }

  const initialName = user.name || "";
  const initialAvatar = user.avatar || "from-primary to-indigo-500";
  const initialAvatarImage = user.avatarImage || null;

  const isNameChanged = name.trim() !== initialName;
  const isAvatarChanged = avatar !== initialAvatar;
  const isImageChanged = avatarImage !== initialAvatarImage;
  const isPasswordEntered = newPassword.trim().length > 0 || currentPassword.trim().length > 0;

  const isChanged = isNameChanged || isAvatarChanged || isImageChanged || isPasswordEntered;

  const displayInitial = name.trim()
    ? name.trim()[0].toUpperCase()
    : user.email[0].toUpperCase();

  const pwdStrength = {
    minLength: newPassword.length >= 8,
    hasUpper: /[A-Z]/.test(newPassword),
    hasSpecial: /[!@#$%^&*(),.?":{}|<>]/.test(newPassword),
    hasNumber: /[0-9]/.test(newPassword),
  };
  const isPwdValid =
    pwdStrength.minLength &&
    pwdStrength.hasUpper &&
    pwdStrength.hasSpecial &&
    pwdStrength.hasNumber;

  function handleImageUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    if (file.size > 5 * 1024 * 1024) {
      setError("Image size must be smaller than 5 MB.");
      return;
    }

    const reader = new FileReader();
    reader.onload = (event) => {
      const result = event.target?.result as string;
      if (result) {
        setAvatarImage(result);
        setError(null);
      }
    };
    reader.readAsDataURL(file);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!user) return;
    setError(null);
    setSuccessMsg(null);

    // Password validation rules
    if (newPassword.trim().length > 0) {
      if (!currentPassword.trim()) {
        setError("Please enter your current password to update your password.");
        return;
      }

      if (currentPassword.trim() === newPassword.trim()) {
        setError("New password cannot be the same as your current password. Please choose a different password.");
        return;
      }

      if (!isPwdValid) {
        setError("Please ensure your new password meets all security criteria (8+ characters, capital letter, number, and special character).");
        return;
      }
    }

    setIsSubmitting(true);

    try {
      const res = await fetch("/api/auth/update-profile", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          avatar,
          avatarImage: avatarImage || "",
          current_password: currentPassword,
          new_password: newPassword,
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.error || "Failed to update profile.");
        setIsSubmitting(false);
        return;
      }

      await refreshCurrentUser();
      showToast("Profile updated successfully!", "success");

      // Instantly navigate back to workspace
      router.replace("/");
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="relative min-h-screen w-full bg-background text-foreground selection:bg-primary/20">
      <div className="pointer-events-none absolute -top-40 right-10 -z-10 size-[600px] rounded-full bg-gradient-to-tr from-primary/20 via-indigo-500/10 to-purple-500/10 blur-3xl opacity-60 animate-pulse duration-1000" />
      <div className="pointer-events-none absolute bottom-10 left-10 -z-10 size-[500px] rounded-full bg-primary/10 blur-3xl" />

      <header className="sticky top-0 z-30 flex h-16 w-full items-center justify-between border-b border-border bg-sidebar/80 px-3 sm:px-10 backdrop-blur-md">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="sm" asChild className="gap-2 text-muted-foreground hover:text-foreground cursor-pointer px-2 sm:px-3">
            <Link href="/">
              <ArrowLeft className="size-4" /> <span className="hidden sm:inline">Back to Workspace</span><span className="sm:hidden text-xs">Back</span>
            </Link>
          </Button>
        </div>
        <div className="flex items-center gap-1.5 sm:gap-2 text-[11px] sm:text-xs font-medium text-muted-foreground">
          <ShieldCheck className="size-3.5 sm:size-4 text-emerald-400" />
          <span>Account Protected</span>
        </div>
      </header>

      <main className="mx-auto w-full max-w-6xl px-3 sm:px-10 py-4 sm:py-10 space-y-4 sm:space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 sm:gap-4 border-b border-border/60 pb-4 sm:pb-6">
          <div>
            <h1 className="text-2xl sm:text-4xl font-bold font-display text-foreground tracking-tight">
              Account &amp; Profile Settings
            </h1>
            <p className="mt-1 text-xs sm:text-sm text-muted-foreground">
              Update your photo, personal details, and security credentials
            </p>
          </div>
        </div>

        {error && (
          <div className="flex items-center gap-2.5 rounded-2xl border border-destructive/30 bg-destructive/10 p-3 sm:p-4 text-xs text-destructive shadow-xs animate-in fade-in duration-200">
            <AlertCircle className="size-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {successMsg && (
          <div className="flex items-center gap-2.5 rounded-2xl border border-emerald-500/30 bg-emerald-500/10 p-3 sm:p-4 text-xs text-emerald-400 shadow-xs animate-in fade-in duration-200">
            <CheckCircle2 className="size-4 shrink-0" />
            <span>{successMsg}</span>
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 sm:gap-8 items-start">
          <div className="space-y-4 sm:space-y-6 lg:col-span-1">
            <div className="rounded-3xl border border-border bg-surface/80 p-4 sm:p-6 shadow-xl backdrop-blur-md space-y-4 sm:space-y-6 text-center">
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground/80">
                Profile Image
              </p>

              <div className="relative mx-auto size-28 sm:size-36">
                <div className="relative size-full overflow-hidden rounded-full ring-4 ring-primary/30 shadow-2xl transition-all duration-300 hover:ring-primary/60">
                  {avatarImage ? (
                    <img
                      src={avatarImage}
                      alt="Profile Avatar"
                      className="size-full object-cover"
                    />
                  ) : (
                    <div className={`grid size-full place-items-center bg-gradient-to-tr ${avatar} text-white font-bold text-3xl sm:text-4xl shadow-inner`}>
                      {displayInitial}
                    </div>
                  )}
                </div>

                <input
                  type="file"
                  ref={fileInputRef}
                  onChange={handleImageUpload}
                  accept="image/*"
                  className="hidden"
                />

                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="absolute bottom-1 right-1 grid size-8 sm:size-9 place-items-center rounded-full bg-primary text-white shadow-lg ring-4 ring-background hover:bg-primary/90 transition-all cursor-pointer hover:scale-105"
                  title="Upload profile photo"
                >
                  <Camera className="size-3.5 sm:size-4" />
                </button>
              </div>

              <div className="space-y-2">
                <div className="flex justify-center gap-2">
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => fileInputRef.current?.click()}
                    className="gap-1.5 text-xs border-primary/30 bg-primary/10 text-primary hover:bg-primary/20 hover:border-primary/50 cursor-pointer transition-all shadow-2xs"
                  >
                    <Upload className="size-3.5 text-primary" /> Update Photo
                  </Button>
                </div>
              </div>

              <Separator className="bg-border/60" />

              <div className="space-y-2 text-left bg-elevated/40 rounded-2xl p-3 sm:p-3.5 border border-border/50 text-xs">
                <div className="flex justify-between items-center text-muted-foreground">
                  <span>Account Status:</span>
                  <span className="font-semibold text-emerald-400">Active</span>
                </div>
                <div className="flex justify-between items-center text-muted-foreground">
                  <span>Session Status:</span>
                  <span className="font-semibold text-emerald-400">Authenticated</span>
                </div>
              </div>
            </div>
          </div>

          <div className="space-y-4 sm:space-y-6 lg:col-span-2">
            <div className="rounded-3xl border border-border bg-surface/80 p-4 sm:p-6 shadow-xl backdrop-blur-md space-y-4 sm:space-y-6">
              <div className="flex items-center gap-2.5">
                <div className="grid size-8 sm:size-9 place-items-center rounded-xl bg-primary/15 text-primary">
                  <User className="size-4 sm:size-4.5" />
                </div>
                <div>
                  <h2 className="text-sm sm:text-base font-semibold font-display text-foreground">
                    Personal Information
                  </h2>
                  <p className="text-[11px] sm:text-xs text-muted-foreground">
                    Update your display name and view account details
                  </p>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2.5 sm:gap-4">
                <div className="space-y-1 sm:space-y-1.5 col-span-1">
                  <label className="text-[11px] sm:text-xs font-medium text-muted-foreground">Full Name</label>
                  <div className="relative">
                    <User className="absolute left-2.5 sm:left-3.5 top-1/2 -translate-y-1/2 size-3.5 sm:size-4 text-muted-foreground" />
                    <input
                      type="text"
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      placeholder="Praveen Kumar"
                      className="w-full rounded-xl border border-border bg-background pl-8 sm:pl-10 pr-2 sm:pr-3.5 py-2 sm:py-2.5 text-xs sm:text-sm text-foreground placeholder:text-muted-foreground/60 focus:border-primary focus:outline-hidden focus:ring-1 focus:ring-primary transition-colors"
                    />
                  </div>
                </div>

                <div className="space-y-1 sm:space-y-1.5 col-span-1">
                  <label className="text-[11px] sm:text-xs font-medium text-muted-foreground">Email Address</label>
                  <div className="relative">
                    <Mail className="absolute left-2.5 sm:left-3.5 top-1/2 -translate-y-1/2 size-3.5 sm:size-4 text-muted-foreground/60" />
                    <input
                      type="email"
                      value={user.email}
                      disabled
                      className="w-full rounded-xl border border-border/60 bg-elevated/40 pl-8 sm:pl-10 pr-2 sm:pr-3.5 py-2 sm:py-2.5 text-xs sm:text-sm text-muted-foreground cursor-not-allowed truncate"
                    />
                  </div>
                  <p className="text-[10px] sm:text-[11px] text-muted-foreground/80 hidden sm:block"> Email is associated with your account.</p>
                </div>
              </div>
            </div>

            <div className="rounded-3xl border border-border bg-surface/80 p-4 sm:p-6 shadow-xl backdrop-blur-md space-y-4 sm:space-y-6">
              <div className="flex items-center gap-2.5">
                <div className="grid size-8 sm:size-9 place-items-center rounded-xl bg-primary/15 text-primary">
                  <Lock className="size-4 sm:size-4.5" />
                </div>
                <div>
                  <h2 className="text-sm sm:text-base font-semibold font-display text-foreground">
                    Security &amp; Password Update
                  </h2>
                  <p className="text-[11px] sm:text-xs text-muted-foreground">
                    Update your password securely.
                  </p>
                </div>
              </div>

              <Separator className="bg-border/60" />

              <div className="grid grid-cols-2 gap-2.5 sm:gap-4">
                <div className="space-y-1 sm:space-y-1.5 col-span-1">
                  <label className="text-[11px] sm:text-xs font-medium text-muted-foreground">Current Password</label>
                  <div className="relative">
                    <Lock className="absolute left-2.5 sm:left-3.5 top-1/2 -translate-y-1/2 size-3.5 sm:size-4 text-muted-foreground" />
                    <input
                      type={showCurrentPassword ? "text" : "password"}
                      value={currentPassword}
                      onChange={(e) => setCurrentPassword(e.target.value)}
                      placeholder="Current pwd"
                      className="w-full rounded-xl border border-border bg-background pl-8 sm:pl-10 pr-7 sm:pr-11 py-2 sm:py-2.5 text-xs sm:text-sm text-foreground placeholder:text-muted-foreground/60 focus:border-primary focus:outline-hidden focus:ring-1 focus:ring-primary transition-colors"
                    />
                    <button
                      type="button"
                      onClick={() => setShowCurrentPassword(!showCurrentPassword)}
                      className="absolute right-2 sm:right-3.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
                      aria-label={showCurrentPassword ? "Hide password" : "Show password"}
                    >
                      {showCurrentPassword ? <EyeOff className="size-3.5 sm:size-4" /> : <Eye className="size-3.5 sm:size-4" />}
                    </button>
                  </div>
                </div>

                <div className="space-y-1 sm:space-y-1.5 col-span-1">
                  <label className="text-[11px] sm:text-xs font-medium text-muted-foreground">New Password</label>
                  <div className="relative">
                    <Lock className="absolute left-2.5 sm:left-3.5 top-1/2 -translate-y-1/2 size-3.5 sm:size-4 text-muted-foreground" />
                    <input
                      type={showNewPassword ? "text" : "password"}
                      value={newPassword}
                      onChange={(e) => setNewPassword(e.target.value)}
                      placeholder="New pwd (min 8)"
                      className="w-full rounded-xl border border-border bg-background pl-8 sm:pl-10 pr-7 sm:pr-11 py-2 sm:py-2.5 text-xs sm:text-sm text-foreground placeholder:text-muted-foreground/60 focus:border-primary focus:outline-hidden focus:ring-1 focus:ring-primary transition-colors"
                    />
                    <button
                      type="button"
                      onClick={() => setShowNewPassword(!showNewPassword)}
                      className="absolute right-2 sm:right-3.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
                      aria-label={showNewPassword ? "Hide password" : "Show password"}
                    >
                      {showNewPassword ? <EyeOff className="size-3.5 sm:size-4" /> : <Eye className="size-3.5 sm:size-4" />}
                    </button>
                  </div>
                </div>
              </div>

              {newPassword.length > 0 && (
                <div className="rounded-2xl border border-border/60 bg-elevated/40 p-3 sm:p-3.5 space-y-2 text-xs animate-in fade-in duration-200 mt-2">
                  <p className="font-semibold text-foreground text-[11px] sm:text-[11.5px]">Password Safety Criteria:</p>
                  <div className="grid grid-cols-2 gap-1.5 sm:gap-2 text-[10.5px] sm:text-[11.5px]">
                    <div className={`flex items-center gap-1.5 transition-colors ${pwdStrength.minLength ? "text-emerald-400 font-medium" : "text-muted-foreground"}`}>
                      {pwdStrength.minLength ? <Check className="size-3 sm:size-3.5 text-emerald-400 shrink-0" /> : <X className="size-3 sm:size-3.5 text-muted-foreground/50 shrink-0" />}
                      <span>8+ characters</span>
                    </div>
                    <div className={`flex items-center gap-1.5 transition-colors ${pwdStrength.hasUpper ? "text-emerald-400 font-medium" : "text-muted-foreground"}`}>
                      {pwdStrength.hasUpper ? <Check className="size-3 sm:size-3.5 text-emerald-400 shrink-0" /> : <X className="size-3 sm:size-3.5 text-muted-foreground/50 shrink-0" />}
                      <span>1 Capital (A-Z)</span>
                    </div>
                    <div className={`flex items-center gap-1.5 transition-colors ${pwdStrength.hasSpecial ? "text-emerald-400 font-medium" : "text-muted-foreground"}`}>
                      {pwdStrength.hasSpecial ? <Check className="size-3 sm:size-3.5 text-emerald-400 shrink-0" /> : <X className="size-3 sm:size-3.5 text-muted-foreground/50 shrink-0" />}
                      <span>1 Special (!@#$)</span>
                    </div>
                    <div className={`flex items-center gap-1.5 transition-colors ${pwdStrength.hasNumber ? "text-emerald-400 font-medium" : "text-muted-foreground"}`}>
                      {pwdStrength.hasNumber ? <Check className="size-3 sm:size-3.5 text-emerald-400 shrink-0" /> : <X className="size-3 sm:size-3.5 text-muted-foreground/50 shrink-0" />}
                      <span>1 Number (0-9)</span>
                    </div>
                  </div>
                </div>
              )}
            </div>

            <div className="flex items-center justify-end gap-3 pt-2">
              <Button
                type="button"
                variant="outline"
                asChild
                className="py-2 sm:py-2.5 px-4 sm:px-6 text-xs font-medium cursor-pointer"
              >
                <Link href="/">Cancel</Link>
              </Button>
              <Button
                type="button"
                onClick={handleSubmit}
                disabled={!isChanged || isSubmitting}
                className={`py-2 sm:py-2.5 px-5 sm:px-7 text-xs font-medium transition-all ${
                  !isChanged || isSubmitting
                    ? "opacity-50 cursor-not-allowed"
                    : "cursor-pointer shadow-md shadow-primary/20 hover:scale-105"
                }`}
              >
                {isSubmitting ? "Saving..." : "Save Profile"}
              </Button>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
