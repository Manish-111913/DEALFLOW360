import { NextResponse } from "next/server";
import {
  setPriceListActive,
  setProduct,
  setSubscriptionPlan,
  setUpsellRule,
  setWarehouse,
} from "@dealflow/backend";
import { getCurrentUser } from "@/auth";
import { badRequest, handleServiceError, requireUser } from "@/lib/http";

/**
 * The four Admin-owned configuration tables the Settings screen edits.
 *
 * One route with a `target`, rather than four near-identical files. The
 * branches stay explicit and each one validates only its own fields, so this
 * reads as four small handlers that happen to share a door - the alternative
 * was four copies of the same session, parse and error-mapping preamble.
 *
 * Authorisation is per subject inside the services, so a Sales Manager reaches
 * none of these even though they may edit discount ceilings.
 */
const TARGETS = ["product", "priceList", "warehouse", "plan", "upsell"] as const;
type Target = (typeof TARGETS)[number];

export async function PATCH(request: Request) {
  try {
    const user = await getCurrentUser();
    requireUser(user);

    let payload: unknown;
    try {
      payload = await request.json();
    } catch {
      return badRequest("Expected a JSON body");
    }

    const body = (payload as Record<string, unknown>) ?? {};
    const target = body.target;

    if (!TARGETS.includes(target as Target)) {
      return badRequest(`target must be one of ${TARGETS.join(", ")}`);
    }

    const text = (v: unknown) => (typeof v === "string" ? v : undefined);
    const flag = (v: unknown) => (typeof v === "boolean" ? v : undefined);
    const id = (name: string) => {
      const value = body[name];
      if (typeof value !== "string" || !value) {
        throw Object.assign(new Error(`${name} is required`), { status: 400 });
      }
      return value;
    };

    switch (target as Target) {
      case "product": {
        const row = await setProduct(user, {
          productId: id("productId"),
          basePrice: text(body.basePrice),
          costPrice: text(body.costPrice),
          isActive: flag(body.isActive),
          isPromoted: flag(body.isPromoted),
        });
        return NextResponse.json({ id: row.id, name: row.name });
      }

      case "priceList": {
        const active = flag(body.isActive);
        if (active === undefined) return badRequest("isActive is required");
        const row = await setPriceListActive(user, {
          priceListId: id("priceListId"),
          isActive: active,
        });
        return NextResponse.json({ id: row.id, name: row.name });
      }

      case "warehouse": {
        const priority = body.priority;
        if (priority !== undefined && typeof priority !== "number") {
          return badRequest("priority must be a number");
        }
        const row = await setWarehouse(user, {
          warehouseId: id("warehouseId"),
          priority: priority as number | undefined,
          shippingCost: text(body.shippingCost),
          isActive: flag(body.isActive),
        });
        return NextResponse.json({ id: row.id, name: row.name });
      }

      case "plan": {
        const row = await setSubscriptionPlan(user, {
          planId: id("planId"),
          prorationRule: text(body.prorationRule),
          cancellationRule: text(body.cancellationRule),
          isActive: flag(body.isActive),
        });
        return NextResponse.json({ id: row.id, name: row.name });
      }

      case "upsell": {
        const row = await setUpsellRule(user, {
          pairingId: id("pairingId"),
          minMarginPercentage: text(body.minMarginPercentage),
          // null clears the override so derived history takes over again.
          configuredRate:
            body.configuredRate === null ? null : text(body.configuredRate),
          isActive: flag(body.isActive),
        });
        return NextResponse.json({ id: row.id });
      }
    }
  } catch (error) {
    return handleServiceError(error);
  }
}
