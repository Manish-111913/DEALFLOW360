"use client";

import { useEffect, useState } from "react";

/**
 * Adding a product to a quotation.
 *
 * The row asks for three things - what, how many, at what discount - and sends
 * them. It quotes no price: the unit price comes from the catalogue and the
 * customer's price list, resolved server-side at the moment the line is added
 * and snapshotted onto it, so a later catalogue change cannot reprice a quote
 * a customer is already looking at. Predicting it here would only ever be a
 * second, wrong answer.
 */

interface Product {
  id: string;
  sku: string;
  name: string;
  type: string;
  basePrice: string;
}

export interface NewLineInput {
  productId: string;
  quantity: number;
  discountPercentage: string;
}

export function AddLineRow({
  open,
  busy,
  onOpen,
  onCancel,
  onAdd,
}: {
  open: boolean;
  busy: boolean;
  onOpen: () => void;
  onCancel: () => void;
  onAdd: (line: NewLineInput) => void;
}) {
  const [products, setProducts] = useState<Product[] | null>(null);
  const [productId, setProductId] = useState("");
  const [quantity, setQuantity] = useState("1");
  const [discount, setDiscount] = useState("0");

  // Loaded when the row is first opened rather than with the page: most visits
  // to a quotation are to read it, and the catalogue is not needed for that.
  useEffect(() => {
    if (!open || products) return;

    let cancelled = false;
    void (async () => {
      const response = await fetch("/api/catalog", { cache: "no-store" });
      const body = (await response.json().catch(() => null)) as { products?: Product[] } | null;
      if (cancelled) return;
      setProducts(body?.products ?? []);
      if (body?.products?.[0]) setProductId(body.products[0].id);
    })();

    return () => {
      cancelled = true;
    };
  }, [open, products]);

  if (!open) {
    return (
      <button
        className="mt-3 w-full py-2.5 rounded-lg border border-dashed border-slate-300 text-xs font-semibold text-slate-500 hover:border-indigo-400 hover:text-indigo-600 hover:bg-indigo-50/40 transition-colors"
        onClick={onOpen}
        type="button"
      >
        + Add product
      </button>
    );
  }

  return (
    <div className="mt-3 rounded-lg border border-slate-200 bg-slate-50/70 p-3">
      <div className="flex flex-wrap items-end gap-2.5">
        <div className="flex-1 min-w-[12rem]">
          <label className="block text-[11px] font-semibold text-slate-600 mb-1" htmlFor="add-product">
            Product
          </label>
          <select
            className="w-full text-xs px-2.5 py-2 border border-slate-200 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-600"
            disabled={!products || busy}
            id="add-product"
            onChange={(event) => setProductId(event.target.value)}
            value={productId}
          >
            {!products && <option>Loading…</option>}
            {products?.map((product) => (
              <option key={product.id} value={product.id}>
                {product.name} — {product.sku}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="block text-[11px] font-semibold text-slate-600 mb-1" htmlFor="add-qty">
            Qty
          </label>
          <input
            className="w-20 text-xs px-2.5 py-2 border border-slate-200 rounded-lg bg-white font-jetbrains focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-600"
            disabled={busy}
            id="add-qty"
            min="1"
            onChange={(event) => setQuantity(event.target.value)}
            type="number"
            value={quantity}
          />
        </div>

        <div>
          <label className="block text-[11px] font-semibold text-slate-600 mb-1" htmlFor="add-disc">
            Discount %
          </label>
          <input
            className="w-24 text-xs px-2.5 py-2 border border-slate-200 rounded-lg bg-white font-jetbrains focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-600"
            disabled={busy}
            id="add-disc"
            max="100"
            min="0"
            onChange={(event) => setDiscount(event.target.value)}
            step="0.5"
            type="number"
            value={discount}
          />
        </div>

        <button
          className="px-3 py-2 rounded-lg text-xs font-semibold text-slate-600 hover:bg-slate-200/70 transition-colors"
          onClick={onCancel}
          type="button"
        >
          Cancel
        </button>
        <button
          className="px-3.5 py-2 rounded-lg text-xs font-bold text-white bg-indigo-600 hover:bg-indigo-700 transition-colors disabled:opacity-50"
          disabled={busy || !productId}
          onClick={() => {
            const qty = Number.parseInt(quantity, 10);
            if (!Number.isInteger(qty) || qty < 1) return;
            onAdd({ productId, quantity: qty, discountPercentage: discount || "0" });
          }}
          type="button"
        >
          {busy ? "Adding…" : "Add to Quotation"}
        </button>
      </div>

      <p className="text-[11px] text-slate-400 mt-2">
        Price comes from the customer&apos;s price list. Margin, risk and any approval requirement
        are recalculated when the line is added.
      </p>
    </div>
  );
}
