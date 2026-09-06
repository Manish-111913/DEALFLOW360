"use client";

import { useState } from "react";
import { CARD, TABLE_HEAD } from "@/components/design-tokens";
import { formatRupees } from "@/lib/money";
import type { Editor, SettingsData } from "./settings-client";

/**
 * The nine sections of the Settings screen.
 *
 * Presentational only: every one of them reads through `editor.value` and
 * writes through `editor.set`, so none of them knows how a change is saved or
 * whether it has been. That keeps the save orchestration in one place and means
 * a section can be read on its own to see what it edits.
 *
 * Each section is disabled rather than hidden when the caller may not configure
 * it. Hiding would leave a Sales Manager wondering where the warehouses went;
 * showing them read-only says "this exists, it is not yours", which is the
 * honest answer and matches what the permissions map is for.
 */

// ---------------------------------------------------------------------------
// Shared pieces
// ---------------------------------------------------------------------------

export function SectionHeading({
  title,
  subtitle,
  action,
}: {
  title: string;
  subtitle: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div>
        <h2 className="text-sm font-bold text-slate-900 uppercase tracking-wider">{title}</h2>
        <p className="text-xs text-slate-500 mt-0.5">{subtitle}</p>
      </div>
      {action}
    </div>
  );
}

function ReadOnlyNote({ who }: { who: string }) {
  return (
    <span className="text-[10px] font-semibold px-2 py-0.5 rounded border bg-slate-100 text-slate-600 border-slate-200">
      {who} only
    </span>
  );
}

const INPUT =
  "w-full text-xs font-semibold rounded-lg border-slate-200 focus:border-indigo-500 focus:ring-indigo-500/20 py-1.5 px-2.5 disabled:bg-slate-50 disabled:text-slate-400";

function TextField({
  id,
  value,
  onChange,
  disabled,
  suffix,
  mono = true,
}: {
  id: string;
  value: string;
  onChange: (next: string) => void;
  disabled: boolean;
  suffix?: string;
  mono?: boolean;
}) {
  return (
    <div className="flex items-center gap-1.5">
      <input
        className={INPUT + (mono ? " font-jetbrains" : "")}
        disabled={disabled}
        id={id}
        onChange={(event) => onChange(event.target.value)}
        type="text"
        value={value}
      />
      {suffix && <span className="text-[11px] text-slate-400 shrink-0">{suffix}</span>}
    </div>
  );
}

function Toggle({
  id,
  checked,
  onChange,
  disabled,
  label,
}: {
  id: string;
  checked: boolean;
  onChange: (next: boolean) => void;
  disabled: boolean;
  label: string;
}) {
  return (
    <label
      className={
        "flex items-center gap-2 " + (disabled ? "cursor-not-allowed opacity-60" : "cursor-pointer")
      }
      htmlFor={id}
    >
      <input
        checked={checked}
        className="rounded border-slate-300 text-indigo-600 focus:ring-indigo-500 h-3.5 w-3.5"
        disabled={disabled}
        id={id}
        onChange={(event) => onChange(event.target.checked)}
        type="checkbox"
      />
      <span className="text-slate-700 font-medium text-xs">{label}</span>
    </label>
  );
}

function StatusPill({ on, onLabel = "Active", offLabel = "Inactive" }: { on: boolean; onLabel?: string; offLabel?: string }) {
  return (
    <span
      className={
        "inline-flex items-center px-2 py-0.5 rounded text-[10px] font-semibold border " +
        (on
          ? "bg-emerald-50 text-emerald-700 border-emerald-200"
          : "bg-slate-100 text-slate-600 border-slate-200")
      }
    >
      {on ? onLabel : offLabel}
    </span>
  );
}

// ---------------------------------------------------------------------------
// 1 · Products & Price Lists
// ---------------------------------------------------------------------------

export function ProductsSection({ data, editor }: { data: SettingsData; editor: Editor }) {
  const may = data.permissions.product;

  return (
    <section className="space-y-4" id="products">
      <SectionHeading
        action={may ? undefined : <ReadOnlyNote who="Admin" />}
        subtitle="Catalogue items, their standard price, and the currency price books."
        title="Products & Price Lists"
      />

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
        <div className={"lg:col-span-8 " + CARD + " p-4"}>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className={TABLE_HEAD}>
                <tr>
                  <th className="py-2.5 px-3">Product</th>
                  <th className="py-2.5 px-3">Category</th>
                  <th className="py-2.5 px-3 w-32">Standard Price</th>
                  <th className="py-2.5 px-3 w-32">Cost</th>
                  <th className="py-2.5 px-3">Flags</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-[12px]">
                {data.products.map((product) => (
                  <tr className="hover:bg-slate-50/70 transition" key={product.id}>
                    <td className="py-2.5 px-3">
                      <span className="font-semibold text-slate-800">{product.name}</span>
                      <span className="block text-[11px] text-slate-400 font-jetbrains">
                        {product.sku}
                      </span>
                    </td>
                    <td className="py-2.5 px-3 text-slate-600">{product.categoryName}</td>
                    <td className="py-2.5 px-3">
                      <TextField
                        disabled={!may}
                        id={`price-${product.id}`}
                        onChange={(next) =>
                          editor.set(`product:${product.id}:basePrice`, next)
                        }
                        value={editor.value(`product:${product.id}:basePrice`, product.basePrice)}
                      />
                    </td>
                    <td className="py-2.5 px-3">
                      <TextField
                        disabled={!may}
                        id={`cost-${product.id}`}
                        onChange={(next) =>
                          editor.set(`product:${product.id}:costPrice`, next)
                        }
                        value={editor.value(`product:${product.id}:costPrice`, product.costPrice)}
                      />
                    </td>
                    <td className="py-2.5 px-3 space-y-1">
                      <Toggle
                        checked={editor.flag(`product:${product.id}:isActive`, product.isActive)}
                        disabled={!may}
                        id={`active-${product.id}`}
                        label="Active"
                        onChange={(next) =>
                          editor.set(`product:${product.id}:isActive`, String(next))
                        }
                      />
                      {/* Promotion is a real input to the upsell score, not a
                          badge: it earns a ranking bonus unless that bonus is
                          switched off in Upsell below. */}
                      <Toggle
                        checked={editor.flag(`product:${product.id}:isPromoted`, product.isPromoted)}
                        disabled={!may}
                        id={`promoted-${product.id}`}
                        label="Promoted"
                        onChange={(next) =>
                          editor.set(`product:${product.id}:isPromoted`, String(next))
                        }
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className={"lg:col-span-4 " + CARD + " p-4 flex flex-col justify-between"}>
          <div>
            <div className="flex items-center justify-between pb-2 mb-2 border-b border-slate-100">
              <h3 className="text-xs font-bold text-slate-900 uppercase tracking-wider">
                Price Lists
              </h3>
              {!data.permissions.priceList && <ReadOnlyNote who="Admin" />}
            </div>
            <ul className="divide-y divide-slate-100 text-xs">
              {data.priceLists.map((list) => (
                <li className="py-2 flex items-center justify-between gap-2" key={list.id}>
                  <div className="min-w-0">
                    <span className="font-semibold text-slate-800 block truncate">{list.name}</span>
                    <span className="text-[11px] text-slate-500">
                      {list.tier ? `${list.tier} tier` : "Default catalogue"} · {list.itemCount} item
                      {list.itemCount === 1 ? "" : "s"}
                    </span>
                  </div>
                  <Toggle
                    checked={editor.flag(`priceList:${list.id}:isActive`, list.isActive)}
                    disabled={!data.permissions.priceList}
                    id={`pricelist-${list.id}`}
                    label=""
                    onChange={(next) =>
                      editor.set(`priceList:${list.id}:isActive`, String(next))
                    }
                  />
                </li>
              ))}
            </ul>
          </div>
          <div className="pt-2 mt-2 text-[11px] text-slate-500 border-t border-slate-100">
            Primary currency:{" "}
            <strong className="text-slate-700">
              {data.settings.find((s) => s.key === "currency.code")?.value ?? "INR"}
            </strong>
          </div>
        </div>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// 2 · Pricing & Discounts
// ---------------------------------------------------------------------------

const TIER_DOT: Record<string, string> = {
  BRONZE: "bg-amber-700",
  SILVER: "bg-slate-400",
  GOLD: "bg-amber-500",
};

export function DiscountsSection({ data, editor }: { data: SettingsData; editor: Editor }) {
  const may = data.permissions.discountTier;

  return (
    <section className="space-y-4" id="pricing">
      <SectionHeading
        action={may ? undefined : <ReadOnlyNote who="Sales Manager / Admin" />}
        subtitle="The most anyone may discount before a reviewer is required. A category ceiling overrides its tier's default."
        title="Pricing & Discounts"
      />

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
        <div className={"lg:col-span-6 " + CARD + " p-5"}>
          <div className="pb-3 mb-3 border-b border-slate-100">
            <h3 className="text-xs font-bold text-slate-900 uppercase tracking-wider">
              Customer Tier Discount Limits
            </h3>
            <p className="text-[11px] text-slate-500 mt-0.5">
              Applied when no category override exists for the line.
            </p>
          </div>

          <table className="w-full text-left text-xs">
            <thead className={TABLE_HEAD}>
              <tr>
                <th className="py-2.5 px-3">Tier</th>
                <th className="py-2.5 px-3 w-40">Max Allowed Discount</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-[12px]">
              {data.tierCeilings.map((row) => (
                <tr className="hover:bg-slate-50/70 transition" key={row.id}>
                  <td className="py-2.5 px-3">
                    <span className="font-semibold text-slate-800 flex items-center gap-2">
                      <span
                        className={"w-2 h-2 rounded-full " + (TIER_DOT[row.tier] ?? "bg-slate-300")}
                      />
                      {row.tier}
                    </span>
                  </td>
                  <td className="py-2.5 px-3">
                    <TextField
                      disabled={!may}
                      id={`tier-${row.tier}`}
                      onChange={(next) => editor.set(`tierCeiling:${row.tier}:maxDiscount`, next)}
                      suffix="%"
                      value={editor.value(`tierCeiling:${row.tier}:maxDiscount`, row.maxDiscount)}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className={"lg:col-span-6 " + CARD + " p-5"}>
          <div className="pb-3 mb-3 border-b border-slate-100">
            <h3 className="text-xs font-bold text-slate-900 uppercase tracking-wider">
              Category Overrides
            </h3>
            <p className="text-[11px] text-slate-500 mt-0.5">
              Narrower than the tier default, for one product category.
            </p>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className={TABLE_HEAD}>
                <tr>
                  <th className="py-2.5 px-3">Category</th>
                  <th className="py-2.5 px-3">Tier</th>
                  <th className="py-2.5 px-3 w-32">Max Discount</th>
                  <th className="py-2.5 px-3 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-[12px]">
                {data.categoryCeilings.length === 0 ? (
                  <tr>
                    <td className="py-3 px-3 text-slate-500" colSpan={4}>
                      No overrides configured; every line uses its tier default.
                    </td>
                  </tr>
                ) : (
                  data.categoryCeilings.map((row) => (
                    <tr className="hover:bg-slate-50/70 transition" key={row.id}>
                      <td className="py-2.5 px-3 font-semibold text-slate-800">
                        {row.categoryName}
                      </td>
                      <td className="py-2.5 px-3 text-slate-600">{row.tier}</td>
                      <td className="py-2.5 px-3">
                        <TextField
                          disabled={!may}
                          id={`cat-${row.id}`}
                          onChange={(next) =>
                            editor.set(
                              `categoryCeiling:${row.tier}|${row.categoryId}:maxDiscount`,
                              next,
                            )
                          }
                          suffix="%"
                          value={editor.value(
                            `categoryCeiling:${row.tier}|${row.categoryId}:maxDiscount`,
                            row.maxDiscount,
                          )}
                        />
                      </td>
                      <td className="py-2.5 px-3 text-right">
                        <button
                          className="text-rose-500 hover:underline font-medium disabled:opacity-40 disabled:no-underline"
                          disabled={!may}
                          onClick={() => editor.removeCategoryCeiling(row.id, row.categoryName)}
                          type="button"
                        >
                          Remove
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          {may && <AddOverride data={data} editor={editor} />}

          <div className="mt-3 p-2.5 bg-slate-50 rounded-lg border border-slate-200 text-[11px] text-slate-600">
            Removing an override does not delete it — it is retired with an end date, so a
            quotation priced under it can still be explained.
          </div>
        </div>
      </div>
    </section>
  );
}

/**
 * Add an override for a tier and category that has none.
 *
 * Combinations that already have one are left out of the list rather than
 * offered and then refused: writing a second active row for the same pair is
 * what the supersede-on-write path is for, and doing it from an "add" form
 * would silently retire a row the user did not know existed.
 */
function AddOverride({ data, editor }: { data: SettingsData; editor: Editor }) {
  const [tier, setTier] = useState(data.tierCeilings[0]?.tier ?? "GOLD");
  const [categoryId, setCategoryId] = useState("");
  const [maxDiscount, setMaxDiscount] = useState("");

  const taken = new Set(data.categoryCeilings.map((row) => `${row.tier}|${row.categoryId}`));
  const available = data.categories.filter((c) => !taken.has(`${tier}|${c.id}`));

  if (available.length === 0) {
    return (
      <p className="mt-3 text-[11px] text-slate-500">
        Every category already has an override for each tier.
      </p>
    );
  }

  const chosen = categoryId && available.some((c) => c.id === categoryId)
    ? categoryId
    : available[0].id;

  return (
    <div className="mt-3 pt-3 border-t border-slate-100">
      <span className="block text-[11px] font-bold text-slate-700 uppercase tracking-wider mb-2">
        Add an override
      </span>
      <div className="flex flex-wrap items-end gap-2">
        <select
          className={INPUT + " w-28"}
          onChange={(event) => setTier(event.target.value)}
          value={tier}
        >
          {data.tierCeilings.map((row) => (
            <option key={row.tier} value={row.tier}>
              {row.tier}
            </option>
          ))}
        </select>
        <select
          className={INPUT + " flex-1 min-w-[9rem]"}
          onChange={(event) => setCategoryId(event.target.value)}
          value={chosen}
        >
          {available.map((category) => (
            <option key={category.id} value={category.id}>
              {category.name}
            </option>
          ))}
        </select>
        <div className="w-24">
          <TextField
            disabled={false}
            id="new-override-value"
            onChange={setMaxDiscount}
            suffix="%"
            value={maxDiscount}
          />
        </div>
        <button
          className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white shadow-xs transition disabled:opacity-50"
          disabled={!maxDiscount.trim()}
          onClick={() => {
            editor.addCategoryCeiling(tier, chosen, maxDiscount.trim());
            setMaxDiscount("");
          }}
          type="button"
        >
          Add
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// 3 · Approval Workflow
// ---------------------------------------------------------------------------

const ROLE_LABEL: Record<string, string> = {
  SALES_MANAGER: "Sales Manager",
  FINANCE_OPS: "Finance / Operations",
};

export function ApprovalsSection({ data, editor }: { data: SettingsData; editor: Editor }) {
  const may = data.permissions.approvalChain;
  const chain = data.approvalChains.find((c) => c.isActive) ?? data.approvalChains[0] ?? null;

  return (
    <section className="space-y-4" id="approvals">
      <SectionHeading
        action={may ? undefined : <ReadOnlyNote who="Sales Manager / Admin" />}
        subtitle="Which reviewer a quotation goes to, and the discount band that triggers them."
        title="Approval Workflow"
      />

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
        <div className={"lg:col-span-8 " + CARD + " p-5"}>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className={TABLE_HEAD}>
                <tr>
                  <th className="py-2.5 px-3">Step</th>
                  <th className="py-2.5 px-3">Reviewer</th>
                  <th className="py-2.5 px-3 w-28">From</th>
                  <th className="py-2.5 px-3 w-28">To</th>
                  <th className="py-2.5 px-3 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-[12px]">
                {(chain?.steps ?? []).map((step) => (
                  <tr className="hover:bg-slate-50/70 transition" key={step.id}>
                    <td className="py-2.5 px-3 font-jetbrains font-semibold text-slate-700">
                      {step.stepOrder}
                    </td>
                    <td className="py-2.5 px-3 font-semibold text-slate-800">
                      {ROLE_LABEL[step.approverRole] ?? step.approverRole}
                    </td>
                    <td className="py-2.5 px-3">
                      <TextField
                        disabled={!may}
                        id={`step-min-${step.id}`}
                        onChange={(next) =>
                          editor.set(`approvalStep:${step.id}:minDiscount`, next)
                        }
                        suffix="%"
                        value={editor.value(
                          `approvalStep:${step.id}:minDiscount`,
                          step.minDiscount ?? "",
                        )}
                      />
                    </td>
                    <td className="py-2.5 px-3">
                      <TextField
                        disabled={!may}
                        id={`step-max-${step.id}`}
                        onChange={(next) =>
                          editor.set(`approvalStep:${step.id}:maxDiscount`, next)
                        }
                        suffix="%"
                        value={editor.value(
                          `approvalStep:${step.id}:maxDiscount`,
                          step.maxDiscount ?? "",
                        )}
                      />
                    </td>
                    <td className="py-2.5 px-3 text-right">
                      <button
                        className="text-rose-500 hover:underline font-medium disabled:opacity-40 disabled:no-underline"
                        disabled={!may}
                        onClick={() =>
                          editor.removeApprovalStep(
                            step.id,
                            ROLE_LABEL[step.approverRole] ?? step.approverRole,
                          )
                        }
                        type="button"
                      >
                        Remove
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <p className="text-[11px] text-slate-500 mt-3 pt-3 border-t border-slate-100">
            An empty bound means unbounded on that side. A step with no bounds at all would match
            every deal, so the routing engine treats it as a default rather than a rule.
          </p>
        </div>

        <div className={"lg:col-span-4 " + CARD + " p-5 flex flex-col justify-between"}>
          <div>
            <h3 className="text-xs font-bold text-slate-900 uppercase tracking-wider mb-2">
              Sequential Chain
            </h3>
            <p className="text-[11px] text-slate-500 mb-4">
              {chain ? chain.name : "No chain configured"} — reviewers are asked in this order.
            </p>

            <div className="space-y-2">
              {(chain?.steps ?? []).map((step, index) => (
                <div key={step.id}>
                  {index > 0 && (
                    <div className="flex justify-center text-slate-400 py-1">
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path
                          d="M19 14l-7 7m0 0l-7-7m7 7V3"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth="2"
                        />
                      </svg>
                    </div>
                  )}
                  <div className="p-2.5 bg-slate-50 border border-slate-200 rounded-lg flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="w-5 h-5 rounded-full bg-indigo-100 text-indigo-700 text-xs font-bold flex items-center justify-center">
                        {step.stepOrder}
                      </span>
                      <span className="text-xs font-semibold text-slate-800">
                        {ROLE_LABEL[step.approverRole] ?? step.approverRole}
                      </span>
                    </div>
                    <span className="text-[10px] text-slate-400 font-jetbrains">
                      {step.minDiscount ?? "—"}–{step.maxDiscount ?? "∞"}%
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {may && chain && (
            <div className="pt-4 mt-4 border-t border-slate-100 flex items-center gap-2">
              <button
                className="flex-1 px-2.5 py-1.5 text-[11px] font-semibold text-slate-700 bg-white hover:bg-slate-50 border border-slate-300 rounded-lg"
                onClick={() => editor.addApprovalStep(chain.id, "SALES_MANAGER")}
                type="button"
              >
                + Sales Manager
              </button>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// 5 · Warehouses & Fulfilment
// ---------------------------------------------------------------------------

export function FulfilmentSection({ data, editor }: { data: SettingsData; editor: Editor }) {
  const may = data.permissions.warehouse;
  const mayTuneEngine = editor.mayEditSystemSettings;

  return (
    <section className="space-y-4" id="fulfillment">
      <SectionHeading
        action={may ? undefined : <ReadOnlyNote who="Admin" />}
        subtitle="Depot priority and freight, and how the allocator chooses between plans."
        title="Warehouses & Fulfillment"
      />

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
        <div className={"lg:col-span-6 " + CARD + " p-5 space-y-3"}>
          <h3 className="text-xs font-bold text-slate-900 uppercase tracking-wider pb-2 border-b border-slate-100">
            Fulfillment Locations
          </h3>

          {data.warehouses.map((warehouse) => (
            <div
              className="p-3 border border-slate-200 rounded-lg bg-slate-50/50 space-y-2"
              key={warehouse.id}
            >
              <div className="flex items-center justify-between gap-2">
                <div>
                  <h4 className="text-xs font-bold text-slate-800">{warehouse.name}</h4>
                  <p className="text-[11px] text-slate-500">
                    <span className="font-jetbrains">{warehouse.code}</span> · {warehouse.skuCount}{" "}
                    SKU{warehouse.skuCount === 1 ? "" : "s"}
                    {warehouse.lowStockCount > 0 && (
                      <span className="text-amber-700 font-medium">
                        {" "}
                        · {warehouse.lowStockCount} below reorder point
                      </span>
                    )}
                  </p>
                </div>
                <StatusPill on={editor.flag(`warehouse:${warehouse.id}:isActive`, warehouse.isActive)} />
              </div>

              <div className="grid grid-cols-3 gap-2 items-end">
                <div>
                  <label
                    className="block text-[10px] font-semibold text-slate-600 mb-1"
                    htmlFor={`wh-priority-${warehouse.id}`}
                  >
                    Priority
                  </label>
                  <TextField
                    disabled={!may}
                    id={`wh-priority-${warehouse.id}`}
                    onChange={(next) => editor.set(`warehouse:${warehouse.id}:priority`, next)}
                    value={editor.value(
                      `warehouse:${warehouse.id}:priority`,
                      String(warehouse.priority),
                    )}
                  />
                </div>
                <div>
                  <label
                    className="block text-[10px] font-semibold text-slate-600 mb-1"
                    htmlFor={`wh-freight-${warehouse.id}`}
                  >
                    Freight
                  </label>
                  <TextField
                    disabled={!may}
                    id={`wh-freight-${warehouse.id}`}
                    onChange={(next) => editor.set(`warehouse:${warehouse.id}:shippingCost`, next)}
                    value={editor.value(
                      `warehouse:${warehouse.id}:shippingCost`,
                      warehouse.shippingCost,
                    )}
                  />
                </div>
                <Toggle
                  checked={editor.flag(`warehouse:${warehouse.id}:isActive`, warehouse.isActive)}
                  disabled={!may}
                  id={`wh-active-${warehouse.id}`}
                  label="Active"
                  onChange={(next) =>
                    editor.set(`warehouse:${warehouse.id}:isActive`, String(next))
                  }
                />
              </div>
            </div>
          ))}
        </div>

        <div className={"lg:col-span-6 " + CARD + " p-5 space-y-4"}>
          <div className="flex items-center justify-between pb-2 border-b border-slate-100">
            <h3 className="text-xs font-bold text-slate-900 uppercase tracking-wider">
              Fulfillment Preferences
            </h3>
            {!mayTuneEngine && <ReadOnlyNote who="Admin" />}
          </div>

          <div>
            <span className="block text-[11px] font-semibold text-slate-600 mb-1.5">
              When two plans fill the same demand, prefer
            </span>
            <div className="space-y-1.5">
              {[
                { value: "SHIPMENTS_FIRST", label: "Fewest shipments, freight as the tie-break" },
                { value: "COST_FIRST", label: "Cheapest freight, shipment count as the tie-break" },
              ].map((option) => (
                <label
                  className={
                    "flex items-center gap-2 p-2 rounded-lg border text-xs transition-colors " +
                    (editor.value("setting:fulfilment.ranking", editor.setting("fulfilment.ranking")) ===
                    option.value
                      ? "border-indigo-300 bg-indigo-50/60"
                      : "border-slate-200 hover:bg-slate-50") +
                    (mayTuneEngine ? " cursor-pointer" : " cursor-not-allowed opacity-70")
                  }
                  key={option.value}
                >
                  <input
                    checked={
                      editor.value(
                        "setting:fulfilment.ranking",
                        editor.setting("fulfilment.ranking"),
                      ) === option.value
                    }
                    className="text-indigo-600 focus:ring-indigo-500/20"
                    disabled={!mayTuneEngine}
                    name="fulfilment-ranking"
                    onChange={() => editor.set("setting:fulfilment.ranking", option.value)}
                    type="radio"
                    value={option.value}
                  />
                  <span className="text-slate-700 font-medium">{option.label}</span>
                </label>
              ))}
            </div>
            {/* Not a label: the allocator sorts its candidate plans by this. */}
            <p className="text-[11px] text-slate-500 mt-1.5">
              Unfilled demand always outranks both — a plan that leaves stock unshipped never wins
              on price.
            </p>
          </div>

          <div className="pt-3 border-t border-slate-100">
            <Toggle
              checked={editor.flag(
                "setting:fulfilment.backordersEnabled",
                editor.setting("fulfilment.backordersEnabled") === "true",
              )}
              disabled={!mayTuneEngine}
              id="backorders"
              label="Backorder handling enabled"
              onChange={(next) =>
                editor.set("setting:fulfilment.backordersEnabled", String(next))
              }
            />
            <p className="text-[11px] text-slate-500 mt-1">
              With this off, an order the network cannot fill is refused outright rather than
              part-shipped with a promise attached.
            </p>
          </div>

          <div className="grid grid-cols-2 gap-3 pt-3 border-t border-slate-100">
            <div>
              <label
                className="block text-[11px] font-semibold text-slate-600 mb-1"
                htmlFor="reorder-level"
              >
                Default reorder point
              </label>
              <TextField
                disabled={!mayTuneEngine}
                id="reorder-level"
                onChange={(next) => editor.set("setting:fulfilment.defaultReorderLevel", next)}
                suffix="units"
                value={editor.value(
                  "setting:fulfilment.defaultReorderLevel",
                  editor.setting("fulfilment.defaultReorderLevel"),
                )}
              />
            </div>
            <div>
              <label
                className="block text-[11px] font-semibold text-slate-600 mb-1"
                htmlFor="reorder-qty"
              >
                Replenishment target
              </label>
              <TextField
                disabled={!mayTuneEngine}
                id="reorder-qty"
                onChange={(next) => editor.set("setting:fulfilment.defaultReorderQuantity", next)}
                suffix="units"
                value={editor.value(
                  "setting:fulfilment.defaultReorderQuantity",
                  editor.setting("fulfilment.defaultReorderQuantity"),
                )}
              />
            </div>
          </div>
          <p className="text-[11px] text-slate-500">
            A stock row&rsquo;s own level always wins; these apply to rows that set none.{" "}
            <strong className="text-slate-700">
              {data.replenishment.length} line{data.replenishment.length === 1 ? "" : "s"}
            </strong>{" "}
            currently below the reorder point.
          </p>
        </div>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// 6 · Subscriptions & Billing
// ---------------------------------------------------------------------------

const PRORATION = [
  { value: "DAILY_CALENDAR", label: "Daily, on calendar days" },
  { value: "NONE", label: "None — full period charged" },
];

const CANCELLATION = [
  { value: "PRORATA_CREDIT", label: "Credit the unused period" },
  { value: "END_OF_CYCLE", label: "Runs to the end of the cycle" },
  { value: "IMMEDIATE_NO_CREDIT", label: "Immediate, no credit" },
];

export function BillingSection({ data, editor }: { data: SettingsData; editor: Editor }) {
  const may = data.permissions.subscriptionPlan;

  return (
    <section className="space-y-4" id="billing">
      <SectionHeading
        action={may ? undefined : <ReadOnlyNote who="Admin" />}
        subtitle="Recurring plans, and what happens when one is changed or cancelled mid-cycle."
        title="Subscriptions & Billing"
      />

      <div className={CARD + " p-5"}>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className={TABLE_HEAD}>
              <tr>
                <th className="py-2.5 px-3">Plan</th>
                <th className="py-2.5 px-3">Cycle Price</th>
                <th className="py-2.5 px-3 w-52">Proration</th>
                <th className="py-2.5 px-3 w-56">Cancellation</th>
                <th className="py-2.5 px-3">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-[12px]">
              {data.plans.length === 0 ? (
                <tr>
                  <td className="py-3 px-3 text-slate-500" colSpan={5}>
                    No recurring plans configured.
                  </td>
                </tr>
              ) : (
                data.plans.map((plan) => (
                  <tr className="hover:bg-slate-50/70 transition" key={plan.id}>
                    <td className="py-2.5 px-3">
                      <span className="font-semibold text-slate-800">{plan.name}</span>
                      <span className="block text-[11px] text-slate-400">
                        {plan.subscriberCount} active subscription
                        {plan.subscriberCount === 1 ? "" : "s"}
                      </span>
                    </td>
                    <td className="py-2.5 px-3 font-jetbrains font-bold text-slate-800">
                      {formatRupees(plan.price)}
                      <span className="text-slate-400 font-normal">
                        {" "}
                        / {plan.interval.toLowerCase()}
                      </span>
                    </td>
                    <td className="py-2.5 px-3">
                      <select
                        className={INPUT}
                        disabled={!may}
                        onChange={(event) =>
                          editor.set(`plan:${plan.id}:prorationRule`, event.target.value)
                        }
                        value={editor.value(
                          `plan:${plan.id}:prorationRule`,
                          plan.prorationRule,
                        )}
                      >
                        {PRORATION.map((option) => (
                          <option key={option.value} value={option.value}>
                            {option.label}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="py-2.5 px-3">
                      <select
                        className={INPUT}
                        disabled={!may}
                        onChange={(event) =>
                          editor.set(`plan:${plan.id}:cancellationRule`, event.target.value)
                        }
                        value={editor.value(
                          `plan:${plan.id}:cancellationRule`,
                          plan.cancellationRule,
                        )}
                      >
                        {CANCELLATION.map((option) => (
                          <option key={option.value} value={option.value}>
                            {option.label}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="py-2.5 px-3">
                      <Toggle
                        checked={editor.flag(`plan:${plan.id}:isActive`, plan.isActive)}
                        disabled={!may}
                        id={`plan-active-${plan.id}`}
                        label="Active"
                        onChange={(next) => editor.set(`plan:${plan.id}:isActive`, String(next))}
                      />
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// 7 · Upsell & Cross-sell
// ---------------------------------------------------------------------------

export function UpsellSection({ data, editor }: { data: SettingsData; editor: Editor }) {
  const may = data.permissions.upsellRule;
  const mayTuneEngine = editor.mayEditSystemSettings;

  return (
    <section className="space-y-4" id="upsell">
      <SectionHeading
        action={may ? undefined : <ReadOnlyNote who="Admin" />}
        subtitle="Which products are suggested alongside others, and what the ranking is allowed to weigh."
        title="Upsell & Cross-sell"
      />

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
        <div className={"lg:col-span-7 " + CARD + " p-5"}>
          <h3 className="text-xs font-bold text-slate-900 uppercase tracking-wider pb-2 mb-3 border-b border-slate-100">
            Configured Product Pairings
          </h3>

          <div className="space-y-2 text-xs">
            {data.pairings.length === 0 ? (
              <p className="text-slate-500">No pairings configured.</p>
            ) : (
              data.pairings.map((pairing) => (
                <div
                  className="p-2.5 bg-slate-50 border border-slate-200 rounded-lg flex flex-wrap items-center justify-between gap-2"
                  key={pairing.id}
                >
                  <div className="min-w-0">
                    <span className="font-medium text-slate-800 block truncate">
                      {pairing.baseProductName} → {pairing.suggestedProductName}
                    </span>
                    <span className="text-[11px] text-slate-500 font-jetbrains">
                      co-purchase {(Number(pairing.effectiveRate) * 100).toFixed(0)}%
                      {pairing.configuredRate ? " (overridden)" : " (from history)"}
                      {pairing.isPromoted ? " · promoted" : ""}
                    </span>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <label
                      className="text-[10px] font-semibold text-slate-500"
                      htmlFor={`pair-floor-${pairing.id}`}
                    >
                      Margin floor
                    </label>
                    <div className="w-24">
                      <TextField
                        disabled={!may}
                        id={`pair-floor-${pairing.id}`}
                        onChange={(next) =>
                          editor.set(`pairing:${pairing.id}:minMarginPercentage`, next)
                        }
                        suffix="%"
                        value={editor.value(
                          `pairing:${pairing.id}:minMarginPercentage`,
                          pairing.minMarginPercentage,
                        )}
                      />
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        <div className={"lg:col-span-5 " + CARD + " p-5 space-y-3"}>
          <div className="flex items-center justify-between pb-2 border-b border-slate-100">
            <h3 className="text-xs font-bold text-slate-900 uppercase tracking-wider">
              Recommendation Controls
            </h3>
            {!mayTuneEngine && <ReadOnlyNote who="Admin" />}
          </div>

          <Toggle
            checked={editor.flag(
              "setting:upsell.useHistory",
              editor.setting("upsell.useHistory") === "true",
            )}
            disabled={!mayTuneEngine}
            id="upsell-history"
            label="History-based recommendations"
            onChange={(next) => editor.set("setting:upsell.useHistory", String(next))}
          />
          <p className="text-[11px] text-slate-500 -mt-1">
            Off, the co-purchase term drops out and only configured rates and margin decide the
            order.
          </p>

          <Toggle
            checked={editor.flag(
              "setting:upsell.usePromoted",
              editor.setting("upsell.usePromoted") === "true",
            )}
            disabled={!mayTuneEngine}
            id="upsell-promoted"
            label="Promoted products earn a ranking bonus"
            onChange={(next) => editor.set("setting:upsell.usePromoted", String(next))}
          />

          <div className="pt-2 border-t border-slate-100">
            <label
              className="block text-[11px] font-semibold text-slate-600 mb-1"
              htmlFor="upsell-floor"
            >
              Company-wide minimum margin
            </label>
            <TextField
              disabled={!mayTuneEngine}
              id="upsell-floor"
              onChange={(next) => editor.set("setting:upsell.minMarginPercentage", next)}
              suffix="%"
              value={editor.value(
                "setting:upsell.minMarginPercentage",
                editor.setting("upsell.minMarginPercentage"),
              )}
            />
            <p className="text-[11px] text-slate-500 mt-1">
              Applied on top of each pairing&rsquo;s own floor — it can only tighten one, never
              loosen it.
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// 8 · Reporting, and 9 · the rest of the system settings
// ---------------------------------------------------------------------------

const APPROVAL_STATES = ["NONE", "PENDING_MANAGER", "PENDING_FINANCE", "APPROVED", "REJECTED"];

export function ReportingSection({ editor }: { editor: Editor }) {
  const may = editor.mayEditSystemSettings;
  const selected = new Set(
    editor
      .value("setting:reporting.defaultApprovalStates", editor.setting("reporting.defaultApprovalStates"))
      .split(",")
      .map((v) => v.trim())
      .filter(Boolean),
  );

  function toggleState(state: string, on: boolean) {
    const next = new Set(selected);
    if (on) next.add(state);
    else next.delete(state);
    editor.set("setting:reporting.defaultApprovalStates", [...next].join(","));
  }

  return (
    <section className={CARD + " p-5 space-y-4"} id="reporting">
      <div className="flex items-center justify-between pb-3 border-b border-slate-100">
        <div>
          <h2 className="text-sm font-bold text-slate-900 uppercase tracking-wider">
            Reporting Preferences
          </h2>
          <p className="text-xs text-slate-500 mt-0.5">
            What a sales report covers when it is run without an explicit filter.
          </p>
        </div>
        {!may && <ReadOnlyNote who="Admin" />}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-5 text-xs">
        <div>
          <label
            className="block text-[11px] font-semibold text-slate-600 mb-1"
            htmlFor="report-period"
          >
            Default period
          </label>
          <TextField
            disabled={!may}
            id="report-period"
            onChange={(next) => editor.set("setting:reporting.defaultPeriodDays", next)}
            suffix="days back"
            value={editor.value(
              "setting:reporting.defaultPeriodDays",
              editor.setting("reporting.defaultPeriodDays"),
            )}
          />
        </div>

        <div className="md:col-span-2">
          <span className="block text-[11px] font-semibold text-slate-600 mb-1">
            Approval states included
          </span>
          <div className="flex flex-wrap gap-x-4 gap-y-1.5">
            {APPROVAL_STATES.map((state) => (
              <Toggle
                checked={selected.has(state)}
                disabled={!may}
                id={`state-${state}`}
                key={state}
                label={state.replace(/_/g, " ").toLowerCase()}
                onChange={(on) => toggleState(state, on)}
              />
            ))}
          </div>
          <p className="text-[11px] text-slate-500 mt-1.5">
            None selected means every state is included.
          </p>
        </div>
      </div>
    </section>
  );
}

/** The company-wide values every engine reads: currency, target margin, prefixes. */
export function SystemSection({ data, editor }: { data: SettingsData; editor: Editor }) {
  const may = editor.mayEditSystemSettings;
  // The keys with their own control above are not repeated here.
  const own = new Set([
    "fulfilment.ranking",
    "fulfilment.backordersEnabled",
    "fulfilment.defaultReorderLevel",
    "fulfilment.defaultReorderQuantity",
    "upsell.useHistory",
    "upsell.usePromoted",
    "upsell.minMarginPercentage",
    "reporting.defaultPeriodDays",
    "reporting.defaultApprovalStates",
  ]);
  const rows = data.settings.filter((setting) => !own.has(setting.key));

  return (
    <section className={CARD + " p-5 space-y-4"} id="system">
      <div className="flex items-center justify-between pb-3 border-b border-slate-100">
        <div>
          <h2 className="text-sm font-bold text-slate-900 uppercase tracking-wider">
            System Settings
          </h2>
          <p className="text-xs text-slate-500 mt-0.5">
            Company-wide values the pricing, margin and numbering engines read on every calculation.
          </p>
        </div>
        {!may && <ReadOnlyNote who="Admin" />}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-4">
        {rows.map((setting) => (
          <div key={setting.key}>
            <div className="flex items-center justify-between gap-2 mb-1">
              <label
                className="text-[11px] font-semibold text-slate-700 font-jetbrains"
                htmlFor={`setting-${setting.key}`}
              >
                {setting.key}
              </label>
              {setting.isDefault ? (
                <span className="text-[10px] text-slate-400">default</span>
              ) : (
                <button
                  className="text-[10px] text-indigo-600 hover:underline disabled:opacity-40 disabled:no-underline"
                  disabled={!may}
                  onClick={() => editor.resetSetting(setting.key)}
                  type="button"
                >
                  reset
                </button>
              )}
            </div>
            <TextField
              disabled={!may}
              id={`setting-${setting.key}`}
              onChange={(next) => editor.set(`setting:${setting.key}`, next)}
              value={editor.value(`setting:${setting.key}`, setting.value)}
            />
            <p className="text-[11px] text-slate-500 mt-1">{setting.description}</p>
          </div>
        ))}
      </div>
    </section>
  );
}

export function AccountSection({ data, onSignOut }: { data: SettingsData; onSignOut: () => void }) {
  return (
    <section className={CARD + " p-5"} id="account">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3.5">
          <div className="w-11 h-11 rounded-full bg-slate-900 text-white flex items-center justify-center font-bold text-sm font-jetbrains shadow-sm">
            {data.actor.initials}
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h3 className="text-sm font-bold text-slate-900">{data.actor.name}</h3>
              <StatusPill on onLabel="Active" />
            </div>
            <p className="text-xs text-slate-500">
              {data.actor.role.replace(/_/g, " ")} · {data.actor.email}
            </p>
          </div>
        </div>
        <button
          className="px-3.5 py-1.5 text-xs font-semibold text-rose-600 hover:text-rose-700 bg-rose-50 hover:bg-rose-100 border border-rose-200 rounded-lg transition"
          onClick={onSignOut}
          type="button"
        >
          Log Out
        </button>
      </div>
    </section>
  );
}
