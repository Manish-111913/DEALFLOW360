"use client";

import Image from "next/image";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  AgentButton,
  AppShell,
  AppWindow,
  StatusBar,
} from "@/components/app-shell";
import { ROUTES } from "@/lib/navigation";
import {
  CHROME_BAR,
  PAGE_SUBTITLE,
  PAGE_TITLE,
} from "@/components/design-tokens";
import { PipelineView } from "./_components/pipeline-view";
import { QuotationBuilder } from "./_components/quotation-builder";
import { QuotationsView } from "./_components/quotations-view";
import { AppDock } from "@/components/app-dock";

/**
 * Screen 2 - the Sales Workspace.
 *
 * A macOS-style window with two views. Pipeline is the one that opens, and it
 * can be reached from either the tab row or the Board/List switcher on the
 * right - both drive the same piece of state, which is why it lives here.
 *
 * The window's red traffic-light dot and the Actions menu both raise the same
 * "Close Sales Workspace?" confirmation. Confirming it returns to the command
 * centre; in the source screen it only dismissed the dialog, because there was
 * nowhere to go back to.
 */

type View = "quotations" | "pipeline";

const AVATAR_URL =
  "https://lh3.googleusercontent.com/aida-public/AB6AXuDVgGyX5-LPHjlIyh9E7FWIGmAvtI1JkyiWbZP7ou-X4AIdfhL7CPZmVppFh1BPBiLxKaS1CDKZ3kF09ZrabbjzQETMvd2XIdlaowfVFrdPWujTe6ERZbltJTZdJJdvoJxkr8yDkKnGVkC3LeOzqwBUXJS6eacgBNYLFUjwTGaDihsSfZ2XrKqib5QyLGFR-RNmFmM0iBhFP0Sj3fGktkdcjl93DJWbnxFo18D8C35AeEwGoB_RTwkN";

export default function SalesWorkspacePage() {
  const router = useRouter();
  const [view, setView] = useState<View>("pipeline");
  const [actionsOpen, setActionsOpen] = useState(false);
  const [builderOpen, setBuilderOpen] = useState(false);
  const [closeOpen, setCloseOpen] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const syncTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // A click anywhere else closes the Actions menu, as in the source screen.
  useEffect(() => {
    if (!actionsOpen) return;
    function close() {
      setActionsOpen(false);
    }
    document.addEventListener("click", close);
    return () => document.removeEventListener("click", close);
  }, [actionsOpen]);

  useEffect(() => () => {
    if (syncTimer.current) clearTimeout(syncTimer.current);
  }, []);

  function reload(event: React.MouseEvent) {
    event.stopPropagation();
    setSyncing(true);
    syncTimer.current = setTimeout(() => {
      setSyncing(false);
      setActionsOpen(false);
    }, 700);
  }

  function askToClose(event: React.MouseEvent) {
    event.stopPropagation();
    setActionsOpen(false);
    setCloseOpen(true);
  }

  return (
    <AppShell className="screen-workspace font-jakarta text-slate-900 select-none bg-slate-100">
      <AppWindow>
          {/* 1. Window Frame & Header Bar */}
          <div className={CHROME_BAR}>
            <div className="flex items-center space-x-3">
              <div className="flex items-center space-x-2">
                <span
                  className="w-3 h-3 rounded-full bg-[#ff5f56] border border-[#e0443e] inline-block cursor-pointer hover:opacity-80 transition-opacity"
                  onClick={askToClose}
                  title="Close"
                />
                <span
                  className="w-3 h-3 rounded-full bg-[#ffbd2e] border border-[#dea123] inline-block cursor-pointer hover:opacity-80 transition-opacity"
                  title="Minimize"
                />
                <span
                  className="w-3 h-3 rounded-full bg-[#27c93f] border border-[#1aab29] inline-block cursor-pointer hover:opacity-80 transition-opacity"
                  title="Maximize"
                />
              </div>
              <span className="text-slate-300 font-light">|</span>
              <div className="flex items-center space-x-1.5 text-xs">
                <span className="font-medium text-slate-600">Sales Workspace</span>
              </div>
            </div>

            {/* Center Search Bar */}
            <div className="flex-1 max-w-lg mx-6">
              <div className="relative flex items-center">
                <svg
                  className="w-3.5 h-3.5 absolute left-3 text-slate-400 pointer-events-none"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth="2"
                  />
                </svg>
                <input
                  className="w-full bg-white border border-slate-200/90 rounded-lg pl-8 pr-10 py-1.5 text-xs text-slate-700 placeholder:text-slate-400 focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 shadow-sm transition-all"
                  placeholder="Search quotation, client, SKU, or approval ID (⌘K)"
                  type="text"
                />
                <kbd className="absolute right-2.5 px-1.5 py-0.5 text-[10px] font-medium text-slate-400 bg-slate-100 border border-slate-200 rounded">
                  ⌘K
                </kbd>
              </div>
            </div>

            {/* Right Header Profile & Alerts */}
            <div className="flex items-center space-x-3">
              <button
                className="relative p-1 rounded-full text-slate-500 hover:text-slate-700 hover:bg-slate-200/50 transition-colors"
                title="Notifications"
                type="button"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path
                    d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth="2"
                  />
                </svg>
                <span className="absolute top-0.5 right-0.5 w-2 h-2 bg-indigo-600 rounded-full ring-2 ring-white" />
              </button>
              <span className="text-slate-200 font-light">|</span>
              <div className="flex items-center space-x-2">
                <Image
                  alt="Priya Sharma"
                  className="w-7 h-7 rounded-full object-cover ring-1 ring-slate-200"
                  height={28}
                  src={AVATAR_URL}
                  unoptimized
                  width={28}
                />
                <div className="text-left hidden sm:block">
                  <p className="text-[11px] font-semibold text-slate-800 leading-tight">Priya Sharma</p>
                  <p className="text-[9px] text-slate-400 leading-none">Sales Director</p>
                </div>
              </div>
            </div>
          </div>

          {/* 2. Page Title, Primary Actions & Tabs Switcher */}
          <div className="shrink-0 border-b border-slate-200/80 px-6 pt-3.5 bg-white">
            <div className="flex items-start justify-between">
              <div>
                <div className="flex items-center space-x-2.5">
                  <h1 className={PAGE_TITLE}>Sales Workspace</h1>
                  <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold bg-indigo-50 text-indigo-700 border border-indigo-200">
                    Active Cycle
                  </span>
                </div>
                <p className={PAGE_SUBTITLE}>
                  Manage quotations, build pricing bundles, and follow deal progression across sales
                  operations.
                </p>
              </div>

              <div className="flex items-center space-x-2 relative">
                {/* Actions Dropdown */}
                <div className="relative">
                  <button
                    className="inline-flex items-center justify-center px-3 py-1.5 text-xs font-semibold text-slate-700 bg-white border border-slate-200 rounded-lg hover:bg-slate-50 shadow-sm transition-all focus:outline-none"
                    onClick={(event) => {
                      event.stopPropagation();
                      setActionsOpen((current) => !current);
                    }}
                    type="button"
                  >
                    <span>Actions ▾</span>
                  </button>
                  {actionsOpen && (
                    <div
                      className="absolute right-0 mt-1.5 w-44 bg-white border border-slate-200 rounded-lg shadow-lg py-1 z-50 text-xs"
                      onClick={(event) => event.stopPropagation()}
                    >
                      <button
                        className="w-full text-left px-3 py-1.5 hover:bg-slate-50 text-slate-700 flex items-center space-x-2"
                        onClick={reload}
                        type="button"
                      >
                        <svg
                          className={"w-3.5 h-3.5 text-slate-400 " + (syncing ? "animate-spin" : "")}
                          fill="none"
                          stroke="currentColor"
                          viewBox="0 0 24 24"
                        >
                          <path
                            d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeWidth="2"
                          />
                        </svg>
                        <span>{syncing ? "Syncing..." : "Reload Data"}</span>
                      </button>
                      <button
                        className="w-full text-left px-3 py-1.5 hover:bg-slate-50 text-slate-700 flex items-center space-x-2"
                        type="button"
                      >
                        <svg className="w-3.5 h-3.5 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path
                            d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeWidth="2"
                          />
                        </svg>
                        <span>Export CSV</span>
                      </button>
                      <div className="border-t border-slate-100 my-1" />
                      <button
                        className="w-full text-left px-3 py-1.5 hover:bg-rose-50 text-rose-600 flex items-center space-x-2"
                        onClick={askToClose}
                        type="button"
                      >
                        <svg className="w-3.5 h-3.5 text-rose-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path
                            d="M6 18L18 6M6 6l12 12"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeWidth="2"
                          />
                        </svg>
                        <span>Close Workspace</span>
                      </button>
                    </div>
                  )}
                </div>

                {/* Primary CTA Button */}
                <button
                  className="inline-flex items-center justify-center px-3.5 py-1.5 text-xs font-semibold text-white bg-indigo-600 rounded-lg hover:bg-indigo-700 shadow-sm shadow-indigo-200 transition-all focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-1"
                  onClick={() => setBuilderOpen(true)}
                  type="button"
                >
                  <svg className="w-3.5 h-3.5 mr-1.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path d="M12 4v16m8-8H4" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" />
                  </svg>
                  <span>+ New Quotation</span>
                </button>
              </div>
            </div>

            {/* 3. Interactive View Switcher Tabs */}
            <div className="flex items-center justify-between mt-3 text-xs">
              <div className="flex items-center space-x-6">
                <button
                  className={
                    "flex items-center space-x-1.5 pb-2.5 border-b-2 transition-colors cursor-pointer " +
                    (view === "quotations"
                      ? "font-semibold text-indigo-600 border-indigo-600"
                      : "font-medium text-slate-500 hover:text-slate-800 border-transparent")
                  }
                  onClick={() => setView("quotations")}
                  type="button"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path
                      d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth="2"
                    />
                  </svg>
                  <span>Quotations</span>
                  <span
                    className={
                      "font-bold px-1.5 py-0.5 rounded-full text-[10px] " +
                      (view === "quotations" ? "bg-indigo-50 text-indigo-700" : "bg-slate-100 text-slate-600")
                    }
                  >
                    12
                  </span>
                </button>

                <button
                  className={
                    "flex items-center space-x-1.5 pb-2.5 border-b-2 transition-colors cursor-pointer " +
                    (view === "pipeline"
                      ? "font-semibold text-indigo-600 border-indigo-600"
                      : "font-medium text-slate-500 hover:text-slate-800 border-transparent")
                  }
                  onClick={() => setView("pipeline")}
                  type="button"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path
                      d="M9 17V7m0 10a2 2 0 01-2 2H5a2 2 0 01-2-2V7a2 2 0 012-2h2a2 2 0 012 2m0 10a2 2 0 002 2h2a2 2 0 002-2M9 7a2 2 0 012-2h2a2 2 0 012 2m0 10V7m0 10a2 2 0 002 2h2a2 2 0 002-2V7a2 2 0 00-2-2h-2a2 2 0 00-2 2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth="2"
                    />
                  </svg>
                  <span>Pipeline</span>
                  <span
                    className={
                      "font-bold px-1.5 py-0.5 rounded-full text-[10px] " +
                      (view === "pipeline" ? "bg-indigo-50 text-indigo-700" : "bg-slate-100 text-slate-600")
                    }
                  >
                    5 Stages
                  </span>
                </button>
              </div>

              <div className="flex items-center space-x-1 pb-1.5">
                <div className="inline-flex items-center bg-slate-100 p-0.5 rounded-lg text-[11px] font-medium text-slate-600">
                  <button
                    className={
                      "px-2.5 py-1 rounded flex items-center space-x-1 " +
                      (view === "pipeline"
                        ? "bg-white text-indigo-600 shadow-sm font-semibold"
                        : "hover:text-slate-900 transition-colors")
                    }
                    onClick={() => setView("pipeline")}
                    type="button"
                  >
                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path
                        d="M4 6h16M4 10h16M4 14h16M4 18h16"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth="2"
                      />
                    </svg>
                    <span>Board</span>
                  </button>
                  <button
                    className={
                      "px-2.5 py-1 rounded flex items-center space-x-1 " +
                      (view === "quotations"
                        ? "bg-white text-indigo-600 shadow-sm font-semibold"
                        : "hover:text-slate-900 transition-colors")
                    }
                    onClick={() => setView("quotations")}
                    type="button"
                  >
                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path
                        d="M4 6h16M4 12h16m-7 6h7"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth="2"
                      />
                    </svg>
                    <span>List</span>
                  </button>
                </div>
              </div>
            </div>
          </div>

          {/* Main Tabbed Views Container */}
          <div className="flex-1 min-h-0 overflow-hidden flex flex-col relative bg-slate-50/60">
            {view === "quotations" ? (
              <QuotationsView onResume={() => setBuilderOpen(true)} />
            ) : (
              <PipelineView onOpenBuilder={() => setBuilderOpen(true)} />
            )}

            {builderOpen && <QuotationBuilder onClose={() => setBuilderOpen(false)} />}
          </div>

          <StatusBar />
      </AppWindow>

      <AppDock />
      <AgentButton />

      {/* Close Workspace Confirmation */}
      {closeOpen && (
        <div className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-2xl max-w-sm w-full p-5 modal-enter border border-slate-200">
            <div className="flex items-center space-x-3 mb-3">
              <div className="w-10 h-10 rounded-full bg-rose-100 text-rose-600 flex items-center justify-center shrink-0">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path
                    d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth="2"
                  />
                </svg>
              </div>
              <div>
                <h3 className="text-sm font-bold text-slate-900">Close Sales Workspace?</h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  Are you sure you want to leave this workspace? Any unsaved quotation drafts will
                  remain preserved.
                </p>
              </div>
            </div>
            <div className="flex items-center justify-end space-x-2 pt-3 border-t border-slate-100">
              <button
                className="px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-100 rounded-lg transition-colors"
                onClick={() => setCloseOpen(false)}
                type="button"
              >
                Cancel
              </button>
              <button
                className="px-3 py-1.5 text-xs font-semibold text-white bg-rose-600 hover:bg-rose-700 rounded-lg shadow-sm transition-colors"
                onClick={() => {
                  setCloseOpen(false);
                  router.push(ROUTES.home);
                }}
                type="button"
              >
                Close Workspace
              </button>
            </div>
          </div>
        </div>
      )}
    </AppShell>
  );
}
