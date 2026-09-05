"use client";

import { useToastState } from "@/components/toast";

/**
 * The command centre's toast: a dark pill above the dock, bottom-right.
 *
 * It is always mounted and animates between two class sets rather than
 * appearing and disappearing, which is what the original did - that is why the
 * hidden state still carries `pointer-events-none` instead of `display: none`.
 */
export function CommandToast() {
  const { message, visible } = useToastState();

  return (
    <div
      className={`fixed bottom-28 right-6 z-50 transform transition-all duration-200 flex items-center gap-2.5 px-4 py-2.5 bg-slate-900 text-white rounded-xl shadow-2xl text-sm ${
        visible ? "opacity-100 translate-y-0" : "translate-y-16 opacity-0 pointer-events-none"
      }`}
      id="toast-notification"
    >
      <span className="material-symbols-outlined text-[18px] text-emerald-400">check_circle</span>
      <span>{message || "Action completed"}</span>
    </div>
  );
}
