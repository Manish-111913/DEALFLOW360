"use client";

import { useEffect, useRef } from "react";
import { useToast } from "@/components/toast";

/**
 * The command palette, opened with Cmd/Ctrl+K and closed with Escape.
 *
 * The open/close state lives in the page rather than here, because Escape also
 * closes the assistant chat - the original bound one keydown handler that hit
 * both. Keeping the state up there means one handler still does.
 */
export function SearchModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const showToast = useToast();
  const inputRef = useRef<HTMLInputElement>(null);

  // The original waited 50ms before focusing, because the element was still
  // `display: none` at the moment the class was removed. React has already
  // committed the DOM by the time this effect runs, so it can focus directly.
  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  if (!open) return null;

  function pick(label: string) {
    showToast(label);
    onClose();
  }

  return (
    <div
      className="fixed inset-0 z-50 bg-slate-900/30 backdrop-blur-xs flex items-start justify-center pt-20 px-4"
      id="search-modal"
    >
      <div className="bg-white rounded-xl shadow-2xl border border-slate-200 w-full max-w-xl overflow-hidden animate-in fade-in zoom-in-95 duration-150">
        <div className="p-3.5 border-b border-slate-100 flex items-center gap-3">
          <span className="material-symbols-outlined text-slate-400 text-[20px]">search</span>
          <input
            ref={inputRef}
            className="w-full text-sm border-0 focus:ring-0 focus:outline-none placeholder:text-slate-400 text-slate-900"
            placeholder="Search deals, accounts, quotations, contacts..."
            type="text"
          />
          <kbd
            className="px-1.5 py-0.5 text-[10px] font-jetbrains font-medium text-slate-400 bg-slate-100 rounded border border-slate-200 cursor-pointer"
            onClick={onClose}
          >
            ESC
          </kbd>
        </div>
        <div className="p-3 divide-y divide-slate-100 text-xs text-slate-500">
          <div className="py-2">
            <span className="font-semibold text-[11px] uppercase tracking-wider text-slate-400 px-2 block mb-1">
              Recent Searches
            </span>
            <button
              className="w-full text-left px-2 py-1.5 hover:bg-slate-50 rounded flex items-center justify-between text-slate-700"
              onClick={() => pick("Loading Acme Industries")}
              type="button"
            >
              <span>Acme Industries (DF-2024-1082)</span>
              <span className="text-slate-400 font-jetbrains">Quote Draft</span>
            </button>
            <button
              className="w-full text-left px-2 py-1.5 hover:bg-slate-50 rounded flex items-center justify-between text-slate-700"
              onClick={() => pick("Loading Beta Industries")}
              type="button"
            >
              <span>Beta Industries (DF-2024-1078)</span>
              <span className="text-amber-600 font-medium">Pending Approval</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
