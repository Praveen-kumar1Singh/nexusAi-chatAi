"use client";

import { useEffect, useState } from "react";
import { AlertCircle, CheckCircle2, Info, X } from "lucide-react";

export interface ToastItem {
  id: string;
  type: "success" | "error" | "info";
  message: string;
}

const TOAST_EVENT = "mantraa_show_toast";

export function showToast(message: string, type: "success" | "error" | "info" = "info") {
  if (typeof window === "undefined") return;
  const event = new CustomEvent<ToastItem>(TOAST_EVENT, {
    detail: { id: Math.random().toString(36).substring(2, 9), type, message },
  });
  window.dispatchEvent(event);
}

export function ToastContainer() {
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  useEffect(() => {
    function handleToast(e: Event) {
      const customEvent = e as CustomEvent<ToastItem>;
      if (!customEvent.detail) return;
      const item = customEvent.detail;
      setToasts((prev) => [...prev, item]);

      // Auto dismiss after 4 seconds
      setTimeout(() => {
        setToasts((prev) => prev.filter((t) => t.id !== item.id));
      }, 4000);
    }

    window.addEventListener(TOAST_EVENT, handleToast);
    return () => window.removeEventListener(TOAST_EVENT, handleToast);
  }, []);

  if (toasts.length === 0) return null;

  return (
    <div className="fixed bottom-5 right-5 z-50 flex flex-col gap-2.5 max-w-sm w-full pointer-events-none px-4 sm:px-0">
      {toasts.map((toast) => (
        <div
          key={toast.id}
          className="pointer-events-auto flex items-center justify-between gap-3 rounded-xl border border-border bg-popover px-3.5 py-2.5 text-popover-foreground shadow-xl backdrop-blur-md transition-all animate-in fade-in slide-in-from-bottom-4 duration-300"
        >
          <div className="flex items-center gap-2.5 min-w-0">
            {toast.type === "success" && <CheckCircle2 className="size-4 text-emerald-500 shrink-0" />}
            {toast.type === "error" && <AlertCircle className="size-4 text-destructive shrink-0" />}
            {toast.type === "info" && <Info className="size-4 text-primary shrink-0" />}
            <p className="text-xs font-medium text-foreground truncate">{toast.message}</p>
          </div>
          <button
            onClick={() => setToasts((prev) => prev.filter((t) => t.id !== toast.id))}
            className="rounded-lg p-1 text-muted-foreground hover:bg-elevated hover:text-foreground transition-colors shrink-0 cursor-pointer"
            aria-label="Close notification"
          >
            <X className="size-3.5" />
          </button>
        </div>
      ))}
    </div>
  );
}
