"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";

/**
 * The `showToast(...)` the screens call, minus the DOM poking.
 *
 * The original screens each kept one toast element and a module-level timeout:
 * calling showToast replaced the text, revealed the element and restarted the
 * timer, so a second call while one was still on screen replaced it rather than
 * stacking. That behaviour is preserved here.
 *
 * What is NOT shared is the toast's appearance - the command centre puts a dark
 * pill bottom-right, billing slides one down from the top, deal health fades one
 * in under the title bar, and three screens have no toast at all. So this
 * provider only owns the message and the visibility; each screen renders its own
 * markup from `useToastState()`.
 */

interface ToastState {
  message: string;
  visible: boolean;
}

interface ToastContextValue extends ToastState {
  showToast: (message: string) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

export function ToastProvider({
  children,
  durationMs = 2600,
}: {
  children: React.ReactNode;
  /** How long a toast stays up. The screens used 2.6s, except billing at 3s. */
  durationMs?: number;
}) {
  const [state, setState] = useState<ToastState>({ message: "", visible: false });
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showToast = useCallback(
    (message: string) => {
      setState({ message, visible: true });
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => {
        setState((current) => ({ ...current, visible: false }));
      }, durationMs);
    },
    [durationMs],
  );

  // Without this a toast fired just before navigating leaves a timer running
  // against an unmounted tree.
  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  return (
    <ToastContext.Provider value={{ ...state, showToast }}>{children}</ToastContext.Provider>
  );
}

/** For anything that fires a toast. */
export function useToast(): (message: string) => void {
  return useToastContext().showToast;
}

/** For the one element per screen that draws the toast. */
export function useToastState(): ToastState {
  const { message, visible } = useToastContext();
  return { message, visible };
}

function useToastContext(): ToastContextValue {
  const context = useContext(ToastContext);
  if (!context) {
    throw new Error("useToast must be used inside a <ToastProvider>");
  }
  return context;
}
