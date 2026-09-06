"use client";

import { signOut } from "next-auth/react";
import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import { AppShell, AppWindow, StatusBar, WindowScroll } from "@/components/app-shell";
import { AppDock } from "@/components/app-dock";
import { DealAssistant } from "@/components/deal-assistant";
import { CHROME_BAR, PAGE_SUBTITLE, PAGE_TITLE, SCROLL_PADDING } from "@/components/design-tokens";
import { ToastProvider, useToast, useToastState } from "@/components/toast";
import { PolicyTester } from "./policy-tester";
import {
  AccountSection,
  ApprovalsSection,
  BillingSection,
  DiscountsSection,
  FulfilmentSection,
  ProductsSection,
  ReportingSection,
  UpsellSection,
} from "./settings-sections";

/**
 * Screen 9 - Settings.
 *
 * Everything on this screen writes to a table an engine already reads. There is
 * no display-only preference here: change a tier ceiling and the next quotation
 * routes differently, change the allocator's tie-break and the fulfilment
 * screen recommends a different split, turn off the promoted bonus and the
 * upsell panel reorders. That was the point of building it against the
 * configuration models rather than a new settings table.
 *
 * Edits are collected rather than saved on each keystroke. The source design
 * has one Save and one Discard at the top, and that is also the honest model
 * here: a ceiling and the approval band that depends on it should land together
 * or not at all, so a half-applied policy is never left on screen.
 */

// ---------------------------------------------------------------------------
// Data
// ---------------------------------------------------------------------------

export interface SettingsData {
  /**
   * The caller may not read the configuration at all.
   *
   * A Sales Rep is the case: they hold `riskDetail` but not `report`, so the
   * ceilings and the catalogue are not theirs - but "would this discount need
   * approval?" genuinely is, and the dock offers this screen to everyone.
   */
  restricted: boolean;
  permissions: {
    discountTier: boolean;
    approvalChain: boolean;
    product: boolean;
    priceList: boolean;
    warehouse: boolean;
    subscriptionPlan: boolean;
    upsellRule: boolean;
  };
  actor: { name: string; email: string; role: string; initials: string };
  categories: { id: string; name: string; productCount: number }[];
  products: {
    id: string;
    sku: string;
    name: string;
    categoryName: string;
    type: string;
    basePrice: string;
    costPrice: string;
    isActive: boolean;
    isPromoted: boolean;
  }[];
  priceLists: {
    id: string;
    name: string;
    tier: string | null;
    currency: string;
    isActive: boolean;
    itemCount: number;
  }[];
  tierCeilings: { id: string; tier: string; maxDiscount: string; isActive: boolean }[];
  categoryCeilings: {
    id: string;
    tier: string;
    categoryId: string;
    categoryName: string;
    maxDiscount: string;
  }[];
  approvalChains: {
    id: string;
    name: string;
    isActive: boolean;
    steps: {
      id: string;
      stepOrder: number;
      approverRole: string;
      minDiscount: string | null;
      maxDiscount: string | null;
      minRiskScore: string | null;
      maxRiskScore: string | null;
    }[];
  }[];
  warehouses: {
    id: string;
    name: string;
    code: string;
    priority: number;
    shippingCost: string;
    isActive: boolean;
    skuCount: number;
    lowStockCount: number;
  }[];
  replenishment: {
    warehouseName: string;
    productName: string;
    free: number;
    reorderLevel: number;
    suggested: number;
  }[];
  plans: {
    id: string;
    name: string;
    interval: string;
    price: string;
    prorationRule: string;
    cancellationRule: string;
    isActive: boolean;
    subscriberCount: number;
  }[];
  pairings: {
    id: string;
    baseProductName: string;
    suggestedProductName: string;
    derivedRate: string;
    configuredRate: string | null;
    effectiveRate: string;
    minMarginPercentage: string;
    isPromoted: boolean;
  }[];
  settings: { key: string; value: string; description: string; isDefault: boolean }[];
}

/**
 * What a section is given.
 *
 * Sections read and write through this and nothing else, so none of them knows
 * how a change reaches the server. `value` returns the edited value if there is
 * one and the saved value otherwise, which is what makes an unsaved edit
 * survive a re-render without being written anywhere yet.
 */
export interface Editor {
  value: (key: string, fallback: string) => string;
  flag: (key: string, fallback: boolean) => boolean;
  set: (key: string, value: string) => void;
  /** The saved value of a system setting, before any edit. */
  setting: (key: string) => string;
  mayEditSystemSettings: boolean;
  removeCategoryCeiling: (policyId: string, categoryName: string) => void;
  addCategoryCeiling: (tier: string, categoryId: string, maxDiscount: string) => void;
  removeApprovalStep: (stepId: string, role: string) => void;
  addApprovalStep: (chainId: string, role: string) => void;
  resetSetting: (key: string) => void;
}

export function SettingsClient({ data }: { data: SettingsData }) {
  return (
    <ToastProvider durationMs={3200}>
      <Settings data={data} />
    </ToastProvider>
  );
}

// ---------------------------------------------------------------------------
// Saving
// ---------------------------------------------------------------------------

/**
 * One pending edit per field, keyed `kind:id:field`.
 *
 * Ids are cuids and setting keys are dotted, so neither contains a colon and
 * the key parses back apart cleanly. Grouping by `kind:id` on save means three
 * edits to the same warehouse become one request rather than three.
 */
type Draft = Record<string, string>;

function groupDraft(draft: Draft): Map<string, Record<string, string>> {
  const groups = new Map<string, Record<string, string>>();
  for (const [key, value] of Object.entries(draft)) {
    const firstColon = key.indexOf(":");
    const lastColon = key.lastIndexOf(":");
    // A system setting has no field part - `setting:currency.code` - so the
    // whole remainder is the id and the field is fixed.
    const kind = key.slice(0, firstColon);
    const id = kind === "setting" ? key.slice(firstColon + 1) : key.slice(firstColon + 1, lastColon);
    const field = kind === "setting" ? "value" : key.slice(lastColon + 1);

    const group = `${kind}:${id}`;
    groups.set(group, { ...(groups.get(group) ?? {}), [field]: value });
  }
  return groups;
}

async function applyGroup(
  group: string,
  fields: Record<string, string>,
): Promise<{ ok: boolean; error?: string }> {
  const kind = group.slice(0, group.indexOf(":"));
  const id = group.slice(group.indexOf(":") + 1);

  const bool = (v: string | undefined) => (v === undefined ? undefined : v === "true");
  const num = (v: string | undefined) => (v === undefined ? undefined : Number(v));

  const send = async (url: string, method: string, body: unknown) => {
    const response = await fetch(url, {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (response.ok) return { ok: true };
    const payload = await response.json().catch(() => ({}));
    return { ok: false, error: payload.error ?? `${method} ${url} failed` };
  };

  switch (kind) {
    case "setting":
      return send("/api/settings", "PATCH", { key: id, value: fields.value });

    case "tierCeiling":
      return send("/api/settings/discounts", "POST", {
        tier: id,
        maxDiscount: fields.maxDiscount,
      });

    case "categoryCeiling": {
      const [tier, categoryId] = id.split("|");
      return send("/api/settings/discounts", "POST", {
        tier,
        categoryId,
        maxDiscount: fields.maxDiscount,
      });
    }

    case "approvalStep":
      return send("/api/settings/approvals", "PATCH", {
        stepId: id,
        // An emptied field means "no bound on this side", which the route
        // distinguishes from "leave it alone" by null against undefined.
        minDiscount: fields.minDiscount === undefined ? undefined : fields.minDiscount || null,
        maxDiscount: fields.maxDiscount === undefined ? undefined : fields.maxDiscount || null,
      });

    case "product":
      return send("/api/settings/operations", "PATCH", {
        target: "product",
        productId: id,
        basePrice: fields.basePrice,
        costPrice: fields.costPrice,
        isActive: bool(fields.isActive),
        isPromoted: bool(fields.isPromoted),
      });

    case "priceList":
      return send("/api/settings/operations", "PATCH", {
        target: "priceList",
        priceListId: id,
        isActive: bool(fields.isActive),
      });

    case "warehouse":
      return send("/api/settings/operations", "PATCH", {
        target: "warehouse",
        warehouseId: id,
        priority: num(fields.priority),
        shippingCost: fields.shippingCost,
        isActive: bool(fields.isActive),
      });

    case "plan":
      return send("/api/settings/operations", "PATCH", {
        target: "plan",
        planId: id,
        prorationRule: fields.prorationRule,
        cancellationRule: fields.cancellationRule,
        isActive: bool(fields.isActive),
      });

    case "pairing":
      return send("/api/settings/operations", "PATCH", {
        target: "upsell",
        pairingId: id,
        minMarginPercentage: fields.minMarginPercentage,
        isActive: bool(fields.isActive),
      });

    default:
      return { ok: false, error: `Nothing knows how to save ${kind}` };
  }
}

// ---------------------------------------------------------------------------
// The screen
// ---------------------------------------------------------------------------

function Settings({ data }: { data: SettingsData }) {
  const router = useRouter();
  const showToast = useToast();
  const [draft, setDraft] = useState<Draft>({});
  const [busy, startTransition] = useTransition();

  const savedSettings = useMemo(
    () => new Map(data.settings.map((setting) => [setting.key, setting.value])),
    [data.settings],
  );

  const pendingCount = Object.keys(draft).length;

  // Only an Admin may change a system setting, and the services enforce it.
  // Mirrored here so the controls read as unavailable rather than failing.
  const mayEditSystemSettings = data.actor.role === "ADMIN";

  function immediate(label: string, run: () => Promise<Response>) {
    startTransition(async () => {
      const response = await run();
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        showToast(body.error ?? `${label} failed`);
        return;
      }
      showToast(label);
      router.refresh();
    });
  }

  const editor: Editor = {
    value: (key, fallback) => draft[key] ?? fallback,
    flag: (key, fallback) => (draft[key] === undefined ? fallback : draft[key] === "true"),
    set: (key, value) => setDraft((current) => ({ ...current, [key]: value })),
    setting: (key) => savedSettings.get(key) ?? "",
    mayEditSystemSettings,

    // These three change the *shape* of the configuration rather than a value
    // in it - a row appears or disappears - so they apply at once instead of
    // waiting for Save. Batching a removal alongside edits to the row being
    // removed would only produce a confusing failure.
    removeCategoryCeiling: (policyId, categoryName) =>
      immediate(`${categoryName} override retired.`, () =>
        fetch(`/api/settings/discounts?policyId=${policyId}`, { method: "DELETE" }),
      ),
    addCategoryCeiling: (tier, categoryId, maxDiscount) =>
      immediate("Override added.", () =>
        fetch("/api/settings/discounts", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ tier, categoryId, maxDiscount }),
        }),
      ),
    removeApprovalStep: (stepId, role) =>
      immediate(`${role} step removed from the chain.`, () =>
        fetch(`/api/settings/approvals?stepId=${stepId}`, { method: "DELETE" }),
      ),
    addApprovalStep: (chainId, role) =>
      immediate("Reviewer added to the chain.", () =>
        fetch("/api/settings/approvals", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ chainId, approverRole: role }),
        }),
      ),
    resetSetting: (key) =>
      immediate(`${key} reset to its default.`, () =>
        fetch(`/api/settings?key=${encodeURIComponent(key)}`, { method: "DELETE" }),
      ),
  };

  function save() {
    if (pendingCount === 0) return;
    startTransition(async () => {
      const groups = [...groupDraft(draft).entries()];
      const failures: string[] = [];

      // Sequential, not parallel: several of these write the same audit chain,
      // whose hash covers the previous row - concurrent appends would race for
      // the same predecessor.
      for (const [group, fields] of groups) {
        const result = await applyGroup(group, fields);
        if (!result.ok) failures.push(result.error ?? group);
      }

      if (failures.length === 0) {
        setDraft({});
        showToast(
          `${groups.length} change${groups.length === 1 ? "" : "s"} saved. New quotations use them immediately.`,
        );
      } else {
        // Whatever succeeded is kept; the draft is not cleared, so the failing
        // fields stay on screen with their attempted values.
        showToast(failures[0]);
      }
      router.refresh();
    });
  }

  return (
    <AppShell className="screen-settings font-jakarta bg-[#f0f4f8] text-slate-800 selection:bg-indigo-100 selection:text-indigo-800">
      <AppWindow>
        <header className={CHROME_BAR}>
          <div className="flex items-center space-x-3">
            <div className="flex items-center space-x-1.5">
              <span className="w-3 h-3 rounded-full bg-[#ff5f56] inline-block shadow-sm" />
              <span className="w-3 h-3 rounded-full bg-[#ffbd2e] inline-block shadow-sm" />
              <span className="w-3 h-3 rounded-full bg-[#27c93f] inline-block shadow-sm" />
            </div>
            <div className="h-4 w-px bg-slate-300" />
            <div className="text-xs font-medium text-slate-600">
              Sales Operations &amp; Configuration
            </div>
          </div>
        </header>

        <section className="shrink-0 border-b border-slate-200/80 px-6 py-3.5 bg-white">
          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
            <div>
              <div className="flex items-center space-x-2.5">
                <h1 className={PAGE_TITLE}>Settings</h1>
                <span
                  className={
                    "inline-flex items-center px-2 py-0.5 rounded-md text-[11px] font-semibold border " +
                    (pendingCount > 0
                      ? "bg-amber-50 text-amber-700 border-amber-200"
                      : "bg-emerald-50 text-emerald-700 border-emerald-200")
                  }
                >
                  <span
                    className={
                      "w-1.5 h-1.5 rounded-full mr-1.5 " +
                      (pendingCount > 0 ? "bg-amber-500" : "bg-emerald-500")
                    }
                  />
                  {data.restricted
                    ? "Read only"
                    : pendingCount > 0
                      ? `${pendingCount} unsaved`
                      : "All changes saved"}
                </span>
              </div>
              <p className={PAGE_SUBTITLE}>
                The business rules DealFlow360 prices, routes and ships by. Every value here is read
                by an engine on the next calculation.
              </p>
            </div>

            <div className={"flex items-center gap-2.5 shrink-0" + (data.restricted ? " hidden" : "")}>
              <button
                className="px-3.5 py-1.5 text-xs font-semibold text-slate-600 hover:text-slate-800 bg-white hover:bg-slate-50 border border-slate-200 rounded-lg transition disabled:opacity-50"
                disabled={busy || pendingCount === 0}
                onClick={() => setDraft({})}
                type="button"
              >
                Discard Changes
              </button>
              <button
                className="inline-flex items-center px-4 py-1.5 text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg shadow-xs transition disabled:opacity-50"
                disabled={busy || pendingCount === 0}
                onClick={save}
                type="button"
              >
                <svg className="w-3.5 h-3.5 mr-1.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path d="M5 13l4 4L19 7" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.2" />
                </svg>
                {busy ? "Saving…" : "Save Changes"}
              </button>
            </div>
          </div>
        </section>

        <WindowScroll className={SCROLL_PADDING + " space-y-8"}>
          {data.restricted ? (
            <>
              <div className="bg-white rounded-xl border border-slate-200/90 shadow-2xs p-6">
                <p className="text-sm font-bold text-slate-900">
                  Configuration is not yours to change
                </p>
                <p className="text-xs text-slate-500 mt-1 leading-relaxed">
                  Discount ceilings and the approval chain belong to your Sales Manager; the
                  catalogue, warehouses and system values belong to an administrator. You can still
                  check what the current rules would do with a deal.
                </p>
              </div>
              <PolicyTester data={data} />
              <AccountSection
                data={data}
                onSignOut={() => {
                  void signOut({ callbackUrl: "/login" });
                }}
              />
            </>
          ) : (
            <>
          <ProductsSection data={data} editor={editor} />
          <DiscountsSection data={data} editor={editor} />
          <ApprovalsSection data={data} editor={editor} />
          <PolicyTester data={data} />
          <FulfilmentSection data={data} editor={editor} />
          <BillingSection data={data} editor={editor} />
          <UpsellSection data={data} editor={editor} />
          <ReportingSection editor={editor} />
          {/* SystemSection is deliberately not mounted. Every value it edits is
              real and read by an engine, but they are raw dotted keys -
              `upsell.minCoPurchaseSample`, `quotation.numberPadding` - and a
              grid of those reads as a debug panel next to the labelled controls
              above. The section is kept rather than deleted: each key still has
              a default, so nothing depends on it being on screen, and putting
              it back is one line. */}
          <AccountSection
            data={data}
            onSignOut={() => {
              void signOut({ callbackUrl: "/login" });
            }}
          />
            </>
          )}
        </WindowScroll>

        <StatusBar />
      </AppWindow>

      <AppDock />
      <DealAssistant quotationId={null} screen="settings" subject={null} />
      <SettingsToast />
    </AppShell>
  );
}

function SettingsToast() {
  const { message, visible } = useToastState();
  return (
    <div
      className={
        "fixed bottom-20 right-6 z-50 bg-slate-900 text-white text-xs px-4 py-2.5 rounded-xl shadow-2xl transition-all duration-200 max-w-md " +
        (visible ? "opacity-100" : "opacity-0 pointer-events-none translate-y-4")
      }
    >
      {message}
    </div>
  );
}
