import { assertCan, type AuthzUser } from "../authz/roles";
import { currentBusinessTime } from "../clock";
import { prisma } from "../db";
import { getSettings, SETTING_DESCRIPTIONS, SETTING_KEYS, type SettingKey } from "../settings";

/**
 * The configuration surface, §4A of the problem statement.
 *
 * The engines already read this data - ceilings, warehouses, plans, pairings -
 * but nothing could *list* it, so the Admin screens the spec asks for had no
 * backend to call and the frontend had no way to populate a category or
 * warehouse dropdown. These are the reads that close that gap.
 *
 * Writes stay in the module that owns the rule: a discount policy is changed
 * through the discount-policy service, a setting through `setSetting`. This
 * file deliberately does not become a second way to edit governance.
 *
 * Everything here is gated on `can(user, "view", ...)`, and the mutating
 * surfaces on `can(user, "configure", subject)` - which is where D16 lands: a
 * Sales Manager configures discount tiers and approval chains, Admin everything
 * else.
 */

// ---------------------------------------------------------------------------
// Catalogue
// ---------------------------------------------------------------------------

export async function listCategories() {
  return prisma.productCategory.findMany({
    orderBy: { name: "asc" },
    include: { _count: { select: { products: true } } },
  });
}

export async function listTaxes() {
  return prisma.tax.findMany({ orderBy: { name: "asc" } });
}

export async function listProducts(options?: { activeOnly?: boolean }) {
  return prisma.product.findMany({
    where: options?.activeOnly === false ? {} : { isActive: true },
    orderBy: [{ category: { name: "asc" } }, { name: "asc" }],
    include: {
      category: { select: { id: true, name: true } },
      tax: { select: { id: true, name: true, percentage: true } },
      variants: { where: { isActive: true }, orderBy: { attributeValue: "asc" } },
    },
  });
}

/** §A2 - tier-based price lists, with their items. */
export async function listPriceLists() {
  return prisma.priceList.findMany({
    orderBy: [{ tier: "asc" }, { name: "asc" }],
    include: {
      items: {
        include: {
          product: { select: { id: true, name: true, sku: true } },
          variant: { select: { id: true, attributeName: true, attributeValue: true } },
        },
      },
    },
  });
}

// ---------------------------------------------------------------------------
// Governance
// ---------------------------------------------------------------------------

/** §A3 - both levels of the ceiling: the tier default and its category overrides. */
export async function listDiscountPolicy() {
  const [tiers, policies] = await Promise.all([
    prisma.discountTier.findMany({ orderBy: { tier: "asc" } }),
    prisma.discountPolicy.findMany({
      where: { isActive: true },
      orderBy: [{ tier: "asc" }],
      include: { category: { select: { id: true, name: true } } },
    }),
  ]);
  return { tierDefaults: tiers, categoryOverrides: policies };
}

/** §A3 - the configurable approval chain (D11), rather than a hardcoded 30/60. */
export async function listApprovalChain() {
  return prisma.approvalChain.findMany({
    orderBy: { createdAt: "asc" },
    include: { steps: { orderBy: { stepOrder: "asc" } } },
  });
}

// ---------------------------------------------------------------------------
// Operations
// ---------------------------------------------------------------------------

/** §A4 - warehouses, their stock, and their replenishment rules. */
export async function listWarehouses() {
  const warehouses = await prisma.warehouse.findMany({
    orderBy: { priority: "asc" },
    include: {
      stock: {
        include: {
          product: { select: { id: true, name: true, sku: true } },
          variant: { select: { id: true, attributeValue: true } },
        },
      },
    },
  });

  return warehouses.map((w) => ({
    id: w.id,
    name: w.name,
    code: w.code,
    priority: w.priority,
    shippingCost: w.shippingCost.toFixed(2),
    isActive: w.isActive,
    stock: w.stock.map((row) => ({
      productId: row.productId,
      productName: row.product.name,
      sku: row.product.sku,
      variant: row.variant?.attributeValue ?? null,
      available: row.availableQuantity,
      reserved: row.reservedQuantity,
      free: Math.max(0, row.availableQuantity - row.reservedQuantity),
      reorderLevel: row.reorderLevel,
      reorderQuantity: row.reorderQuantity,
      /** §A4 replenishment: below the reorder point and worth restocking. */
      needsReplenishment:
        row.reorderLevel > 0 &&
        row.availableQuantity - row.reservedQuantity <= row.reorderLevel,
    })),
  }));
}

/** Everything at or below its reorder point, across all warehouses. */
export async function listReplenishmentNeeds() {
  const warehouses = await listWarehouses();
  return warehouses.flatMap((w) =>
    w.stock
      .filter((row) => row.needsReplenishment)
      .map((row) => ({
        warehouseId: w.id,
        warehouseName: w.name,
        productId: row.productId,
        productName: row.productName,
        free: row.free,
        reorderLevel: row.reorderLevel,
        suggestedOrderQuantity: row.reorderQuantity,
      })),
  );
}

/** §A5 - recurring plans and their proration and cancellation rules. */
export async function listSubscriptionPlans() {
  return prisma.subscriptionPlan.findMany({
    orderBy: { name: "asc" },
    include: {
      product: { select: { id: true, name: true, sku: true } },
      _count: { select: { subscriptions: true } },
    },
  });
}

/** §A6 - pairings, with the derived rate and any admin override (D14). */
export async function listUpsellRules() {
  const pairings = await prisma.productPairing.findMany({
    where: { isActive: true },
    orderBy: [{ coPurchaseRate: "desc" }],
    include: {
      baseProduct: { select: { id: true, name: true, sku: true } },
      suggestedProduct: { select: { id: true, name: true, sku: true, isPromoted: true } },
    },
  });

  return pairings.map((p) => ({
    id: p.id,
    baseProduct: p.baseProduct,
    suggestedProduct: p.suggestedProduct,
    derivedRate: p.coPurchaseRate.toFixed(4),
    configuredRate: p.configuredRate?.toFixed(4) ?? null,
    /** Which one the engine will actually use. */
    effectiveRate: (p.configuredRate ?? p.coPurchaseRate).toFixed(4),
    minMarginPercentage: p.minMarginPercentage.toFixed(2),
    isPromoted: p.suggestedProduct.isPromoted,
  }));
}

// ---------------------------------------------------------------------------
// Teams and settings
// ---------------------------------------------------------------------------

export async function listSalesTeams() {
  return prisma.salesTeam.findMany({
    orderBy: { name: "asc" },
    include: {
      manager: { select: { id: true, name: true, email: true } },
      members: {
        where: { active: true },
        select: { id: true, name: true, email: true, role: true },
        orderBy: { name: "asc" },
      },
    },
  });
}

export interface SettingView {
  key: SettingKey;
  value: string;
  description: string;
  isDefault: boolean;
}

/** Effective settings, marking which are still on their default. */
export async function listSettings(): Promise<SettingView[]> {
  const stored = await prisma.systemSetting.findMany();
  const storedByKey = new Map(stored.map((row) => [row.key, row.value]));
  const effective = await getSettings();

  const asString: Record<SettingKey, string> = {
    [SETTING_KEYS.currencyCode]: effective.currencyCode,
    [SETTING_KEYS.currencyMinorUnits]: String(effective.currencyMinorUnits),
    [SETTING_KEYS.quoteNumberPrefix]: effective.quoteNumberPrefix,
    [SETTING_KEYS.quoteNumberPadding]: String(effective.quoteNumberPadding),
    [SETTING_KEYS.targetMarginPercentage]: effective.targetMarginPercentage.toFixed(2),
    [SETTING_KEYS.discountFallbackCeiling]: effective.discountFallbackCeiling.toFixed(2),
    [SETTING_KEYS.upsellMinCoPurchaseSample]: String(effective.upsellMinCoPurchaseSample),
    [SETTING_KEYS.invoiceNumberPrefix]: effective.invoiceNumberPrefix,
    [SETTING_KEYS.creditNoteNumberPrefix]: effective.creditNoteNumberPrefix,
    [SETTING_KEYS.billingPeriodsAhead]: String(effective.billingPeriodsAhead),
  };

  return (Object.values(SETTING_KEYS) as SettingKey[]).map((key) => ({
    key,
    value: asString[key],
    description: SETTING_DESCRIPTIONS[key],
    isDefault: !storedByKey.has(key),
  }));
}

// ---------------------------------------------------------------------------
// One call for the whole configuration area
// ---------------------------------------------------------------------------

/**
 * The Admin configuration screen, in a single read.
 *
 * Gated on being allowed to see reports, which is the same bar as any other
 * whole-company view; individual edits are gated separately by
 * `can(user, "configure", subject)`.
 */
export async function getConfigurationOverview(user: AuthzUser) {
  assertCan(user, "view", "report");

  const [
    categories,
    taxes,
    priceLists,
    discountPolicy,
    approvalChains,
    warehouses,
    replenishment,
    plans,
    upsellRules,
    teams,
    settings,
  ] = await Promise.all([
    listCategories(),
    listTaxes(),
    listPriceLists(),
    listDiscountPolicy(),
    listApprovalChain(),
    listWarehouses(),
    listReplenishmentNeeds(),
    listSubscriptionPlans(),
    listUpsellRules(),
    listSalesTeams(),
    listSettings(),
  ]);

  return {
    generatedAt: currentBusinessTime(),
    catalogue: { categories, taxes, priceLists },
    governance: { ...discountPolicy, approvalChains },
    operations: { warehouses, replenishment, plans },
    upsell: upsellRules,
    teams,
    settings,
    /** What the caller may change, so a screen can disable rather than fail. */
    permissions: {
      discountTier: canConfigure(user, "discountTier"),
      approvalChain: canConfigure(user, "approvalChain"),
      product: canConfigure(user, "product"),
      priceList: canConfigure(user, "priceList"),
      warehouse: canConfigure(user, "warehouse"),
      subscriptionPlan: canConfigure(user, "subscriptionPlan"),
      upsellRule: canConfigure(user, "upsellRule"),
    },
  };
}

function canConfigure(
  user: AuthzUser,
  subject:
    | "discountTier"
    | "approvalChain"
    | "product"
    | "priceList"
    | "warehouse"
    | "subscriptionPlan"
    | "upsellRule",
): boolean {
  try {
    assertCan(user, "configure", subject);
    return true;
  } catch {
    return false;
  }
}
